"""Tests for the dispatcher HTTP router.

The dispatcher replaces the legacy `BackgroundTasks` endpoints with three
small, request-lifecycle-only endpoints:

  POST /api/v1/jobs/dispatch         — create + start a new pipeline job
  POST /api/v1/jobs/{jobId}/cancel   — request cancellation
  POST /api/v1/jobs/{jobId}/retry    — resume a failed/canceled job
  GET  /api/v1/jobs/{jobId}          — read current job state (for the UI)

What we verify here, using FastAPI TestClient + in-memory repo + a mock
IJobExecutor:
  - Each jobType dispatches OK and produces a Cloud Run Jobs execution.
  - Bad payloads return 4xx (no silent fallbacks).
  - Cancel and Retry honour the state machine (409 on illegal transitions).
  - If the executor refuses to run, the job is left as `failed` so the UI
    sees a real error message instead of staying in `queued` forever.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.core.http.dispatch_router import (
    build_router,
    get_job_executor,
    get_job_repository,
    get_worker_job_name,
)
from src.pipeline_jobs.application.ports.job_executor import (
    ExecutionNotFoundError,
    JobExecutorError,
)
from src.pipeline_jobs.domain.entities import JobStatus, JobType
from src.pipeline_jobs.infrastructure.in_memory_pipeline_job_repository import (
    InMemoryPipelineJobRepository,
)


WORKER_JOB_NAME = (
    "projects/grupo-rg-a9929/locations/europe-southwest1/jobs/ai-core-worker"
)
EXEC_NAME = WORKER_JOB_NAME + "/executions/exec-test"


@pytest.fixture
def repo() -> InMemoryPipelineJobRepository:
    return InMemoryPipelineJobRepository()


@pytest.fixture
def executor() -> MagicMock:
    ex = MagicMock()
    ex.run_execution = AsyncMock(return_value=EXEC_NAME)
    ex.cancel_execution = AsyncMock(return_value=None)
    return ex


@pytest.fixture
def client(repo, executor) -> TestClient:
    app = FastAPI()
    app.include_router(build_router())
    app.dependency_overrides[get_job_repository] = lambda: repo
    app.dependency_overrides[get_job_executor] = lambda: executor
    app.dependency_overrides[get_worker_job_name] = lambda: WORKER_JOB_NAME
    return TestClient(app)


def _measurements_payload() -> dict[str, Any]:
    return {
        "jobType": "measurements",
        "uid": "user-1",
        "leadId": "lead-1",
        "budgetId": "budget-1",
        "payload": {
            "gcsUri": "gs://b/user-1/budget-1/x.pdf",
            "strategy": "INLINE",
        },
    }


# ---------------------------------------------------------------------------
# Dispatch — happy paths
# ---------------------------------------------------------------------------


class TestDispatchHappyPath:
    def test_measurements_creates_queued_job_and_starts_execution(
        self, client, repo, executor
    ):
        response = client.post(
            "/api/v1/jobs/dispatch", json=_measurements_payload()
        )
        assert response.status_code == 202, response.text
        body = response.json()
        assert body["status"] == "queued"
        job_id = body["jobId"]
        assert job_id

        # Executor was called with the right job name and JOB_ID env override.
        executor.run_execution.assert_awaited_once()
        kwargs = executor.run_execution.call_args.kwargs
        assert kwargs.get("job_name") == WORKER_JOB_NAME or (
            executor.run_execution.call_args.args
            and executor.run_execution.call_args.args[0] == WORKER_JOB_NAME
        )
        env_overrides = kwargs.get("env_overrides") or (
            executor.run_execution.call_args.args[1]
            if len(executor.run_execution.call_args.args) > 1
            else None
        )
        assert env_overrides == {"JOB_ID": job_id}

    def test_dispatch_persists_job_to_repo(self, client, repo):
        response = client.post(
            "/api/v1/jobs/dispatch", json=_measurements_payload()
        )
        job_id = response.json()["jobId"]
        # Same pytest event loop — fine to await directly via asyncio.run
        import asyncio

        job = asyncio.run(repo.get_by_id(job_id))
        assert job.status is JobStatus.QUEUED
        assert job.jobType is JobType.MEASUREMENTS
        assert job.uid == "user-1"
        assert job.leadId == "lead-1"
        assert job.budgetId == "budget-1"
        assert job.payload["gcsUri"] == "gs://b/user-1/budget-1/x.pdf"
        # Execution name attached after run_execution returned.
        assert job.currentExecutionName == EXEC_NAME

    def test_vision_extract_dispatches(self, client, executor):
        payload = _measurements_payload()
        payload["jobType"] = "vision-extract"
        payload["payload"] = {
            "pdf_url": "https://example.com/x.pdf",
            "strategy": "ANNEXED",
        }
        response = client.post("/api/v1/jobs/dispatch", json=payload)
        assert response.status_code == 202
        executor.run_execution.assert_awaited_once()

    def test_nl_budget_dispatches_without_gcsUri(self, client, executor):
        payload = {
            "jobType": "nl-budget",
            "uid": "user-1",
            "leadId": "lead-1",
            "budgetId": "budget-1",
            "payload": {"narrative": "Casa de 100m2 con 3 habitaciones"},
        }
        response = client.post("/api/v1/jobs/dispatch", json=payload)
        assert response.status_code == 202
        executor.run_execution.assert_awaited_once()


# ---------------------------------------------------------------------------
# Dispatch — validation + failure modes
# ---------------------------------------------------------------------------


class TestDispatchValidation:
    def test_missing_required_field_returns_422(self, client):
        bad = _measurements_payload()
        del bad["uid"]
        response = client.post("/api/v1/jobs/dispatch", json=bad)
        assert response.status_code == 422

    def test_unknown_job_type_returns_422(self, client):
        bad = _measurements_payload()
        bad["jobType"] = "telegrams"
        response = client.post("/api/v1/jobs/dispatch", json=bad)
        assert response.status_code == 422

    def test_measurements_without_gcsUri_returns_400(self, client):
        bad = _measurements_payload()
        bad["payload"] = {"strategy": "INLINE"}  # no gcsUri
        response = client.post("/api/v1/jobs/dispatch", json=bad)
        assert response.status_code == 400
        assert "gcsuri" in response.text.lower()

    def test_nl_budget_without_narrative_returns_400(self, client):
        response = client.post(
            "/api/v1/jobs/dispatch",
            json={
                "jobType": "nl-budget",
                "uid": "user-1",
                "leadId": "lead-1",
                "budgetId": "budget-1",
                "payload": {},  # no narrative
            },
        )
        assert response.status_code == 400
        assert "narrative" in response.text.lower()


class TestDispatchExecutorFailure:
    def test_run_execution_failure_marks_failed_and_returns_500(
        self, client, repo, executor
    ):
        executor.run_execution.side_effect = JobExecutorError(
            "Cloud Run quota exhausted"
        )
        response = client.post(
            "/api/v1/jobs/dispatch", json=_measurements_payload()
        )
        assert response.status_code == 500
        body = response.json()
        # The detail mentions the underlying cause so the operator can act.
        assert "quota" in body["detail"].lower()
        # Importantly, the job exists in Firestore in failed status so the
        # UI doesn't show a phantom "queued" job that will never run.
        job_id = body.get("jobId")
        assert job_id
        import asyncio
        job = asyncio.run(repo.get_by_id(job_id))
        assert job.status is JobStatus.FAILED
        assert "quota" in (job.errorMessage or "").lower()


# ---------------------------------------------------------------------------
# Cancel
# ---------------------------------------------------------------------------


class TestCancel:
    def _dispatch(self, client) -> str:
        response = client.post(
            "/api/v1/jobs/dispatch", json=_measurements_payload()
        )
        return response.json()["jobId"]

    def test_cancel_on_queued_sets_flag(self, client, repo, executor):
        job_id = self._dispatch(client)
        response = client.post(f"/api/v1/jobs/{job_id}/cancel")
        assert response.status_code == 200
        body = response.json()
        assert body["cancellation_requested"] is True
        # Executor.cancel_execution invoked with the executionName captured at dispatch.
        executor.cancel_execution.assert_awaited_once_with(EXEC_NAME)

    def test_cancel_on_running_sets_flag_and_calls_executor(
        self, client, repo, executor
    ):
        job_id = self._dispatch(client)
        # Simulate the worker claiming the job.
        import asyncio
        asyncio.run(repo.claim_for_attempt(job_id, attempt_id="att-1"))
        response = client.post(f"/api/v1/jobs/{job_id}/cancel")
        assert response.status_code == 200
        executor.cancel_execution.assert_awaited_once_with(EXEC_NAME)

    def test_cancel_on_completed_returns_409(self, client, repo):
        job_id = self._dispatch(client)
        import asyncio
        asyncio.run(repo.claim_for_attempt(job_id, attempt_id="att-1"))
        asyncio.run(repo.mark_completed(job_id))
        response = client.post(f"/api/v1/jobs/{job_id}/cancel")
        assert response.status_code == 409

    def test_cancel_on_unknown_job_returns_404(self, client):
        response = client.post("/api/v1/jobs/does-not-exist/cancel")
        assert response.status_code == 404

    def test_cancel_with_executor_already_terminal_is_idempotent(
        self, client, executor
    ):
        # The adapter normally swallows FAILED_PRECONDITION; if it raises
        # ExecutionNotFoundError because the execution already finished,
        # the dispatcher still returns 200 (the flag is set in Firestore
        # which is the source of truth for the UI).
        job_id = self._dispatch(client)
        executor.cancel_execution.side_effect = ExecutionNotFoundError(
            "already gone"
        )
        response = client.post(f"/api/v1/jobs/{job_id}/cancel")
        assert response.status_code == 200


# ---------------------------------------------------------------------------
# Retry
# ---------------------------------------------------------------------------


class TestRetry:
    def _dispatch_and_fail(self, client, repo) -> str:
        response = client.post(
            "/api/v1/jobs/dispatch", json=_measurements_payload()
        )
        job_id = response.json()["jobId"]
        import asyncio
        asyncio.run(repo.claim_for_attempt(job_id, attempt_id="att-1"))
        asyncio.run(
            repo.mark_failed(job_id, error_message="boom", error_type="E")
        )
        return job_id

    def test_retry_on_failed_resets_to_queued_and_restarts_execution(
        self, client, repo, executor
    ):
        job_id = self._dispatch_and_fail(client, repo)
        # New execution name for the retry
        new_exec = EXEC_NAME + "-retry"
        executor.run_execution.reset_mock()
        executor.run_execution.return_value = new_exec

        response = client.post(f"/api/v1/jobs/{job_id}/retry")
        assert response.status_code == 202
        body = response.json()
        assert body["status"] == "queued"

        # New execution kicked off
        executor.run_execution.assert_awaited_once()
        # The retry attached the NEW execution name
        import asyncio
        job = asyncio.run(repo.get_by_id(job_id))
        assert job.status is JobStatus.QUEUED
        assert job.currentExecutionName == new_exec

    def test_retry_on_running_returns_409(self, client, repo):
        # Dispatch + claim, but don't fail — job is currently running.
        response = client.post(
            "/api/v1/jobs/dispatch", json=_measurements_payload()
        )
        job_id = response.json()["jobId"]
        import asyncio
        asyncio.run(repo.claim_for_attempt(job_id, attempt_id="att-1"))
        response = client.post(f"/api/v1/jobs/{job_id}/retry")
        assert response.status_code == 409

    def test_retry_on_completed_returns_409(self, client, repo):
        response = client.post(
            "/api/v1/jobs/dispatch", json=_measurements_payload()
        )
        job_id = response.json()["jobId"]
        import asyncio
        asyncio.run(repo.claim_for_attempt(job_id, attempt_id="att-1"))
        asyncio.run(repo.mark_completed(job_id))
        response = client.post(f"/api/v1/jobs/{job_id}/retry")
        assert response.status_code == 409

    def test_retry_unknown_job_returns_404(self, client):
        response = client.post("/api/v1/jobs/does-not-exist/retry")
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# GET endpoint (UI reads this for status / attempts / progress fallback)
# ---------------------------------------------------------------------------


class TestGetJob:
    def test_get_returns_full_state(self, client, repo):
        response = client.post(
            "/api/v1/jobs/dispatch", json=_measurements_payload()
        )
        job_id = response.json()["jobId"]
        response = client.get(f"/api/v1/jobs/{job_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["jobId"] == job_id
        assert body["status"] == "queued"
        assert body["jobType"] == "measurements"
        assert body["leadId"] == "lead-1"
        assert body["budgetId"] == "budget-1"

    def test_get_unknown_returns_404(self, client):
        response = client.get("/api/v1/jobs/does-not-exist")
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# Regression: the dispatcher must NOT use FastAPI BackgroundTasks
# ---------------------------------------------------------------------------


def test_no_background_tasks_in_dispatch_router():
    """The whole rewrite exists because the legacy code used
    FastAPI BackgroundTasks, which Cloud Run kills at 3600s. Guard against
    a future contributor reintroducing it in this file.

    We check the parsed AST so the literal word `BackgroundTasks` can still
    appear in module docstrings (it does — describing what we replaced)
    without breaking the test. Only actual imports / type references count.
    """
    import ast

    from src.core.http import dispatch_router as mod

    tree = ast.parse(open(mod.__file__, encoding="utf-8").read())
    offenders: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name == "BackgroundTasks":
                    offenders.append(
                        f"import of BackgroundTasks at line {node.lineno}"
                    )
        elif isinstance(node, ast.Name) and node.id == "BackgroundTasks":
            offenders.append(f"reference to BackgroundTasks at line {node.lineno}")
        elif isinstance(node, ast.Attribute) and node.attr == "BackgroundTasks":
            offenders.append(
                f"attribute access on BackgroundTasks at line {node.lineno}"
            )
    assert not offenders, (
        "BackgroundTasks must NOT be used in dispatch_router. Found:\n"
        + "\n".join(offenders)
    )

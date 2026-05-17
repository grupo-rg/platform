"""Unit tests for CloudRunJobsExecutor.

The adapter wraps google-cloud-run's JobsClient/ExecutionsClient with the
IJobExecutor port semantics. Tests use injected mock clients — they do
NOT hit GCP — and verify:
  - The right requests are constructed (job name, env var overrides).
  - The execution name is extracted from the LRO metadata.
  - Cloud SDK exceptions are mapped to domain exceptions.
  - Status classification matches the Execution counters.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from google.api_core import exceptions as gcloud_exceptions

from src.pipeline_jobs.application.ports.job_executor import (
    ExecutionNotFoundError,
    JobExecutorError,
)
from src.pipeline_jobs.infrastructure.cloud_run_jobs_executor import (
    CloudRunJobsExecutor,
)


FULL_JOB_NAME = (
    "projects/grupo-rg-a9929/locations/europe-southwest1/jobs/ai-core-worker"
)
FULL_EXEC_NAME = FULL_JOB_NAME + "/executions/ai-core-worker-xyz12"


def _make_operation(execution_name: str) -> MagicMock:
    """Mimic google.api_core.operation.Operation. Only `metadata.name` is
    needed by the adapter — the Execution proto's name is the execution
    resource path."""
    op = MagicMock()
    op.metadata = MagicMock()
    op.metadata.name = execution_name
    return op


@pytest.fixture
def jobs_client():
    return MagicMock()


@pytest.fixture
def executions_client():
    return MagicMock()


@pytest.fixture
def executor(jobs_client, executions_client):
    return CloudRunJobsExecutor(
        jobs_client=jobs_client,
        executions_client=executions_client,
    )


# ---------------------------------------------------------------------------
# run_execution
# ---------------------------------------------------------------------------


class TestRunExecution:
    async def test_returns_execution_name_from_lro_metadata(
        self, executor, jobs_client
    ):
        jobs_client.run_job.return_value = _make_operation(FULL_EXEC_NAME)
        name = await executor.run_execution(
            FULL_JOB_NAME, env_overrides={"JOB_ID": "job-abc"}
        )
        assert name == FULL_EXEC_NAME

    async def test_calls_run_job_with_correct_request(
        self, executor, jobs_client
    ):
        jobs_client.run_job.return_value = _make_operation(FULL_EXEC_NAME)
        await executor.run_execution(
            FULL_JOB_NAME, env_overrides={"JOB_ID": "job-abc"}
        )
        jobs_client.run_job.assert_called_once()
        # The adapter passes a RunJobRequest object as `request=...`.
        kwargs = jobs_client.run_job.call_args.kwargs
        request = kwargs["request"]
        assert request.name == FULL_JOB_NAME

    async def test_env_overrides_are_included(
        self, executor, jobs_client
    ):
        jobs_client.run_job.return_value = _make_operation(FULL_EXEC_NAME)
        await executor.run_execution(
            FULL_JOB_NAME, env_overrides={"JOB_ID": "job-abc", "FOO": "bar"}
        )
        request = jobs_client.run_job.call_args.kwargs["request"]
        # Single container override with both env vars
        overrides = request.overrides.container_overrides
        assert len(overrides) == 1
        env_pairs = {ev.name: ev.value for ev in overrides[0].env}
        assert env_pairs == {"JOB_ID": "job-abc", "FOO": "bar"}

    async def test_empty_env_overrides_omits_container_overrides(
        self, executor, jobs_client
    ):
        jobs_client.run_job.return_value = _make_operation(FULL_EXEC_NAME)
        await executor.run_execution(FULL_JOB_NAME, env_overrides={})
        request = jobs_client.run_job.call_args.kwargs["request"]
        # No container override = SDK will use the Job's defaults.
        assert len(request.overrides.container_overrides) == 0

    async def test_not_found_maps_to_job_executor_error(
        self, executor, jobs_client
    ):
        jobs_client.run_job.side_effect = gcloud_exceptions.NotFound(
            "Job not found"
        )
        with pytest.raises(JobExecutorError) as exc_info:
            await executor.run_execution(
                FULL_JOB_NAME, env_overrides={"JOB_ID": "x"}
            )
        assert "not found" in str(exc_info.value).lower()

    async def test_permission_denied_maps_to_job_executor_error(
        self, executor, jobs_client
    ):
        jobs_client.run_job.side_effect = gcloud_exceptions.PermissionDenied(
            "denied"
        )
        with pytest.raises(JobExecutorError):
            await executor.run_execution(
                FULL_JOB_NAME, env_overrides={"JOB_ID": "x"}
            )

    async def test_arbitrary_gcloud_error_maps_to_job_executor_error(
        self, executor, jobs_client
    ):
        jobs_client.run_job.side_effect = gcloud_exceptions.InternalServerError(
            "internal"
        )
        with pytest.raises(JobExecutorError):
            await executor.run_execution(
                FULL_JOB_NAME, env_overrides={"JOB_ID": "x"}
            )


# ---------------------------------------------------------------------------
# cancel_execution
# ---------------------------------------------------------------------------


class TestCancelExecution:
    async def test_cancel_calls_executions_client(
        self, executor, executions_client
    ):
        executions_client.cancel_execution.return_value = MagicMock()
        await executor.cancel_execution(FULL_EXEC_NAME)
        executions_client.cancel_execution.assert_called_once()
        kwargs = executions_client.cancel_execution.call_args.kwargs
        assert kwargs["request"].name == FULL_EXEC_NAME

    async def test_cancel_not_found_maps_to_execution_not_found_error(
        self, executor, executions_client
    ):
        executions_client.cancel_execution.side_effect = (
            gcloud_exceptions.NotFound("missing")
        )
        with pytest.raises(ExecutionNotFoundError):
            await executor.cancel_execution(FULL_EXEC_NAME)

    async def test_cancel_failed_precondition_is_idempotent(
        self, executor, executions_client
    ):
        # Cloud Run returns FAILED_PRECONDITION when the execution is already
        # in a terminal state. We treat that as success (cancel is idempotent).
        executions_client.cancel_execution.side_effect = (
            gcloud_exceptions.FailedPrecondition("already completed")
        )
        # Should NOT raise.
        await executor.cancel_execution(FULL_EXEC_NAME)


# ---------------------------------------------------------------------------
# get_execution_status
# ---------------------------------------------------------------------------


def _execution(
    *,
    running: int = 0,
    succeeded: int = 0,
    failed: int = 0,
    cancelled: int = 0,
) -> MagicMock:
    exe = MagicMock()
    exe.running_count = running
    exe.succeeded_count = succeeded
    exe.failed_count = failed
    exe.cancelled_count = cancelled
    return exe


class TestGetExecutionStatus:
    async def test_running(self, executor, executions_client):
        executions_client.get_execution.return_value = _execution(running=1)
        assert await executor.get_execution_status(FULL_EXEC_NAME) == "running"

    async def test_succeeded(self, executor, executions_client):
        executions_client.get_execution.return_value = _execution(succeeded=1)
        assert (
            await executor.get_execution_status(FULL_EXEC_NAME) == "succeeded"
        )

    async def test_failed(self, executor, executions_client):
        executions_client.get_execution.return_value = _execution(failed=1)
        assert await executor.get_execution_status(FULL_EXEC_NAME) == "failed"

    async def test_canceled(self, executor, executions_client):
        executions_client.get_execution.return_value = _execution(cancelled=1)
        assert (
            await executor.get_execution_status(FULL_EXEC_NAME) == "canceled"
        )

    async def test_queued_when_no_counters(self, executor, executions_client):
        executions_client.get_execution.return_value = _execution()
        assert await executor.get_execution_status(FULL_EXEC_NAME) == "queued"

    async def test_canceled_wins_over_failed_when_both_present(
        self, executor, executions_client
    ):
        # Race: a cancel happened mid-flight. We prefer "canceled" semantics
        # so the UI doesn't show a misleading "failed" badge.
        executions_client.get_execution.return_value = _execution(
            failed=1, cancelled=1
        )
        assert (
            await executor.get_execution_status(FULL_EXEC_NAME) == "canceled"
        )

    async def test_get_status_not_found_maps_to_execution_not_found(
        self, executor, executions_client
    ):
        executions_client.get_execution.side_effect = (
            gcloud_exceptions.NotFound("missing")
        )
        with pytest.raises(ExecutionNotFoundError):
            await executor.get_execution_status(FULL_EXEC_NAME)

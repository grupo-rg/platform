"""Contract tests for IPipelineJobRepository, validated against the in-memory
adapter. These same tests should run against the Firestore adapter (with a
mocked client) to confirm both implementations honour the same contract.
"""

from __future__ import annotations

import pytest

from src.pipeline_jobs.domain.entities import (
    JobStatus,
    JobType,
    PipelineJob,
    PipelineJobCheckpoint,
)
from src.pipeline_jobs.domain.exceptions import (
    IllegalStateTransitionError,
    JobNotFoundError,
)
from src.pipeline_jobs.infrastructure.in_memory_pipeline_job_repository import (
    InMemoryPipelineJobRepository,
)


def _job(job_id: str = "job-1") -> PipelineJob:
    return PipelineJob.new(
        jobId=job_id,
        jobType=JobType.MEASUREMENTS,
        leadId="lead-1",
        budgetId="budget-1",
        uid="user-1",
        payload={"gcsUri": "gs://b/p.pdf", "strategy": "INLINE"},
    )


@pytest.fixture
def repo():
    return InMemoryPipelineJobRepository()


# ---------------------------------------------------------------------------
# create + get_by_id
# ---------------------------------------------------------------------------


class TestCreateAndGet:
    async def test_create_then_get(self, repo):
        job = _job()
        await repo.create(job)
        loaded = await repo.get_by_id(job.jobId)
        assert loaded.jobId == job.jobId
        assert loaded.status is JobStatus.QUEUED
        assert loaded.attempts == 0

    async def test_get_missing_raises(self, repo):
        with pytest.raises(JobNotFoundError):
            await repo.get_by_id("nope")

    async def test_create_duplicate_raises(self, repo):
        job = _job()
        await repo.create(job)
        with pytest.raises(ValueError):
            await repo.create(job)


# ---------------------------------------------------------------------------
# claim_for_attempt (queued → running, atomic, creates attempt doc)
# ---------------------------------------------------------------------------


class TestClaim:
    async def test_claim_returns_running_job_and_new_attempt(self, repo):
        await repo.create(_job())
        job, attempt = await repo.claim_for_attempt(
            "job-1", attempt_id="att-1", execution_name="exec-1"
        )
        assert job.status is JobStatus.RUNNING
        assert job.attempts == 1
        assert job.currentAttemptId == "att-1"
        assert attempt.attemptId == "att-1"
        assert attempt.attemptNumber == 1
        assert attempt.executionName == "exec-1"
        assert attempt.status is JobStatus.RUNNING

    async def test_claim_persists(self, repo):
        await repo.create(_job())
        await repo.claim_for_attempt("job-1", attempt_id="att-1")
        reloaded = await repo.get_by_id("job-1")
        assert reloaded.status is JobStatus.RUNNING
        assert reloaded.currentAttemptId == "att-1"

    async def test_claim_on_running_raises(self, repo):
        await repo.create(_job())
        await repo.claim_for_attempt("job-1", attempt_id="att-1")
        with pytest.raises(IllegalStateTransitionError):
            await repo.claim_for_attempt("job-1", attempt_id="att-2")

    async def test_claim_missing_raises(self, repo):
        with pytest.raises(JobNotFoundError):
            await repo.claim_for_attempt("nope", attempt_id="att-1")

    async def test_claim_with_resume_from_count(self, repo):
        await repo.create(_job())
        _, attempt = await repo.claim_for_attempt(
            "job-1", attempt_id="att-1", resume_from_count=7
        )
        assert attempt.resumeFromCount == 7


# ---------------------------------------------------------------------------
# Terminal transitions
# ---------------------------------------------------------------------------


class TestTerminalTransitions:
    async def test_mark_completed_persists(self, repo):
        await repo.create(_job())
        await repo.claim_for_attempt("job-1", attempt_id="att-1")
        await repo.mark_completed("job-1")
        reloaded = await repo.get_by_id("job-1")
        assert reloaded.status is JobStatus.COMPLETED

    async def test_mark_completed_updates_attempt(self, repo):
        await repo.create(_job())
        await repo.claim_for_attempt("job-1", attempt_id="att-1")
        await repo.mark_completed("job-1", partidas_resolved=42)
        attempt = await repo.get_attempt("job-1", "att-1")
        assert attempt.status is JobStatus.COMPLETED
        assert attempt.partidasResolved == 42

    async def test_mark_failed_persists(self, repo):
        await repo.create(_job())
        await repo.claim_for_attempt("job-1", attempt_id="att-1")
        await repo.mark_failed(
            "job-1", error_message="boom", error_type="RuntimeError"
        )
        reloaded = await repo.get_by_id("job-1")
        assert reloaded.status is JobStatus.FAILED
        assert reloaded.errorMessage == "boom"

    async def test_mark_failed_updates_attempt(self, repo):
        await repo.create(_job())
        await repo.claim_for_attempt("job-1", attempt_id="att-1")
        await repo.mark_failed(
            "job-1", error_message="boom", error_type="RuntimeError"
        )
        attempt = await repo.get_attempt("job-1", "att-1")
        assert attempt.status is JobStatus.FAILED
        assert attempt.errorMessage == "boom"

    async def test_mark_canceled_persists(self, repo):
        await repo.create(_job())
        await repo.claim_for_attempt("job-1", attempt_id="att-1")
        await repo.mark_canceled("job-1")
        reloaded = await repo.get_by_id("job-1")
        assert reloaded.status is JobStatus.CANCELED

    async def test_terminal_transition_from_queued_raises(self, repo):
        await repo.create(_job())
        with pytest.raises(IllegalStateTransitionError):
            await repo.mark_completed("job-1")


# ---------------------------------------------------------------------------
# request_cancellation (flag only, no transition)
# ---------------------------------------------------------------------------


class TestRequestCancellation:
    async def test_sets_flag_on_running(self, repo):
        await repo.create(_job())
        await repo.claim_for_attempt("job-1", attempt_id="att-1")
        await repo.request_cancellation("job-1")
        reloaded = await repo.get_by_id("job-1")
        assert reloaded.cancellation_requested is True
        assert reloaded.status is JobStatus.RUNNING

    async def test_sets_flag_on_queued(self, repo):
        # Edge case: cancel before worker claims.
        await repo.create(_job())
        await repo.request_cancellation("job-1")
        reloaded = await repo.get_by_id("job-1")
        assert reloaded.cancellation_requested is True

    async def test_request_on_terminal_raises(self, repo):
        await repo.create(_job())
        await repo.claim_for_attempt("job-1", attempt_id="att-1")
        await repo.mark_completed("job-1")
        with pytest.raises(IllegalStateTransitionError):
            await repo.request_cancellation("job-1")


# ---------------------------------------------------------------------------
# retry_for_new_attempt (failed/canceled → queued)
# ---------------------------------------------------------------------------


class TestRetry:
    async def test_retry_from_failed_returns_queued(self, repo):
        await repo.create(_job())
        await repo.claim_for_attempt("job-1", attempt_id="att-1")
        await repo.mark_failed("job-1", error_message="x", error_type="E")
        await repo.retry_for_new_attempt("job-1")
        reloaded = await repo.get_by_id("job-1")
        assert reloaded.status is JobStatus.QUEUED
        assert reloaded.errorMessage is None
        assert reloaded.cancellation_requested is False

    async def test_retry_preserves_attempts_history(self, repo):
        await repo.create(_job())
        await repo.claim_for_attempt("job-1", attempt_id="att-1")
        await repo.mark_failed("job-1", error_message="x", error_type="E")
        await repo.retry_for_new_attempt("job-1")
        await repo.claim_for_attempt("job-1", attempt_id="att-2")
        attempts = await repo.list_attempts("job-1")
        ids = sorted(a.attemptId for a in attempts)
        assert ids == ["att-1", "att-2"]

    async def test_retry_from_completed_raises(self, repo):
        await repo.create(_job())
        await repo.claim_for_attempt("job-1", attempt_id="att-1")
        await repo.mark_completed("job-1")
        with pytest.raises(IllegalStateTransitionError):
            await repo.retry_for_new_attempt("job-1")


# ---------------------------------------------------------------------------
# Checkpoints (idempotent by partidaCode)
# ---------------------------------------------------------------------------


class TestCheckpoints:
    async def test_append_checkpoint_updates_job(self, repo):
        await repo.create(_job())
        await repo.claim_for_attempt("job-1", attempt_id="att-1")
        cp = PipelineJobCheckpoint(
            partidaCode="P001",
            attemptId="att-1",
            partida={"code": "P001", "totalPrice": 10.0},
        )
        await repo.append_checkpoint("job-1", cp)
        reloaded = await repo.get_by_id("job-1")
        assert reloaded.resolvedPartidaCodes == ["P001"]
        assert reloaded.lastCheckpointCode == "P001"

    async def test_append_checkpoint_idempotent_same_code(self, repo):
        await repo.create(_job())
        await repo.claim_for_attempt("job-1", attempt_id="att-1")
        for _ in range(3):
            cp = PipelineJobCheckpoint(
                partidaCode="P001",
                attemptId="att-1",
                partida={"code": "P001"},
            )
            await repo.append_checkpoint("job-1", cp)
        reloaded = await repo.get_by_id("job-1")
        assert reloaded.resolvedPartidaCodes == ["P001"]
        checkpoints = await repo.list_checkpoints("job-1")
        assert len(checkpoints) == 1

    async def test_list_checkpoints_after_retry_preserves_resume(self, repo):
        # The whole point of checkpoint resume: a retry reads the checkpoints
        # written by the failed attempt and skips those partidas next run.
        await repo.create(_job())
        await repo.claim_for_attempt("job-1", attempt_id="att-1")
        for code in ("P001", "P002", "P003"):
            await repo.append_checkpoint(
                "job-1",
                PipelineJobCheckpoint(
                    partidaCode=code, attemptId="att-1", partida={"code": code}
                ),
            )
        await repo.mark_failed("job-1", error_message="x", error_type="E")
        await repo.retry_for_new_attempt("job-1")
        # Even after retry, checkpoints survive for resume.
        checkpoints = await repo.list_checkpoints("job-1")
        assert sorted(c.partidaCode for c in checkpoints) == ["P001", "P002", "P003"]


# ---------------------------------------------------------------------------
# touch_updated_at + execution name + attempts listing
# ---------------------------------------------------------------------------


class TestMaintenance:
    async def test_touch_updated_at_bumps_timestamp(self, repo):
        await repo.create(_job())
        before = (await repo.get_by_id("job-1")).updatedAt
        await repo.touch_updated_at("job-1")
        after = (await repo.get_by_id("job-1")).updatedAt
        assert after >= before

    async def test_attach_execution_name_persists(self, repo):
        await repo.create(_job())
        await repo.attach_execution_name("job-1", "exec-name-xyz")
        reloaded = await repo.get_by_id("job-1")
        assert reloaded.currentExecutionName == "exec-name-xyz"

    async def test_list_attempts_orders_by_number(self, repo):
        await repo.create(_job())
        await repo.claim_for_attempt("job-1", attempt_id="att-1")
        await repo.mark_failed("job-1", error_message="x", error_type="E")
        await repo.retry_for_new_attempt("job-1")
        await repo.claim_for_attempt("job-1", attempt_id="att-2")
        attempts = await repo.list_attempts("job-1")
        numbers = [a.attemptNumber for a in attempts]
        assert numbers == sorted(numbers)
        assert numbers == [1, 2]

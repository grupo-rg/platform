"""Domain tests for the `pipeline_jobs` bounded context.

These are pure unit tests: no Firestore, no I/O, no LLM. They drive the
design of the state machine that any repository adapter must respect.

Background (see plan vmaos-a-resolverlo-de-quiet-narwhal.md):
A PipelineJob represents one execution of a long-running budget pipeline
running on Cloud Run Jobs. It can be retried with checkpoint resume after
failure or cancellation. The state transitions are the safety net that
prevents the old silent-cancellation bug from coming back disguised.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from src.pipeline_jobs.domain.entities import (
    JobStatus,
    JobType,
    PipelineJob,
    PipelineJobAttempt,
    PipelineJobCheckpoint,
)
from src.pipeline_jobs.domain.exceptions import IllegalStateTransitionError


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class TestJobStatusEnum:
    def test_all_expected_values_present(self):
        assert {s.value for s in JobStatus} == {
            "queued",
            "running",
            "completed",
            "failed",
            "canceled",
        }

    def test_terminal_statuses(self):
        assert JobStatus.COMPLETED.is_terminal()
        assert JobStatus.FAILED.is_terminal()
        assert JobStatus.CANCELED.is_terminal()
        assert not JobStatus.QUEUED.is_terminal()
        assert not JobStatus.RUNNING.is_terminal()


class TestJobTypeEnum:
    def test_all_expected_values_present(self):
        assert {t.value for t in JobType} == {
            "measurements",
            "vision-extract",
            "nl-budget",
        }


# ---------------------------------------------------------------------------
# PipelineJob construction
# ---------------------------------------------------------------------------


def _new_job(**overrides) -> PipelineJob:
    defaults = dict(
        jobId="job-abc",
        jobType=JobType.MEASUREMENTS,
        leadId="lead-1",
        budgetId="budget-1",
        uid="user-1",
        payload={"gcsUri": "gs://bucket/uploads/user-1/job-abc/x.pdf",
                 "strategy": "INLINE"},
    )
    defaults.update(overrides)
    return PipelineJob.new(**defaults)


class TestPipelineJobConstruction:
    def test_new_job_starts_queued(self):
        job = _new_job()
        assert job.status is JobStatus.QUEUED
        assert job.attempts == 0
        assert job.currentAttemptId is None
        assert job.cancellation_requested is False
        assert job.resolvedPartidaCodes == []
        assert job.lastCheckpointCode is None
        assert job.errorMessage is None
        assert job.errorType is None

    def test_new_job_timestamps(self):
        before = datetime.utcnow()
        job = _new_job()
        after = datetime.utcnow()
        assert before <= job.createdAt <= after
        assert job.updatedAt == job.createdAt
        assert job.startedAt is None
        assert job.finishedAt is None

    def test_payload_is_jobtype_specific(self):
        nl = _new_job(jobType=JobType.NL_BUDGET, payload={"narrative": "casa de 100m2"})
        assert nl.payload == {"narrative": "casa de 100m2"}


# ---------------------------------------------------------------------------
# Invariants for non-terminal states
# ---------------------------------------------------------------------------


class TestPipelineJobInvariants:
    def test_queued_job_has_no_finishedAt(self):
        job = _new_job()
        assert job.finishedAt is None

    def test_completed_job_must_have_finishedAt(self):
        job = _new_job().claim_for_attempt(attempt_id="att-1").mark_completed()
        assert job.finishedAt is not None
        assert job.status is JobStatus.COMPLETED

    def test_failed_job_must_have_finishedAt_and_error(self):
        job = (
            _new_job()
            .claim_for_attempt("att-1")
            .mark_failed(error_message="boom", error_type="RuntimeError")
        )
        assert job.finishedAt is not None
        assert job.errorMessage == "boom"
        assert job.errorType == "RuntimeError"


# ---------------------------------------------------------------------------
# State transitions
# ---------------------------------------------------------------------------


class TestPipelineJobTransitions:
    # ----- claim_for_attempt (queued → running) -----

    def test_claim_transitions_queued_to_running(self):
        job = _new_job()
        claimed = job.claim_for_attempt(attempt_id="att-1")
        assert claimed.status is JobStatus.RUNNING
        assert claimed.currentAttemptId == "att-1"
        assert claimed.attempts == 1
        assert claimed.startedAt is not None

    def test_claim_updates_updatedAt(self):
        job = _new_job()
        # Mutate updatedAt backwards to detect refresh
        job.updatedAt = datetime.utcnow() - timedelta(seconds=10)
        claimed = job.claim_for_attempt("att-1")
        assert claimed.updatedAt > job.updatedAt

    def test_claim_on_non_queued_raises(self):
        job = _new_job().claim_for_attempt("att-1")
        with pytest.raises(IllegalStateTransitionError):
            job.claim_for_attempt("att-2")

    def test_claim_on_completed_raises(self):
        job = _new_job().claim_for_attempt("att-1").mark_completed()
        with pytest.raises(IllegalStateTransitionError):
            job.claim_for_attempt("att-2")

    # ----- mark_completed (running → completed) -----

    def test_mark_completed_from_running(self):
        job = _new_job().claim_for_attempt("att-1").mark_completed()
        assert job.status is JobStatus.COMPLETED
        assert job.finishedAt is not None

    def test_mark_completed_from_queued_raises(self):
        with pytest.raises(IllegalStateTransitionError):
            _new_job().mark_completed()

    # ----- mark_failed (running → failed) -----

    def test_mark_failed_from_running(self):
        job = (
            _new_job()
            .claim_for_attempt("att-1")
            .mark_failed(error_message="x", error_type="E")
        )
        assert job.status is JobStatus.FAILED
        assert job.finishedAt is not None

    def test_mark_failed_from_queued_raises(self):
        with pytest.raises(IllegalStateTransitionError):
            _new_job().mark_failed(error_message="x", error_type="E")

    # ----- mark_canceled (running → canceled) -----

    def test_mark_canceled_from_running(self):
        job = _new_job().claim_for_attempt("att-1").mark_canceled()
        assert job.status is JobStatus.CANCELED
        assert job.finishedAt is not None

    def test_mark_canceled_from_queued_raises(self):
        with pytest.raises(IllegalStateTransitionError):
            _new_job().mark_canceled()

    # ----- request_cancellation (sets flag, no transition) -----

    def test_request_cancellation_on_running_sets_flag(self):
        job = _new_job().claim_for_attempt("att-1").request_cancellation()
        assert job.cancellation_requested is True
        assert job.status is JobStatus.RUNNING  # unchanged

    def test_request_cancellation_on_queued_sets_flag(self):
        # Edge case: user cancels before worker claims. Flag set, status unchanged.
        job = _new_job().request_cancellation()
        assert job.cancellation_requested is True
        assert job.status is JobStatus.QUEUED

    def test_request_cancellation_on_terminal_raises(self):
        job = _new_job().claim_for_attempt("att-1").mark_completed()
        with pytest.raises(IllegalStateTransitionError):
            job.request_cancellation()

    # ----- retry (failed/canceled → queued) -----

    def test_retry_from_failed_returns_to_queued(self):
        job = (
            _new_job()
            .claim_for_attempt("att-1")
            .mark_failed(error_message="x", error_type="E")
            .retry_for_new_attempt()
        )
        assert job.status is JobStatus.QUEUED
        assert job.errorMessage is None
        assert job.errorType is None
        assert job.finishedAt is None
        assert job.cancellation_requested is False
        # Attempts counter is bumped by the next claim, not by retry itself.
        # Resume state (checkpoints) is preserved.
        assert job.attempts == 1
        assert job.currentAttemptId is None

    def test_retry_from_canceled_returns_to_queued(self):
        job = (
            _new_job()
            .claim_for_attempt("att-1")
            .mark_canceled()
            .retry_for_new_attempt()
        )
        assert job.status is JobStatus.QUEUED
        assert job.cancellation_requested is False

    def test_retry_from_completed_raises(self):
        job = _new_job().claim_for_attempt("att-1").mark_completed()
        with pytest.raises(IllegalStateTransitionError):
            job.retry_for_new_attempt()

    def test_retry_from_running_raises(self):
        job = _new_job().claim_for_attempt("att-1")
        with pytest.raises(IllegalStateTransitionError):
            job.retry_for_new_attempt()

    def test_retry_preserves_resolved_partidas(self):
        job = (
            _new_job()
            .claim_for_attempt("att-1")
            .with_resolved_partida_code("P001")
            .with_resolved_partida_code("P002")
            .mark_failed(error_message="x", error_type="E")
            .retry_for_new_attempt()
        )
        assert job.resolvedPartidaCodes == ["P001", "P002"]
        assert job.lastCheckpointCode == "P002"

    def test_subsequent_claim_after_retry_bumps_attempts(self):
        job = (
            _new_job()
            .claim_for_attempt("att-1")
            .mark_failed(error_message="x", error_type="E")
            .retry_for_new_attempt()
            .claim_for_attempt("att-2")
        )
        assert job.attempts == 2
        assert job.currentAttemptId == "att-2"


# ---------------------------------------------------------------------------
# Capability queries (can_*)
# ---------------------------------------------------------------------------


class TestCapabilityQueries:
    def test_can_claim_only_when_queued(self):
        assert _new_job().can_claim() is True
        running = _new_job().claim_for_attempt("att-1")
        assert running.can_claim() is False
        assert running.mark_completed().can_claim() is False

    def test_can_cancel_only_when_running_and_not_already_requested(self):
        queued = _new_job()
        running = queued.claim_for_attempt("att-1")
        assert running.can_cancel() is True
        # Once requested, can_cancel becomes False (idempotency for UI).
        assert running.request_cancellation().can_cancel() is False
        assert queued.can_cancel() is False  # not yet running
        assert running.mark_completed().can_cancel() is False

    def test_can_retry_only_when_failed_or_canceled(self):
        assert _new_job().can_retry() is False  # queued
        assert _new_job().claim_for_attempt("att-1").can_retry() is False  # running
        assert (
            _new_job()
            .claim_for_attempt("att-1")
            .mark_failed(error_message="x", error_type="E")
            .can_retry()
        ) is True
        assert (
            _new_job().claim_for_attempt("att-1").mark_canceled().can_retry()
        ) is True
        assert (
            _new_job().claim_for_attempt("att-1").mark_completed().can_retry()
        ) is False


# ---------------------------------------------------------------------------
# Checkpoint accumulation
# ---------------------------------------------------------------------------


class TestExecutionNameAttachment:
    def test_new_job_has_no_execution_name(self):
        assert _new_job().currentExecutionName is None

    def test_attach_execution_name_sets_field(self):
        job = _new_job().attach_execution_name(
            "projects/p/locations/l/jobs/ai-core-worker/executions/exec-x"
        )
        assert (
            job.currentExecutionName
            == "projects/p/locations/l/jobs/ai-core-worker/executions/exec-x"
        )

    def test_retry_clears_execution_name(self):
        job = (
            _new_job()
            .attach_execution_name("exec-1")
            .claim_for_attempt("att-1")
            .mark_failed(error_message="x", error_type="E")
            .retry_for_new_attempt()
        )
        assert job.currentExecutionName is None

    def test_attach_execution_name_on_terminal_raises(self):
        job = _new_job().claim_for_attempt("att-1").mark_completed()
        with pytest.raises(IllegalStateTransitionError):
            job.attach_execution_name("exec-x")


class TestDispatchFailure:
    def test_mark_dispatch_failed_from_queued(self):
        job = _new_job().mark_dispatch_failed(
            error_message="Cloud Run quota exhausted",
            error_type="JobExecutorError",
        )
        assert job.status is JobStatus.FAILED
        assert job.errorMessage == "Cloud Run quota exhausted"
        assert job.errorType == "JobExecutorError"
        assert job.finishedAt is not None

    def test_mark_dispatch_failed_from_running_raises(self):
        job = _new_job().claim_for_attempt("att-1")
        with pytest.raises(IllegalStateTransitionError):
            job.mark_dispatch_failed(error_message="x", error_type="E")

    def test_mark_dispatch_failed_from_completed_raises(self):
        job = _new_job().claim_for_attempt("att-1").mark_completed()
        with pytest.raises(IllegalStateTransitionError):
            job.mark_dispatch_failed(error_message="x", error_type="E")


class TestCheckpointAccumulation:
    def test_with_resolved_partida_code_appends_and_updates_last(self):
        job = (
            _new_job()
            .claim_for_attempt("att-1")
            .with_resolved_partida_code("P001")
        )
        assert job.resolvedPartidaCodes == ["P001"]
        assert job.lastCheckpointCode == "P001"

    def test_with_resolved_partida_code_is_idempotent_on_same_code(self):
        job = (
            _new_job()
            .claim_for_attempt("att-1")
            .with_resolved_partida_code("P001")
            .with_resolved_partida_code("P001")
        )
        assert job.resolvedPartidaCodes == ["P001"]

    def test_resolve_partida_on_non_running_raises(self):
        job = _new_job()
        with pytest.raises(IllegalStateTransitionError):
            job.with_resolved_partida_code("P001")


# ---------------------------------------------------------------------------
# PipelineJobAttempt
# ---------------------------------------------------------------------------


class TestPipelineJobAttempt:
    def test_new_attempt_defaults(self):
        att = PipelineJobAttempt.new(
            attempt_id="att-1",
            attempt_number=1,
            resume_from_count=0,
        )
        assert att.attemptId == "att-1"
        assert att.attemptNumber == 1
        assert att.status is JobStatus.RUNNING
        assert att.startedAt is not None
        assert att.endedAt is None
        assert att.errorMessage is None
        assert att.partidasResolved == 0
        assert att.resumeFromCount == 0
        assert att.executionName is None

    def test_attempt_with_execution_name(self):
        att = PipelineJobAttempt.new(
            attempt_id="att-1",
            attempt_number=1,
            resume_from_count=3,
            execution_name="projects/p/locations/l/jobs/j/executions/exec-x",
        )
        assert (
            att.executionName
            == "projects/p/locations/l/jobs/j/executions/exec-x"
        )
        assert att.resumeFromCount == 3

    def test_mark_completed(self):
        att = PipelineJobAttempt.new(
            attempt_id="a", attempt_number=1, resume_from_count=0
        ).mark_completed(partidas_resolved=42)
        assert att.status is JobStatus.COMPLETED
        assert att.endedAt is not None
        assert att.partidasResolved == 42

    def test_mark_failed(self):
        att = PipelineJobAttempt.new(
            attempt_id="a", attempt_number=1, resume_from_count=0
        ).mark_failed(error_message="boom")
        assert att.status is JobStatus.FAILED
        assert att.endedAt is not None
        assert att.errorMessage == "boom"

    def test_mark_canceled(self):
        att = PipelineJobAttempt.new(
            attempt_id="a", attempt_number=1, resume_from_count=0
        ).mark_canceled()
        assert att.status is JobStatus.CANCELED
        assert att.endedAt is not None


# ---------------------------------------------------------------------------
# PipelineJobCheckpoint
# ---------------------------------------------------------------------------


class TestPipelineJobCheckpoint:
    def test_checkpoint_construction(self):
        cp = PipelineJobCheckpoint(
            partidaCode="P001",
            attemptId="att-1",
            partida={"code": "P001", "description": "Demolición", "totalPrice": 100.0},
            tokenCost=12.5,
        )
        assert cp.partidaCode == "P001"
        assert cp.attemptId == "att-1"
        assert cp.partida["code"] == "P001"
        assert cp.tokenCost == 12.5
        assert cp.resolvedAt is not None

    def test_checkpoint_doc_id_equals_partida_code(self):
        # Domain invariant for Firestore idempotency: the partidaCode IS the doc id.
        cp = PipelineJobCheckpoint(
            partidaCode="P-XYZ", attemptId="att-1", partida={"code": "P-XYZ"}
        )
        assert cp.doc_id() == "P-XYZ"

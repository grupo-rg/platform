"""Domain entities for the pipeline_jobs bounded context.

PipelineJob models one execution of a long-running budget pipeline that
runs in Cloud Run Jobs (not in the Cloud Run Service request lifecycle).
State transitions are enforced by methods that return a new instance —
mutations go through the methods so the repository writes a consistent
snapshot, and illegal transitions raise IllegalStateTransitionError
instead of failing silently the way the old BackgroundTasks code did.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field

from src.pipeline_jobs.domain.exceptions import IllegalStateTransitionError


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELED = "canceled"

    def is_terminal(self) -> bool:
        return self in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELED)


class JobType(str, Enum):
    MEASUREMENTS = "measurements"
    VISION_EXTRACT = "vision-extract"
    NL_BUDGET = "nl-budget"


class PipelineJob(BaseModel):
    jobId: str
    jobType: JobType
    status: JobStatus = JobStatus.QUEUED
    leadId: str
    budgetId: str
    uid: str
    payload: dict[str, Any] = Field(default_factory=dict)
    attempts: int = 0
    currentAttemptId: Optional[str] = None
    cancellation_requested: bool = False
    resolvedPartidaCodes: list[str] = Field(default_factory=list)
    lastCheckpointCode: Optional[str] = None
    currentExecutionName: Optional[str] = None
    errorMessage: Optional[str] = None
    errorType: Optional[str] = None
    createdAt: datetime
    updatedAt: datetime
    startedAt: Optional[datetime] = None
    finishedAt: Optional[datetime] = None

    # ------------------------------------------------------------------
    # Factories
    # ------------------------------------------------------------------

    @classmethod
    def new(
        cls,
        *,
        jobId: str,
        jobType: JobType,
        leadId: str,
        budgetId: str,
        uid: str,
        payload: dict[str, Any],
    ) -> "PipelineJob":
        now = datetime.utcnow()
        return cls(
            jobId=jobId,
            jobType=jobType,
            leadId=leadId,
            budgetId=budgetId,
            uid=uid,
            payload=payload,
            createdAt=now,
            updatedAt=now,
        )

    # ------------------------------------------------------------------
    # Capability queries
    # ------------------------------------------------------------------

    def can_claim(self) -> bool:
        return self.status is JobStatus.QUEUED

    def can_cancel(self) -> bool:
        return self.status is JobStatus.RUNNING and not self.cancellation_requested

    def can_retry(self) -> bool:
        return self.status in (JobStatus.FAILED, JobStatus.CANCELED)

    # ------------------------------------------------------------------
    # Transitions — each returns a NEW instance with updatedAt refreshed
    # ------------------------------------------------------------------

    def claim_for_attempt(self, attempt_id: str) -> "PipelineJob":
        if not self.can_claim():
            raise IllegalStateTransitionError(
                f"Cannot claim job {self.jobId} from status {self.status}"
            )
        return self._replace(
            status=JobStatus.RUNNING,
            currentAttemptId=attempt_id,
            attempts=self.attempts + 1,
            startedAt=self.startedAt or datetime.utcnow(),
        )

    def mark_completed(self) -> "PipelineJob":
        if self.status is not JobStatus.RUNNING:
            raise IllegalStateTransitionError(
                f"Cannot complete job {self.jobId} from status {self.status}"
            )
        return self._replace(status=JobStatus.COMPLETED, finishedAt=datetime.utcnow())

    def mark_failed(self, *, error_message: str, error_type: str) -> "PipelineJob":
        if self.status is not JobStatus.RUNNING:
            raise IllegalStateTransitionError(
                f"Cannot fail job {self.jobId} from status {self.status}"
            )
        return self._replace(
            status=JobStatus.FAILED,
            finishedAt=datetime.utcnow(),
            errorMessage=error_message,
            errorType=error_type,
        )

    def mark_canceled(self) -> "PipelineJob":
        if self.status is not JobStatus.RUNNING:
            raise IllegalStateTransitionError(
                f"Cannot cancel job {self.jobId} from status {self.status}"
            )
        return self._replace(
            status=JobStatus.CANCELED, finishedAt=datetime.utcnow()
        )

    def request_cancellation(self) -> "PipelineJob":
        if self.status.is_terminal():
            raise IllegalStateTransitionError(
                f"Cannot request cancellation on terminal job {self.jobId} "
                f"(status={self.status})"
            )
        return self._replace(cancellation_requested=True)

    def retry_for_new_attempt(self) -> "PipelineJob":
        if not self.can_retry():
            raise IllegalStateTransitionError(
                f"Cannot retry job {self.jobId} from status {self.status}"
            )
        return self._replace(
            status=JobStatus.QUEUED,
            errorMessage=None,
            errorType=None,
            finishedAt=None,
            cancellation_requested=False,
            currentAttemptId=None,
            currentExecutionName=None,
        )

    def attach_execution_name(self, execution_name: str) -> "PipelineJob":
        if self.status.is_terminal():
            raise IllegalStateTransitionError(
                f"Cannot attach execution name to terminal job {self.jobId} "
                f"(status={self.status})"
            )
        return self._replace(currentExecutionName=execution_name)

    def mark_dispatch_failed(
        self, *, error_message: str, error_type: str
    ) -> "PipelineJob":
        """Transition queued → failed. Used by the dispatcher when
        `executor.run_execution` raises BEFORE the worker ever starts —
        otherwise the job would be stuck in `queued` forever. Distinct from
        `mark_failed` (which is running → failed) so the state machine
        invariant stays unambiguous."""
        if self.status is not JobStatus.QUEUED:
            raise IllegalStateTransitionError(
                f"Cannot mark dispatch_failed on job {self.jobId} "
                f"(status={self.status}; expected queued)"
            )
        return self._replace(
            status=JobStatus.FAILED,
            finishedAt=datetime.utcnow(),
            errorMessage=error_message,
            errorType=error_type,
        )

    def with_resolved_partida_code(self, code: str) -> "PipelineJob":
        if self.status is not JobStatus.RUNNING:
            raise IllegalStateTransitionError(
                f"Cannot append checkpoint to non-running job {self.jobId} "
                f"(status={self.status})"
            )
        if code in self.resolvedPartidaCodes:
            return self._replace()
        return self._replace(
            resolvedPartidaCodes=self.resolvedPartidaCodes + [code],
            lastCheckpointCode=code,
        )

    # ------------------------------------------------------------------
    # Internal — single source of truth for "any mutation bumps updatedAt"
    # ------------------------------------------------------------------

    def _replace(self, **changes: Any) -> "PipelineJob":
        return self.model_copy(update={**changes, "updatedAt": datetime.utcnow()})


class PipelineJobAttempt(BaseModel):
    attemptId: str
    attemptNumber: int
    status: JobStatus = JobStatus.RUNNING
    startedAt: datetime
    endedAt: Optional[datetime] = None
    errorMessage: Optional[str] = None
    partidasResolved: int = 0
    resumeFromCount: int = 0
    executionName: Optional[str] = None

    @classmethod
    def new(
        cls,
        *,
        attempt_id: str,
        attempt_number: int,
        resume_from_count: int,
        execution_name: Optional[str] = None,
    ) -> "PipelineJobAttempt":
        return cls(
            attemptId=attempt_id,
            attemptNumber=attempt_number,
            resumeFromCount=resume_from_count,
            executionName=execution_name,
            startedAt=datetime.utcnow(),
        )

    def mark_completed(self, *, partidas_resolved: int) -> "PipelineJobAttempt":
        return self.model_copy(
            update={
                "status": JobStatus.COMPLETED,
                "endedAt": datetime.utcnow(),
                "partidasResolved": partidas_resolved,
            }
        )

    def mark_failed(self, *, error_message: str) -> "PipelineJobAttempt":
        return self.model_copy(
            update={
                "status": JobStatus.FAILED,
                "endedAt": datetime.utcnow(),
                "errorMessage": error_message,
            }
        )

    def mark_canceled(self) -> "PipelineJobAttempt":
        return self.model_copy(
            update={"status": JobStatus.CANCELED, "endedAt": datetime.utcnow()}
        )


class PipelineJobCheckpoint(BaseModel):
    partidaCode: str
    attemptId: str
    partida: dict[str, Any]
    resolvedAt: datetime = Field(default_factory=datetime.utcnow)
    tokenCost: float = 0.0

    def doc_id(self) -> str:
        """Firestore doc id is the partida code — natural idempotency: two
        writes of the same checkpoint converge to one document."""
        return self.partidaCode

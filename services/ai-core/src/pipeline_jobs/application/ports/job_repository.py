"""Port that defines the contract any PipelineJob repository must honour.

The use case `RunPipelineJobUseCase` and the HTTP dispatcher both depend on
this port — never on a concrete Firestore adapter. That keeps the orchestration
testable end-to-end with `InMemoryPipelineJobRepository` and reserves Firestore
quirks (transactions, server timestamps) to the adapter layer.

Every state-mutating method MUST be atomic in the concrete adapter — i.e.
implement read-modify-write under a Firestore transaction — to honour the
state machine encoded in `PipelineJob`. The in-memory adapter is single-threaded
by construction so atomicity is trivial there.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from src.pipeline_jobs.domain.entities import (
    PipelineJob,
    PipelineJobAttempt,
    PipelineJobCheckpoint,
)


class IPipelineJobRepository(ABC):
    # -- Read ---------------------------------------------------------

    @abstractmethod
    async def get_by_id(self, job_id: str) -> PipelineJob:
        """Returns the job. Raises JobNotFoundError if missing."""

    @abstractmethod
    async def get_attempt(self, job_id: str, attempt_id: str) -> PipelineJobAttempt:
        ...

    @abstractmethod
    async def list_attempts(self, job_id: str) -> list[PipelineJobAttempt]:
        """Ordered by attemptNumber ascending."""

    @abstractmethod
    async def list_checkpoints(self, job_id: str) -> list[PipelineJobCheckpoint]:
        """All checkpoints across all attempts. Used to build `resume_from`."""

    # -- Lifecycle ----------------------------------------------------

    @abstractmethod
    async def create(self, job: PipelineJob) -> None:
        """Persist a brand-new job. Raises ValueError if id already exists."""

    @abstractmethod
    async def claim_for_attempt(
        self,
        job_id: str,
        *,
        attempt_id: str,
        execution_name: Optional[str] = None,
        resume_from_count: int = 0,
    ) -> tuple[PipelineJob, PipelineJobAttempt]:
        """Atomic queued→running transition that ALSO creates the attempt doc.
        Raises IllegalStateTransitionError if status != queued."""

    @abstractmethod
    async def mark_completed(
        self, job_id: str, *, partidas_resolved: int = 0
    ) -> PipelineJob:
        """Atomic running→completed. Also updates the current attempt to
        completed with partidas_resolved."""

    @abstractmethod
    async def mark_failed(
        self, job_id: str, *, error_message: str, error_type: str
    ) -> PipelineJob:
        """Atomic running→failed. Also updates the current attempt."""

    @abstractmethod
    async def mark_canceled(self, job_id: str) -> PipelineJob:
        """Atomic running→canceled. Also updates the current attempt."""

    @abstractmethod
    async def request_cancellation(self, job_id: str) -> PipelineJob:
        """Sets cancellation_requested=true. No status change. Raises if
        status is terminal."""

    @abstractmethod
    async def retry_for_new_attempt(self, job_id: str) -> PipelineJob:
        """failed|canceled → queued. Preserves checkpoints. Clears error and
        currentExecutionName. Raises IllegalStateTransitionError otherwise."""

    @abstractmethod
    async def attach_execution_name(
        self, job_id: str, execution_name: str
    ) -> PipelineJob:
        """Set by the dispatcher AFTER calling run_execution. The cancel
        endpoint reads this to call Cloud Run Jobs cancel API."""

    @abstractmethod
    async def mark_dispatch_failed(
        self, job_id: str, *, error_message: str, error_type: str
    ) -> PipelineJob:
        """Transition queued → failed when the dispatcher itself failed to
        start the Cloud Run Jobs execution. No attempt has been created at
        this point — the job goes terminal without ever running."""

    # -- Checkpoints --------------------------------------------------

    @abstractmethod
    async def append_checkpoint(
        self, job_id: str, checkpoint: PipelineJobCheckpoint
    ) -> None:
        """Idempotent on partidaCode. Also bumps lastCheckpointCode + appends
        to resolvedPartidaCodes on the job (unique)."""

    # -- Maintenance --------------------------------------------------

    @abstractmethod
    async def touch_updated_at(self, job_id: str) -> None:
        """Heartbeat. Minimal write. Used by the worker every 30s to signal
        liveness to Cloud Monitoring stuck-job alerts."""

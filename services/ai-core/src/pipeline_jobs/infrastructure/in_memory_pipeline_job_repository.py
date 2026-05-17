"""In-memory adapter for `IPipelineJobRepository`.

Used in tests for use cases and the dispatcher endpoint, where wiring real
Firestore would be heavy and the goal is to validate orchestration. Production
flows always use `FirestorePipelineJobRepository`.

Concurrency: tests run single-threaded under pytest-asyncio, so the dict
mutations are safe without locking. Do not use in production.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from src.pipeline_jobs.application.ports.job_repository import IPipelineJobRepository
from src.pipeline_jobs.domain.entities import (
    JobStatus,
    PipelineJob,
    PipelineJobAttempt,
    PipelineJobCheckpoint,
)
from src.pipeline_jobs.domain.exceptions import JobNotFoundError


class InMemoryPipelineJobRepository(IPipelineJobRepository):
    def __init__(self) -> None:
        self._jobs: dict[str, PipelineJob] = {}
        self._attempts: dict[str, dict[str, PipelineJobAttempt]] = {}
        self._checkpoints: dict[str, dict[str, PipelineJobCheckpoint]] = {}

    # -- Read ---------------------------------------------------------

    async def get_by_id(self, job_id: str) -> PipelineJob:
        if job_id not in self._jobs:
            raise JobNotFoundError(f"PipelineJob {job_id} not found")
        return self._jobs[job_id]

    async def get_attempt(self, job_id: str, attempt_id: str) -> PipelineJobAttempt:
        attempts = self._attempts.get(job_id, {})
        if attempt_id not in attempts:
            raise JobNotFoundError(
                f"Attempt {attempt_id} not found for job {job_id}"
            )
        return attempts[attempt_id]

    async def list_attempts(self, job_id: str) -> list[PipelineJobAttempt]:
        if job_id not in self._jobs:
            raise JobNotFoundError(f"PipelineJob {job_id} not found")
        return sorted(
            self._attempts.get(job_id, {}).values(),
            key=lambda a: a.attemptNumber,
        )

    async def list_checkpoints(self, job_id: str) -> list[PipelineJobCheckpoint]:
        if job_id not in self._jobs:
            raise JobNotFoundError(f"PipelineJob {job_id} not found")
        return list(self._checkpoints.get(job_id, {}).values())

    # -- Lifecycle ----------------------------------------------------

    async def create(self, job: PipelineJob) -> None:
        if job.jobId in self._jobs:
            raise ValueError(f"PipelineJob {job.jobId} already exists")
        self._jobs[job.jobId] = job
        self._attempts.setdefault(job.jobId, {})
        self._checkpoints.setdefault(job.jobId, {})

    async def claim_for_attempt(
        self,
        job_id: str,
        *,
        attempt_id: str,
        execution_name: Optional[str] = None,
        resume_from_count: int = 0,
    ) -> tuple[PipelineJob, PipelineJobAttempt]:
        job = await self.get_by_id(job_id)
        new_job = job.claim_for_attempt(attempt_id)  # raises if illegal
        attempt = PipelineJobAttempt.new(
            attempt_id=attempt_id,
            attempt_number=new_job.attempts,
            resume_from_count=resume_from_count,
            execution_name=execution_name or job.currentExecutionName,
        )
        # Single-step commit (atomic by construction here).
        self._jobs[job_id] = new_job
        self._attempts[job_id][attempt_id] = attempt
        return new_job, attempt

    async def mark_completed(
        self, job_id: str, *, partidas_resolved: int = 0
    ) -> PipelineJob:
        job = await self.get_by_id(job_id)
        new_job = job.mark_completed()
        self._jobs[job_id] = new_job
        if job.currentAttemptId:
            att = self._attempts[job_id].get(job.currentAttemptId)
            if att is not None:
                self._attempts[job_id][job.currentAttemptId] = att.mark_completed(
                    partidas_resolved=partidas_resolved
                )
        return new_job

    async def mark_failed(
        self, job_id: str, *, error_message: str, error_type: str
    ) -> PipelineJob:
        job = await self.get_by_id(job_id)
        new_job = job.mark_failed(error_message=error_message, error_type=error_type)
        self._jobs[job_id] = new_job
        if job.currentAttemptId:
            att = self._attempts[job_id].get(job.currentAttemptId)
            if att is not None:
                self._attempts[job_id][job.currentAttemptId] = att.mark_failed(
                    error_message=error_message
                )
        return new_job

    async def mark_canceled(self, job_id: str) -> PipelineJob:
        job = await self.get_by_id(job_id)
        new_job = job.mark_canceled()
        self._jobs[job_id] = new_job
        if job.currentAttemptId:
            att = self._attempts[job_id].get(job.currentAttemptId)
            if att is not None:
                self._attempts[job_id][job.currentAttemptId] = att.mark_canceled()
        return new_job

    async def request_cancellation(self, job_id: str) -> PipelineJob:
        job = await self.get_by_id(job_id)
        new_job = job.request_cancellation()
        self._jobs[job_id] = new_job
        return new_job

    async def retry_for_new_attempt(self, job_id: str) -> PipelineJob:
        job = await self.get_by_id(job_id)
        new_job = job.retry_for_new_attempt()
        self._jobs[job_id] = new_job
        return new_job

    async def attach_execution_name(
        self, job_id: str, execution_name: str
    ) -> PipelineJob:
        job = await self.get_by_id(job_id)
        new_job = job.attach_execution_name(execution_name)
        self._jobs[job_id] = new_job
        return new_job

    async def mark_dispatch_failed(
        self, job_id: str, *, error_message: str, error_type: str
    ) -> PipelineJob:
        job = await self.get_by_id(job_id)
        new_job = job.mark_dispatch_failed(
            error_message=error_message, error_type=error_type
        )
        self._jobs[job_id] = new_job
        return new_job

    # -- Checkpoints --------------------------------------------------

    async def append_checkpoint(
        self, job_id: str, checkpoint: PipelineJobCheckpoint
    ) -> None:
        job = await self.get_by_id(job_id)
        # Idempotency: doc id = partidaCode → overwriting a same-code write is a no-op.
        existing = self._checkpoints[job_id].get(checkpoint.partidaCode)
        self._checkpoints[job_id][checkpoint.partidaCode] = checkpoint
        if existing is None:
            new_job = job.with_resolved_partida_code(checkpoint.partidaCode)
            self._jobs[job_id] = new_job

    # -- Maintenance --------------------------------------------------

    async def touch_updated_at(self, job_id: str) -> None:
        job = await self.get_by_id(job_id)
        self._jobs[job_id] = job.model_copy(update={"updatedAt": datetime.utcnow()})

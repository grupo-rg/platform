"""Firestore implementation of IPipelineJobRepository.

Layout in Firestore (collection paths):

  pipeline_jobs/{jobId}                              — the root doc
  pipeline_jobs/{jobId}/attempts/{attemptId}         — attempt history
  pipeline_jobs/{jobId}/checkpoints/{partidaCode}    — checkpoint per partida
                                                       (doc id = partida code,
                                                       making idempotency trivial)

The whole adapter is sync underneath (firebase-admin doesn't ship an
async client) so every public method wraps the actual Firestore call in
`asyncio.to_thread`. That keeps the worker's event loop responsive while
the cancellation poller and heartbeat tasks make progress.

State-machine semantics are kept where they belong — in the domain entity.
This adapter only loads the entity, asks it to transition, and writes the
result back. The InMemory adapter contract tests already verify the
domain transitions; the goal of THIS file is faithful persistence.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Optional

from google.api_core import exceptions as gcloud_exceptions

from src.pipeline_jobs.application.ports.job_repository import (
    IPipelineJobRepository,
)
from src.pipeline_jobs.domain.entities import (
    JobStatus,
    JobType,
    PipelineJob,
    PipelineJobAttempt,
    PipelineJobCheckpoint,
)
from src.pipeline_jobs.domain.exceptions import JobNotFoundError

logger = logging.getLogger(__name__)


COLLECTION = "pipeline_jobs"
SUB_ATTEMPTS = "attempts"
SUB_CHECKPOINTS = "checkpoints"


# ---------------------------------------------------------------------------
# Serialisation helpers (exported for round-trip tests)
# ---------------------------------------------------------------------------


def _job_to_dict(job: PipelineJob) -> dict[str, Any]:
    """`mode='json'` turns enums into strings and datetimes into ISO strings —
    but Firestore handles native datetimes better (server-side filtering,
    TTL), so we use `mode='python'` and let firebase-admin marshal them."""
    return job.model_dump(mode="python", by_alias=True)


def _dict_to_job(data: dict[str, Any]) -> PipelineJob:
    return PipelineJob.model_validate(data)


def _attempt_to_dict(att: PipelineJobAttempt) -> dict[str, Any]:
    return att.model_dump(mode="python", by_alias=True)


def _dict_to_attempt(data: dict[str, Any]) -> PipelineJobAttempt:
    return PipelineJobAttempt.model_validate(data)


def _checkpoint_to_dict(cp: PipelineJobCheckpoint) -> dict[str, Any]:
    return cp.model_dump(mode="python", by_alias=True)


def _dict_to_checkpoint(data: dict[str, Any]) -> PipelineJobCheckpoint:
    return PipelineJobCheckpoint.model_validate(data)


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class FirestorePipelineJobRepository(IPipelineJobRepository):
    def __init__(self, *, db: Any) -> None:
        """`db` is a `google.cloud.firestore.Client` (typically obtained via
        `firebase_admin.firestore.client()`). Injected for testability."""
        self._db = db

    # ----- internal helpers -------------------------------------------------

    def _job_ref(self, job_id: str):
        return self._db.collection(COLLECTION).document(job_id)

    async def _load(self, job_id: str) -> PipelineJob:
        snapshot = await asyncio.to_thread(self._job_ref(job_id).get)
        if not snapshot.exists:
            raise JobNotFoundError(f"PipelineJob '{job_id}' not found")
        return _dict_to_job(snapshot.to_dict())

    async def _save_job(self, job: PipelineJob) -> None:
        await asyncio.to_thread(self._job_ref(job.jobId).set, _job_to_dict(job))

    async def _save_attempt(
        self, job_id: str, attempt: PipelineJobAttempt
    ) -> None:
        ref = (
            self._job_ref(job_id)
            .collection(SUB_ATTEMPTS)
            .document(attempt.attemptId)
        )
        await asyncio.to_thread(ref.set, _attempt_to_dict(attempt))

    # ----- Lifecycle --------------------------------------------------------

    async def create(self, job: PipelineJob) -> None:
        try:
            await asyncio.to_thread(
                self._job_ref(job.jobId).create, _job_to_dict(job)
            )
        except gcloud_exceptions.AlreadyExists as e:
            raise ValueError(
                f"PipelineJob '{job.jobId}' already exists"
            ) from e

    async def get_by_id(self, job_id: str) -> PipelineJob:
        return await self._load(job_id)

    # ----- Single-doc updates (no attempt-side mutation) --------------------

    async def attach_execution_name(
        self, job_id: str, execution_name: str
    ) -> PipelineJob:
        job = await self._load(job_id)
        new_job = job.attach_execution_name(execution_name)
        await self._save_job(new_job)
        return new_job

    async def request_cancellation(self, job_id: str) -> PipelineJob:
        job = await self._load(job_id)
        new_job = job.request_cancellation()
        await self._save_job(new_job)
        return new_job

    async def retry_for_new_attempt(self, job_id: str) -> PipelineJob:
        job = await self._load(job_id)
        new_job = job.retry_for_new_attempt()
        await self._save_job(new_job)
        return new_job

    async def mark_dispatch_failed(
        self, job_id: str, *, error_message: str, error_type: str
    ) -> PipelineJob:
        job = await self._load(job_id)
        new_job = job.mark_dispatch_failed(
            error_message=error_message, error_type=error_type
        )
        await self._save_job(new_job)
        return new_job

    async def touch_updated_at(self, job_id: str) -> None:
        # Heartbeat: avoid a full read/write — direct field update keeps cost
        # bounded even at 30s cadence over multi-hour jobs.
        await asyncio.to_thread(
            self._job_ref(job_id).update, {"updatedAt": datetime.utcnow()}
        )

    # ----- Claim and terminal transitions (job + attempt update together) --

    async def claim_for_attempt(
        self,
        job_id: str,
        *,
        attempt_id: str,
        execution_name: Optional[str] = None,
        resume_from_count: int = 0,
    ) -> tuple[PipelineJob, PipelineJobAttempt]:
        # Read-modify-write. In production a Firestore transaction guarantees
        # only one worker wins; until P1.c follow-up adds the transactional
        # path, the domain layer's state check is the consistency net.
        job = await self._load(job_id)
        new_job = job.claim_for_attempt(attempt_id)
        attempt = PipelineJobAttempt.new(
            attempt_id=attempt_id,
            attempt_number=new_job.attempts,
            resume_from_count=resume_from_count,
            execution_name=execution_name or job.currentExecutionName,
        )
        # Job first so a concurrent reader sees `running` before any attempt
        # state appears (consistent ordering for the UI).
        await self._save_job(new_job)
        await self._save_attempt(job_id, attempt)
        return new_job, attempt

    async def mark_completed(
        self, job_id: str, *, partidas_resolved: int = 0
    ) -> PipelineJob:
        job = await self._load(job_id)
        new_job = job.mark_completed()
        await self._save_job(new_job)
        if job.currentAttemptId:
            existing_attempt = await self.get_attempt(
                job_id, job.currentAttemptId
            )
            await self._save_attempt(
                job_id,
                existing_attempt.mark_completed(
                    partidas_resolved=partidas_resolved
                ),
            )
        return new_job

    async def mark_failed(
        self, job_id: str, *, error_message: str, error_type: str
    ) -> PipelineJob:
        job = await self._load(job_id)
        new_job = job.mark_failed(
            error_message=error_message, error_type=error_type
        )
        await self._save_job(new_job)
        if job.currentAttemptId:
            existing_attempt = await self.get_attempt(
                job_id, job.currentAttemptId
            )
            await self._save_attempt(
                job_id, existing_attempt.mark_failed(error_message=error_message)
            )
        return new_job

    async def mark_canceled(self, job_id: str) -> PipelineJob:
        job = await self._load(job_id)
        new_job = job.mark_canceled()
        await self._save_job(new_job)
        if job.currentAttemptId:
            existing_attempt = await self.get_attempt(
                job_id, job.currentAttemptId
            )
            await self._save_attempt(
                job_id, existing_attempt.mark_canceled()
            )
        return new_job

    # ----- Reads on sub-collections -----------------------------------------

    async def list_attempts(
        self, job_id: str
    ) -> list[PipelineJobAttempt]:
        await self._load(job_id)  # raises JobNotFoundError if missing
        col_ref = self._job_ref(job_id).collection(SUB_ATTEMPTS)

        def _stream():
            return [_dict_to_attempt(s.to_dict()) for s in col_ref.stream()]

        attempts = await asyncio.to_thread(_stream)
        attempts.sort(key=lambda a: a.attemptNumber)
        return attempts

    async def get_attempt(
        self, job_id: str, attempt_id: str
    ) -> PipelineJobAttempt:
        ref = (
            self._job_ref(job_id)
            .collection(SUB_ATTEMPTS)
            .document(attempt_id)
        )
        snapshot = await asyncio.to_thread(ref.get)
        if not snapshot.exists:
            raise JobNotFoundError(
                f"Attempt '{attempt_id}' not found for job '{job_id}'"
            )
        return _dict_to_attempt(snapshot.to_dict())

    async def list_checkpoints(
        self, job_id: str
    ) -> list[PipelineJobCheckpoint]:
        await self._load(job_id)
        col_ref = self._job_ref(job_id).collection(SUB_CHECKPOINTS)

        def _stream():
            return [_dict_to_checkpoint(s.to_dict()) for s in col_ref.stream()]

        cps = await asyncio.to_thread(_stream)
        cps.sort(key=lambda c: c.partidaCode)
        return cps

    # ----- Checkpoint write (sub-collection + parent summary) ---------------

    async def append_checkpoint(
        self, job_id: str, checkpoint: PipelineJobCheckpoint
    ) -> None:
        # Doc id = partidaCode → re-write converges (idempotency by design).
        ref = (
            self._job_ref(job_id)
            .collection(SUB_CHECKPOINTS)
            .document(checkpoint.partidaCode)
        )
        await asyncio.to_thread(ref.set, _checkpoint_to_dict(checkpoint))

        # Update the parent doc's summary fields. We use the domain entity to
        # keep state-machine semantics consistent (e.g. only running jobs may
        # receive checkpoints).
        job = await self._load(job_id)
        new_job = job.with_resolved_partida_code(checkpoint.partidaCode)
        await self._save_job(new_job)

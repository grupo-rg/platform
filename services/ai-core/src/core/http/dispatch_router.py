"""HTTP router for the Cloud Run Jobs dispatcher.

These four endpoints replace the legacy `BackgroundTasks`-based handlers
(`/api/v1/jobs/measurements`, `/api/v1/budget/vision-extract`,
`/api/v1/jobs/nl-budget`). They are deliberately *short* — every request
finishes in <2s because the long-running work happens in a Cloud Run Job
spawned by `IJobExecutor.run_execution`, not inside the request.

Why each endpoint exists:

  POST /api/v1/jobs/dispatch        — replaces the 3 old endpoints with one.
                                       Single source of truth for "start a job".
  POST /api/v1/jobs/{jobId}/cancel  — cooperative cancellation. Flips the
                                       Firestore flag AND tells Cloud Run
                                       Jobs to send SIGTERM to the worker.
  POST /api/v1/jobs/{jobId}/retry   — restart a failed/canceled job with
                                       resume from existing checkpoints.
  GET  /api/v1/jobs/{jobId}         — UI fallback when SSE telemetry is
                                       stale; lets the user see status,
                                       attempts, error.

Everything is wired through `Depends(get_*)` so tests can swap in-memory
adapters without touching any global state.
"""

from __future__ import annotations

import logging
import uuid
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from src.pipeline_jobs.application.ports.job_executor import (
    ExecutionNotFoundError,
    IJobExecutor,
    JobExecutorError,
)
from src.pipeline_jobs.application.ports.job_repository import (
    IPipelineJobRepository,
)
from src.pipeline_jobs.domain.entities import JobType, PipelineJob
from src.pipeline_jobs.domain.exceptions import (
    IllegalStateTransitionError,
    JobNotFoundError,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Dependency-injection seams. Tests override these with
# `app.dependency_overrides[...]`. Production wires them up in
# `src/core/http/dependencies.py` (added in the same PR or follow-up).
# ---------------------------------------------------------------------------


def get_job_repository() -> IPipelineJobRepository:  # pragma: no cover
    raise NotImplementedError(
        "get_job_repository must be overridden (tests) or wired in dependencies.py"
    )


def get_job_executor() -> IJobExecutor:  # pragma: no cover
    raise NotImplementedError(
        "get_job_executor must be overridden (tests) or wired in dependencies.py"
    )


def get_worker_job_name() -> str:  # pragma: no cover
    """Full resource path of the Cloud Run Job we dispatch to, e.g.
    projects/<project>/locations/<region>/jobs/ai-core-worker. Tests override;
    production reads from the WORKER_JOB_NAME env var."""
    raise NotImplementedError(
        "get_worker_job_name must be overridden (tests) or wired in dependencies.py"
    )


# ---------------------------------------------------------------------------
# Request / response shapes
# ---------------------------------------------------------------------------


class DispatchRequest(BaseModel):
    """Schema-level validation only (missing fields, wrong types → 422).
    Semantic / jobType-specific validation happens inside the handler so we
    can raise a clean 400 with a focused message instead of FastAPI's
    nested 422 envelope."""

    jobType: JobType
    uid: str = Field(min_length=1)
    leadId: str = Field(min_length=1)
    budgetId: str = Field(min_length=1)
    payload: dict[str, Any] = Field(default_factory=dict)


def _validate_payload_for_job_type(
    job_type: JobType, payload: dict[str, Any]
) -> None:
    """Raise HTTPException(400) if the payload is missing the fields required
    for the given jobType. Kept out of the pydantic model so the response
    code is unambiguously 400 (not 422)."""
    if job_type in (JobType.MEASUREMENTS, JobType.VISION_EXTRACT):
        if not payload.get("gcsUri") and not payload.get("pdf_url"):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"payload.gcsUri is required for jobType={job_type.value}"
                ),
            )
    elif job_type is JobType.NL_BUDGET:
        narrative = (payload.get("narrative") or "").strip()
        if not narrative:
            raise HTTPException(
                status_code=400,
                detail=(
                    "payload.narrative is required and must be non-empty "
                    "for jobType=nl-budget"
                ),
            )


class DispatchResponse(BaseModel):
    jobId: str
    status: str
    executionName: Optional[str] = None


class JobView(BaseModel):
    """Read model exposed to the UI. Includes only what the budget UI
    actually needs — not the whole `PipelineJob` snapshot."""

    jobId: str
    jobType: str
    status: str
    leadId: str
    budgetId: str
    attempts: int
    cancellation_requested: bool
    currentAttemptId: Optional[str]
    currentExecutionName: Optional[str]
    lastCheckpointCode: Optional[str]
    resolvedPartidaCount: int
    errorMessage: Optional[str]
    errorType: Optional[str]
    createdAt: str
    updatedAt: str
    startedAt: Optional[str]
    finishedAt: Optional[str]

    @classmethod
    def from_domain(cls, job: PipelineJob) -> "JobView":
        return cls(
            jobId=job.jobId,
            jobType=job.jobType.value,
            status=job.status.value,
            leadId=job.leadId,
            budgetId=job.budgetId,
            attempts=job.attempts,
            cancellation_requested=job.cancellation_requested,
            currentAttemptId=job.currentAttemptId,
            currentExecutionName=job.currentExecutionName,
            lastCheckpointCode=job.lastCheckpointCode,
            resolvedPartidaCount=len(job.resolvedPartidaCodes),
            errorMessage=job.errorMessage,
            errorType=job.errorType,
            createdAt=job.createdAt.isoformat(),
            updatedAt=job.updatedAt.isoformat(),
            startedAt=job.startedAt.isoformat() if job.startedAt else None,
            finishedAt=job.finishedAt.isoformat() if job.finishedAt else None,
        )


class CancelResponse(BaseModel):
    jobId: str
    status: str
    cancellation_requested: bool


# ---------------------------------------------------------------------------
# Module-level DI aliases. They have to live here (not inside build_router)
# because FastAPI resolves the annotations of handler functions against the
# *module* globals — `from __future__ import annotations` turns them into
# strings that get evaluated lazily, and a name defined inside build_router
# is invisible at that point.
# ---------------------------------------------------------------------------


RepoDep = Annotated[IPipelineJobRepository, Depends(get_job_repository)]
ExecutorDep = Annotated[IJobExecutor, Depends(get_job_executor)]
WorkerJobNameDep = Annotated[str, Depends(get_worker_job_name)]


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------


def build_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/jobs", tags=["pipeline_jobs"])

    # -- POST /api/v1/jobs/dispatch -------------------------------------

    @router.post(
        "/dispatch",
        response_model=DispatchResponse,
        status_code=202,
    )
    async def dispatch(
        request: DispatchRequest,
        repo: RepoDep,
        executor: ExecutorDep,
        worker_job_name: WorkerJobNameDep,
    ) -> DispatchResponse:
        # Semantic validation (raises HTTPException(400) on bad payload).
        _validate_payload_for_job_type(request.jobType, request.payload)

        job_id = str(uuid.uuid4())
        job = PipelineJob.new(
            jobId=job_id,
            jobType=request.jobType,
            leadId=request.leadId,
            budgetId=request.budgetId,
            uid=request.uid,
            payload=request.payload,
        )
        await repo.create(job)
        logger.info(
            "pipeline_job_dispatch_queued",
            extra={
                "jobId": job_id,
                "jobType": request.jobType.value,
                "budgetId": request.budgetId,
                "uid": request.uid,
            },
        )

        try:
            execution_name = await executor.run_execution(
                job_name=worker_job_name,
                env_overrides={"JOB_ID": job_id},
            )
        except JobExecutorError as e:
            # Mark the job failed so the UI surfaces a real error instead of
            # showing a phantom "queued" job that never runs. Return 500 so
            # the client knows to bail.
            try:
                await repo.mark_dispatch_failed(
                    job_id,
                    error_message=str(e),
                    error_type=type(e).__name__,
                )
            except Exception:  # noqa: BLE001 — best effort secondary write
                logger.exception(
                    "pipeline_job_dispatch_mark_failed_error",
                    extra={"jobId": job_id},
                )
            logger.error(
                "pipeline_job_dispatch_executor_failed",
                extra={"jobId": job_id, "error": str(e)},
            )
            return JSONResponse(
                status_code=500,
                headers={"X-Pipeline-Job-Id": job_id},
                content={
                    "detail": f"Failed to start Cloud Run Job: {e}",
                    "jobId": job_id,
                },
            )

        await repo.attach_execution_name(job_id, execution_name)
        logger.info(
            "pipeline_job_dispatch_started",
            extra={"jobId": job_id, "executionName": execution_name},
        )
        return DispatchResponse(
            jobId=job_id, status="queued", executionName=execution_name
        )

    # -- POST /api/v1/jobs/{jobId}/cancel -------------------------------

    @router.post(
        "/{job_id}/cancel",
        response_model=CancelResponse,
        status_code=200,
    )
    async def cancel(
        job_id: str,
        repo: RepoDep,
        executor: ExecutorDep,
    ) -> CancelResponse:
        try:
            job = await repo.get_by_id(job_id)
        except JobNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e

        try:
            updated = await repo.request_cancellation(job_id)
        except IllegalStateTransitionError as e:
            raise HTTPException(status_code=409, detail=str(e)) from e

        # Fire the Cloud Run Jobs cancel. The adapter swallows already-terminal
        # errors. We catch ExecutionNotFoundError (already gone) explicitly
        # because cancel-after-success is idempotent from the UI's perspective.
        if job.currentExecutionName:
            try:
                await executor.cancel_execution(job.currentExecutionName)
            except ExecutionNotFoundError:
                logger.info(
                    "pipeline_job_cancel_execution_not_found",
                    extra={
                        "jobId": job_id,
                        "executionName": job.currentExecutionName,
                    },
                )
            except JobExecutorError as e:
                # Don't fail the cancel response — Firestore flag is set,
                # the worker will exit on next poll. Log loudly for ops.
                logger.error(
                    "pipeline_job_cancel_executor_failed",
                    extra={"jobId": job_id, "error": str(e)},
                )

        return CancelResponse(
            jobId=job_id,
            status=updated.status.value,
            cancellation_requested=updated.cancellation_requested,
        )

    # -- POST /api/v1/jobs/{jobId}/retry --------------------------------

    @router.post(
        "/{job_id}/retry",
        response_model=DispatchResponse,
        status_code=202,
    )
    async def retry(
        job_id: str,
        repo: RepoDep,
        executor: ExecutorDep,
        worker_job_name: WorkerJobNameDep,
    ) -> DispatchResponse:
        try:
            await repo.get_by_id(job_id)
        except JobNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e

        try:
            await repo.retry_for_new_attempt(job_id)
        except IllegalStateTransitionError as e:
            raise HTTPException(status_code=409, detail=str(e)) from e

        # Same as dispatch: kick off a fresh execution and attach its name.
        try:
            execution_name = await executor.run_execution(
                job_name=worker_job_name,
                env_overrides={"JOB_ID": job_id},
            )
        except JobExecutorError as e:
            try:
                await repo.mark_dispatch_failed(
                    job_id,
                    error_message=str(e),
                    error_type=type(e).__name__,
                )
            except Exception:  # noqa: BLE001
                logger.exception(
                    "pipeline_job_retry_mark_failed_error",
                    extra={"jobId": job_id},
                )
            raise HTTPException(
                status_code=500,
                detail=f"Failed to start Cloud Run Job: {e}",
            ) from e

        await repo.attach_execution_name(job_id, execution_name)
        return DispatchResponse(
            jobId=job_id, status="queued", executionName=execution_name
        )

    # -- GET /api/v1/jobs/{jobId} ---------------------------------------

    @router.get("/{job_id}", response_model=JobView)
    async def get_job(job_id: str, repo: RepoDep) -> JobView:
        try:
            job = await repo.get_by_id(job_id)
        except JobNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        return JobView.from_domain(job)

    return router



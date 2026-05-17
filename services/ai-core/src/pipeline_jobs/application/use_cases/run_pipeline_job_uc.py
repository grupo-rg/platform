"""Use case: run one attempt of a pipeline job to completion.

This is the orchestrator that lives inside the Cloud Run Job worker. It
owns the full lifecycle:

  queued ── claim ─▶ running ── (success) ─▶ completed
                              ── (error)  ─▶ failed
                              ── (cancel) ─▶ canceled

Concurrent with the work, two background tasks run:
  - cancellation poller: re-reads the job every N seconds and raises
    CancelledError into the runner if `cancellation_requested` flips true.
  - heartbeat: bumps `pipeline_jobs/{jobId}.updatedAt` every M seconds so
    the stuck-job Cloud Monitoring alert can rely on it.

The whole thing is wrapped in `try/except BaseException/finally`. That
`BaseException` is the line that fixes the original incident: in the old
BackgroundTasks code, `except Exception` did not catch `CancelledError`
(BaseException subclass since Python 3.8) and the UI saw nothing. Here,
ANY abnormal termination — including SIGTERM-induced cancellation —
results in a terminal Firestore write before the process exits.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from src.pipeline_jobs.application.ports.job_repository import (
    IPipelineJobRepository,
)
from src.pipeline_jobs.application.ports.pdf_storage import IPdfStorage
from src.pipeline_jobs.application.ports.pipeline_runner import (
    IPipelineRunner,
)
from src.pipeline_jobs.domain.entities import (
    JobType,
    PipelineJobCheckpoint,
)

logger = logging.getLogger(__name__)


class RunPipelineJobUseCase:
    def __init__(
        self,
        *,
        repository: IPipelineJobRepository,
        pdf_storage: IPdfStorage,
        runner: IPipelineRunner,
        heartbeat_interval_seconds: float = 30.0,
        cancellation_poll_interval_seconds: float = 5.0,
    ) -> None:
        self.repository = repository
        self.pdf_storage = pdf_storage
        self.runner = runner
        self.heartbeat_interval = heartbeat_interval_seconds
        self.cancellation_poll_interval = cancellation_poll_interval_seconds

    async def execute(self, *, job_id: str, attempt_id: str) -> None:
        # 1. Read job + existing checkpoints to compute resume context.
        job = await self.repository.get_by_id(job_id)
        existing_checkpoints = await self.repository.list_checkpoints(job_id)
        # P4.b — the runner needs full partida dicts (not just codes) so the
        # swarm can both skip already-resolved items AND concatenate them
        # into the final assembly.
        resume_partidas: list[dict[str, Any]] = [
            c.partida for c in existing_checkpoints
        ]
        logger.info(
            "Pipeline job starting",
            extra={
                "jobId": job_id,
                "attemptId": attempt_id,
                "jobType": job.jobType,
                "resumeCount": len(resume_partidas),
            },
        )

        # 2. Atomic claim — transitions queued→running and creates attempt doc.
        await self.repository.claim_for_attempt(
            job_id,
            attempt_id=attempt_id,
            execution_name=job.currentExecutionName,
            resume_from_count=len(resume_partidas),
        )

        # 3. Set up background plumbing.
        cancellation_event = asyncio.Event()
        cancel_poller_task = asyncio.create_task(
            self._poll_cancellation(job_id, cancellation_event)
        )
        heartbeat_task = asyncio.create_task(self._heartbeat(job_id))
        partidas_resolved_count = 0

        try:
            # 4. Download PDF if the job type needs one.
            pdf_bytes = await self._download_pdf_if_needed(job.jobType, job.payload)

            # 5. Define the checkpoint callback that the runner will call
            #    once per partida resolved.
            async def on_partida_resolved(
                code: str, partida_dict: dict[str, Any], token_cost: float
            ) -> None:
                nonlocal partidas_resolved_count
                checkpoint = PipelineJobCheckpoint(
                    partidaCode=code,
                    attemptId=attempt_id,
                    partida=partida_dict,
                    tokenCost=token_cost,
                )
                await self.repository.append_checkpoint(job_id, checkpoint)
                partidas_resolved_count += 1

            # 6. Run the budget pipeline.
            result = await self.runner.run(
                job_type=job.jobType,
                payload=job.payload,
                budget_id=job.budgetId,
                lead_id=job.leadId,
                pdf_bytes=pdf_bytes,
                resume_partidas=resume_partidas,
                on_partida_resolved=on_partida_resolved,
                cancellation_event=cancellation_event,
            )

            # 7. Success path.
            await self.repository.mark_completed(
                job_id, partidas_resolved=result.partidasResolved
            )
            logger.info(
                "Pipeline job completed",
                extra={
                    "jobId": job_id,
                    "attemptId": attempt_id,
                    "partidasResolved": result.partidasResolved,
                    "totalEstimated": result.totalEstimated,
                },
            )

        except asyncio.CancelledError:
            # 8. Cooperative cancellation path. The original incident's bug:
            #    the OLD BackgroundTasks code's `except Exception` missed this
            #    because CancelledError inherits from BaseException since
            #    Python 3.8. We catch it explicitly so the UI sees `canceled`.
            logger.warning(
                "Pipeline job canceled",
                extra={"jobId": job_id, "attemptId": attempt_id},
            )
            try:
                await self.repository.mark_canceled(job_id)
            except Exception as inner:
                # Best effort — the worker is about to die anyway.
                logger.error(
                    "Failed to record cancellation",
                    extra={"jobId": job_id, "innerError": str(inner)},
                )
            raise

        except BaseException as e:  # noqa: BLE001 — intentional broad catch
            # 9. Any other failure path. Record on the job so the UI surfaces
            #    a useful error message, then re-raise so the process exits
            #    with the right code.
            error_message = str(e) or e.__class__.__name__
            error_type = e.__class__.__name__
            logger.error(
                "Pipeline job failed",
                extra={
                    "jobId": job_id,
                    "attemptId": attempt_id,
                    "errorType": error_type,
                    "errorMessage": error_message,
                },
                exc_info=isinstance(e, Exception),
            )
            try:
                await self.repository.mark_failed(
                    job_id,
                    error_message=error_message,
                    error_type=error_type,
                )
            except Exception as inner:
                logger.error(
                    "Failed to record failure",
                    extra={"jobId": job_id, "innerError": str(inner)},
                )
            raise

        finally:
            # 10. Always tear down background tasks. `cancel()` is a no-op on
            #     an already-finished task.
            cancel_poller_task.cancel()
            heartbeat_task.cancel()
            for t in (cancel_poller_task, heartbeat_task):
                try:
                    await t
                except (asyncio.CancelledError, Exception):
                    pass

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    async def _download_pdf_if_needed(
        self, job_type: JobType, payload: dict[str, Any]
    ) -> Optional[bytes]:
        if job_type in (JobType.MEASUREMENTS, JobType.VISION_EXTRACT):
            gcs_uri = payload.get("gcsUri")
            if not gcs_uri:
                raise ValueError(
                    f"Missing 'gcsUri' in payload for job_type={job_type.value}"
                )
            return await self.pdf_storage.download_to_bytes(gcs_uri)
        return None

    async def _poll_cancellation(
        self, job_id: str, cancellation_event: asyncio.Event
    ) -> None:
        """Re-reads the job periodically; sets the event when the user
        flipped cancellation_requested via the cancel endpoint."""
        while not cancellation_event.is_set():
            try:
                await asyncio.sleep(self.cancellation_poll_interval)
                job = await self.repository.get_by_id(job_id)
                if job.cancellation_requested:
                    logger.info(
                        "Cancellation requested",
                        extra={"jobId": job_id},
                    )
                    cancellation_event.set()
                    return
            except asyncio.CancelledError:
                return
            except Exception as e:
                # Transient repo failure — keep polling.
                logger.warning(
                    "Cancellation poll error",
                    extra={"jobId": job_id, "error": str(e)},
                )

    async def _heartbeat(self, job_id: str) -> None:
        """Bumps `pipeline_jobs/{jobId}.updatedAt` so the stuck-job alert
        in Cloud Monitoring can detect dead workers."""
        while True:
            try:
                await asyncio.sleep(self.heartbeat_interval)
                await self.repository.touch_updated_at(job_id)
            except asyncio.CancelledError:
                return
            except Exception as e:
                logger.warning(
                    "Heartbeat error",
                    extra={"jobId": job_id, "error": str(e)},
                )

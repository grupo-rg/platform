"""Cloud Run Jobs adapter for IJobExecutor.

Why a thin adapter:
  - Synchronous SDK calls are wrapped in `asyncio.to_thread` so the FastAPI
    dispatcher event loop doesn't block while we hit the Cloud Run API
    (typical RPC ~200ms).
  - SDK exceptions from `google.api_core.exceptions` are translated to the
    two domain exceptions (`JobExecutorError`, `ExecutionNotFoundError`)
    that the use case knows about. The dispatcher endpoint never sees a
    `google.api_core.*` symbol.
  - `cancel_execution` is intentionally idempotent on already-terminal
    executions (FAILED_PRECONDITION) — the UI fires cancel and retry in
    rapid succession; we want both to converge to the right state without
    surface errors.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from google.api_core import exceptions as gcloud_exceptions

from src.pipeline_jobs.application.ports.job_executor import (
    ExecutionNotFoundError,
    IJobExecutor,
    JobExecutorError,
)

logger = logging.getLogger(__name__)


class CloudRunJobsExecutor(IJobExecutor):
    def __init__(
        self,
        *,
        jobs_client: Any,
        executions_client: Any,
    ) -> None:
        # Clients are injected so unit tests can swap MagicMock instances in.
        # The factory `from_env` builds the real clients for production.
        self._jobs = jobs_client
        self._executions = executions_client

    @classmethod
    def from_env(cls) -> "CloudRunJobsExecutor":
        # Lazy import — keeps `services/ai-core/src/pipeline_jobs/...` importable
        # in environments where google-cloud-run isn't installed (rare, but
        # protects local tooling).
        from google.cloud import run_v2

        return cls(
            jobs_client=run_v2.JobsClient(),
            executions_client=run_v2.ExecutionsClient(),
        )

    # ------------------------------------------------------------------
    # run_execution
    # ------------------------------------------------------------------

    async def run_execution(
        self,
        job_name: str,
        env_overrides: Optional[dict[str, str]] = None,
    ) -> str:
        request = self._build_run_request(job_name, env_overrides or {})
        try:
            operation = await asyncio.to_thread(
                self._jobs.run_job, request=request
            )
        except gcloud_exceptions.NotFound as e:
            raise JobExecutorError(
                f"Cloud Run Job '{job_name}' not found: {e}"
            ) from e
        except gcloud_exceptions.GoogleAPICallError as e:
            raise JobExecutorError(
                f"run_job failed for '{job_name}': {e}"
            ) from e

        execution_name = operation.metadata.name
        logger.info(
            "Cloud Run Job execution started",
            extra={"jobName": job_name, "executionName": execution_name},
        )
        return execution_name

    def _build_run_request(
        self, job_name: str, env_overrides: dict[str, str]
    ) -> Any:
        from google.cloud import run_v2

        if env_overrides:
            env_vars = [
                run_v2.EnvVar(name=k, value=v) for k, v in env_overrides.items()
            ]
            container_override = run_v2.RunJobRequest.Overrides.ContainerOverride(
                env=env_vars,
            )
            overrides = run_v2.RunJobRequest.Overrides(
                container_overrides=[container_override],
            )
        else:
            overrides = run_v2.RunJobRequest.Overrides()
        return run_v2.RunJobRequest(name=job_name, overrides=overrides)

    # ------------------------------------------------------------------
    # cancel_execution
    # ------------------------------------------------------------------

    async def cancel_execution(self, execution_name: str) -> None:
        from google.cloud import run_v2

        request = run_v2.CancelExecutionRequest(name=execution_name)
        try:
            await asyncio.to_thread(
                self._executions.cancel_execution, request=request
            )
        except gcloud_exceptions.NotFound as e:
            raise ExecutionNotFoundError(
                f"Execution '{execution_name}' not found: {e}"
            ) from e
        except gcloud_exceptions.FailedPrecondition:
            # Idempotency: execution already in terminal state. The UI fired
            # cancel right after the worker self-completed. Not an error.
            logger.info(
                "Cancel skipped (execution already terminal)",
                extra={"executionName": execution_name},
            )
        except gcloud_exceptions.GoogleAPICallError as e:
            raise JobExecutorError(
                f"cancel_execution failed for '{execution_name}': {e}"
            ) from e

    # ------------------------------------------------------------------
    # get_execution_status
    # ------------------------------------------------------------------

    async def get_execution_status(self, execution_name: str) -> str:
        from google.cloud import run_v2

        request = run_v2.GetExecutionRequest(name=execution_name)
        try:
            execution = await asyncio.to_thread(
                self._executions.get_execution, request=request
            )
        except gcloud_exceptions.NotFound as e:
            raise ExecutionNotFoundError(
                f"Execution '{execution_name}' not found: {e}"
            ) from e
        except gcloud_exceptions.GoogleAPICallError as e:
            raise JobExecutorError(
                f"get_execution failed for '{execution_name}': {e}"
            ) from e

        return self._classify_status(execution)

    @staticmethod
    def _classify_status(execution: Any) -> str:
        """Map Cloud Run Execution counters to our 5-state UI vocabulary.

        Cancellation wins over failure: if the user cancels mid-flight the
        worker may exit non-zero before Cloud Run flips cancelled_count,
        so when both are non-zero we trust the user's intent.
        """
        if getattr(execution, "cancelled_count", 0) or 0:
            return "canceled"
        if getattr(execution, "failed_count", 0) or 0:
            return "failed"
        if getattr(execution, "succeeded_count", 0) or 0:
            return "succeeded"
        if getattr(execution, "running_count", 0) or 0:
            return "running"
        return "queued"

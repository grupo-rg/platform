"""Port for triggering / canceling / inspecting Cloud Run Job executions.

The use case `RunPipelineJobUseCase` never touches Cloud Run Jobs directly —
it goes through this port. That keeps the worker entrypoint trivially
testable (with an in-memory fake) and confines `google-cloud-run` to the
adapter layer.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional


class IJobExecutor(ABC):
    """Abstract executor for Cloud Run Jobs (or any equivalent batch backend)."""

    @abstractmethod
    async def run_execution(
        self,
        job_name: str,
        env_overrides: Optional[dict[str, str]] = None,
    ) -> str:
        """Trigger a fresh execution of the named job. `env_overrides` is
        injected as container env vars on the execution (we use this to pass
        JOB_ID so the worker can locate its `pipeline_jobs/{jobId}` doc).

        Returns the fully-qualified execution resource name, e.g.
        `projects/p/locations/l/jobs/j/executions/exec-xyz`.

        Raises JobExecutorError on any cloud-side failure.
        """

    @abstractmethod
    async def cancel_execution(self, execution_name: str) -> None:
        """Request cancellation of a running execution.

        Idempotent: if the execution is already in a terminal state the
        adapter swallows the cloud-side FAILED_PRECONDITION. Cancel on a
        non-existent execution raises ExecutionNotFoundError so the caller
        can distinguish "already gone" from generic failure.
        """

    @abstractmethod
    async def get_execution_status(self, execution_name: str) -> str:
        """Returns one of: 'queued' | 'running' | 'succeeded' | 'failed' |
        'canceled'. Used by the cancel/retry endpoints for sanity checks
        and by smoke tests."""


class JobExecutorError(Exception):
    """Wraps any cloud-side failure (NotFound, PermissionDenied, transport
    error) so the use case has a single domain exception to catch."""


class ExecutionNotFoundError(JobExecutorError):
    """The execution name does not exist (or no longer exists). Distinct
    from generic JobExecutorError so the cancel endpoint can return 404."""

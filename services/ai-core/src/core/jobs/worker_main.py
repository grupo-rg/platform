"""Cloud Run Job entrypoint.

Invoked by Cloud Run as `python -m src.core.jobs.worker_main`. The runtime
injects:
  - JOB_ID: our own env var, set by the dispatcher when calling
    `JobsClient.run_job(overrides=...)`. The whole pipeline is keyed by
    this id.
  - CLOUD_RUN_EXECUTION: full execution resource name. The cancel endpoint
    reads `pipeline_jobs/{jobId}.currentExecutionName` instead (the
    dispatcher writes it at run time), so the worker doesn't need to do
    anything with this — but we log it for debuggability.

Exit code semantics:
  - 0: success (Cloud Run records the task as Succeeded).
  - 0: IllegalStateTransitionError — another worker already claimed this
    job or it's terminal. Returning 0 prevents Cloud Run from kicking off
    a retry storm of duplicate workers.
  - 1: any other Exception. Cloud Run will mark Failed and (if configured)
    retry.
  - 2: configuration error (e.g., missing JOB_ID). Distinct so an alert
    can fire that this is operator error, not a transient runtime bug.
  - 143: SIGTERM received and cancellation honoured cleanly (128 + 15).
    Cloud Run already understands this exit code.

The signal handler is install-once-and-forget: when SIGTERM fires (Cloud
Run's "stop please" message before SIGKILL after the grace period), we
flip `cancellation_requested` in Firestore. The use case's poller sees it
and raises CancelledError inside the runner. The use case marks the job
canceled and re-raises, which becomes our exit 143.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
import uuid
from typing import Callable, Mapping, Optional

from src.pipeline_jobs.application.use_cases.run_pipeline_job_uc import (
    RunPipelineJobUseCase,
)
from src.pipeline_jobs.domain.exceptions import IllegalStateTransitionError

logger = logging.getLogger(__name__)


UseCaseFactory = Callable[[Mapping[str, str]], RunPipelineJobUseCase]


# ---------------------------------------------------------------------------
# Exit-code constants
# ---------------------------------------------------------------------------

EXIT_SUCCESS = 0
EXIT_RUNTIME_ERROR = 1
EXIT_CONFIG_ERROR = 2
EXIT_SIGTERM = 143  # 128 + SIGTERM=15, standard Unix convention


# ---------------------------------------------------------------------------
# Public entry
# ---------------------------------------------------------------------------


def main(
    *,
    env: Optional[Mapping[str, str]] = None,
    use_case_factory: Optional[UseCaseFactory] = None,
    attempt_id_factory: Callable[[], str] = lambda: str(uuid.uuid4()),
    install_signal_handlers: bool = True,
    install_logging: bool = False,
) -> int:
    """Worker entry. Returns the process exit code; callers (incl. the
    `__main__` block) are responsible for `sys.exit(...)`.

    The factories are dependency-injection seams for tests. Production
    uses the defaults: `use_case_factory=_build_use_case_from_env` and
    `attempt_id_factory=lambda: str(uuid.uuid4())`.
    """
    if install_logging:
        # Lazy import — tests that just call main() with a stub UC don't
        # need the logger to be installed.
        from src.core.logging import init_json_logging

        init_json_logging()

    resolved_env = env if env is not None else os.environ
    job_id = (resolved_env.get("JOB_ID") or "").strip()
    if not job_id:
        logger.error("worker_main: JOB_ID env var is required")
        return EXIT_CONFIG_ERROR

    factory = use_case_factory or _build_use_case_from_env
    try:
        use_case = factory(resolved_env)
    except Exception:
        logger.exception("worker_main: failed to build use case")
        return EXIT_RUNTIME_ERROR

    attempt_id = attempt_id_factory()
    execution_name = resolved_env.get("CLOUD_RUN_EXECUTION", "")
    logger.info(
        "worker_main starting",
        extra={
            "jobId": job_id,
            "attemptId": attempt_id,
            "cloudRunExecution": execution_name,
        },
    )

    if install_signal_handlers:
        _install_sigterm_handler(use_case, job_id)

    return asyncio.run(_run_job(use_case, job_id, attempt_id))


# ---------------------------------------------------------------------------
# Core loop
# ---------------------------------------------------------------------------


async def _run_job(
    use_case: RunPipelineJobUseCase, job_id: str, attempt_id: str
) -> int:
    try:
        await use_case.execute(job_id=job_id, attempt_id=attempt_id)
        return EXIT_SUCCESS
    except asyncio.CancelledError:
        logger.warning(
            "worker_main: canceled by SIGTERM (or upstream)",
            extra={"jobId": job_id, "attemptId": attempt_id},
        )
        return EXIT_SIGTERM
    except IllegalStateTransitionError as e:
        # Another worker already claimed this job, or the job is terminal.
        # Don't fail the Cloud Run task — Cloud Run retries failed tasks
        # and we'd cause a thundering herd of duplicate workers.
        logger.warning(
            "worker_main: job not claimable; exiting cleanly",
            extra={"jobId": job_id, "reason": str(e)},
        )
        return EXIT_SUCCESS
    except Exception:
        logger.exception(
            "worker_main: unhandled exception",
            extra={"jobId": job_id, "attemptId": attempt_id},
        )
        return EXIT_RUNTIME_ERROR


# ---------------------------------------------------------------------------
# SIGTERM handler — flips cancellation_requested in Firestore
# ---------------------------------------------------------------------------


def _install_sigterm_handler(
    use_case: RunPipelineJobUseCase, job_id: str
) -> None:
    """Wire SIGTERM to a Firestore write that flips cancellation_requested.

    Cloud Run sends SIGTERM with a grace period (default 10s, up to 60s
    via --task-timeout-grace) before SIGKILL. We use that window to:
      1. Flip the flag (Firestore write, ~50ms).
      2. The use case's polling loop sees it, raises CancelledError, the
         use case marks the job canceled. (~poll interval, default 5s.)
      3. The worker exits 143 cleanly before SIGKILL lands.

    Falls back gracefully if signal handling isn't supported on the
    platform (Windows under test).
    """
    if not hasattr(signal, "SIGTERM"):
        return  # Windows under test
    try:

        def _handler(signum, frame):  # noqa: ARG001 — signal API
            logger.warning(
                "SIGTERM received; requesting cancellation",
                extra={"jobId": job_id},
            )
            # We can't await from a signal handler, so we schedule the
            # cancellation write via the running loop. If no loop is
            # running yet (signal arrived very early), fall back to a
            # synchronous schedule via asyncio.run().
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(
                    use_case.repository.request_cancellation(job_id)
                )
            except RuntimeError:
                asyncio.run(
                    use_case.repository.request_cancellation(job_id)
                )

        signal.signal(signal.SIGTERM, _handler)
    except (OSError, ValueError, NotImplementedError) as e:
        # Some platforms refuse signal.signal outside the main thread.
        logger.warning(
            "SIGTERM handler install failed (non-fatal)",
            extra={"error": str(e)},
        )


# ---------------------------------------------------------------------------
# Default production DI (factory uses real adapters)
# ---------------------------------------------------------------------------


def _build_use_case_from_env(env: Mapping[str, str]) -> RunPipelineJobUseCase:
    """Production factory. Bootstraps firebase_admin (the worker has no
    HTTP server to do it for us) and then delegates to the shared singleton
    plumbing in `src/core/http/dependencies.py`. Same code path as the
    dispatcher — by construction, both processes see the same job state.

    Import ORDER matters: `dependencies.py` instantiates `firestore.client()`
    at module load, which requires firebase_admin to be initialised first.
    Do NOT merge these two `from ... import ...` lines.
    """
    from src.core.bootstrap import init_firebase_admin

    init_firebase_admin(env)
    # Import AFTER firebase is up — see docstring.
    from src.core.http.dependencies import get_run_pipeline_job_uc

    return get_run_pipeline_job_uc()


# ---------------------------------------------------------------------------
# `python -m src.core.jobs.worker_main`
# ---------------------------------------------------------------------------


if __name__ == "__main__":  # pragma: no cover
    # Production entry point — install JSON logging so Cloud Logging gets
    # structured entries (severity, jobId, attemptId labels) without an agent.
    sys.exit(main(install_logging=True))

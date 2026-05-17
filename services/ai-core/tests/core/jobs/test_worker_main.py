"""Tests for the Cloud Run Job worker entrypoint.

These tests do NOT spawn subprocesses (slow, flaky on Windows). Instead
they exercise `main()` directly, injecting a use_case factory that returns
a programmable mock. What we verify:

  - Missing JOB_ID → exit 2 (configuration error; Cloud Run will mark the
    task as failed and we want a distinct exit code for that).
  - Successful execute() → exit 0.
  - Runner raised a regular Exception → exit 1.
  - CancelledError (= SIGTERM in production) → exit 143 (128 + SIGTERM=15).
  - IllegalStateTransitionError (another worker already claimed it) → exit 0.
    Cloud Run already retries failed tasks; we don't want a spurious retry
    just because two workers raced.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.core.jobs.worker_main import main
from src.pipeline_jobs.domain.exceptions import IllegalStateTransitionError


def _factory(execute_side_effect=None, execute_return=None):
    """Returns a use_case_factory that yields a MagicMock with `execute`
    behaving as configured. `execute_side_effect` may be an exception class
    or instance; `execute_return` is the awaited return value."""

    def factory(env):  # noqa: ARG001 — signature matches real factory
        uc = MagicMock()
        if execute_side_effect is not None:
            uc.execute = AsyncMock(side_effect=execute_side_effect)
        else:
            uc.execute = AsyncMock(return_value=execute_return)
        # repository attribute needed by SIGTERM handler installer (we skip it).
        uc.repository = MagicMock()
        return uc

    return factory


# ---------------------------------------------------------------------------
# Exit codes
# ---------------------------------------------------------------------------


class TestExitCodes:
    def test_missing_JOB_ID_returns_2(self):
        assert (
            main(
                env={},
                use_case_factory=_factory(),
                install_signal_handlers=False,
            )
            == 2
        )

    def test_blank_JOB_ID_returns_2(self):
        assert (
            main(
                env={"JOB_ID": "   "},
                use_case_factory=_factory(),
                install_signal_handlers=False,
            )
            == 2
        )

    def test_successful_execute_returns_0(self):
        assert (
            main(
                env={"JOB_ID": "job-abc"},
                use_case_factory=_factory(),
                attempt_id_factory=lambda: "att-1",
                install_signal_handlers=False,
            )
            == 0
        )

    def test_runner_exception_returns_1(self):
        assert (
            main(
                env={"JOB_ID": "job-abc"},
                use_case_factory=_factory(
                    execute_side_effect=RuntimeError("gemini quota")
                ),
                attempt_id_factory=lambda: "att-1",
                install_signal_handlers=False,
            )
            == 1
        )

    def test_cancelled_error_returns_143(self):
        assert (
            main(
                env={"JOB_ID": "job-abc"},
                use_case_factory=_factory(
                    execute_side_effect=asyncio.CancelledError()
                ),
                attempt_id_factory=lambda: "att-1",
                install_signal_handlers=False,
            )
            == 143
        )

    def test_illegal_state_transition_returns_0(self):
        # Another worker is already running this job (or it's already done).
        # We should NOT fail the Cloud Run task — Cloud Run retries failed
        # tasks and that would cause a thundering-herd of duplicate retries.
        assert (
            main(
                env={"JOB_ID": "job-abc"},
                use_case_factory=_factory(
                    execute_side_effect=IllegalStateTransitionError(
                        "Already running"
                    )
                ),
                attempt_id_factory=lambda: "att-1",
                install_signal_handlers=False,
            )
            == 0
        )


# ---------------------------------------------------------------------------
# Wiring
# ---------------------------------------------------------------------------


class TestWiring:
    def test_use_case_factory_receives_env(self):
        captured = {}

        def factory(env):
            captured["env"] = env
            uc = MagicMock()
            uc.execute = AsyncMock(return_value=None)
            uc.repository = MagicMock()
            return uc

        env = {"JOB_ID": "job-abc", "FOO": "bar"}
        main(
            env=env,
            use_case_factory=factory,
            attempt_id_factory=lambda: "att-1",
            install_signal_handlers=False,
        )
        assert captured["env"] == env

    def test_attempt_id_factory_called(self):
        called = {"count": 0}

        def aid():
            called["count"] += 1
            return "att-from-factory"

        uc_calls = []

        def factory(env):
            uc = MagicMock()

            async def fake_execute(*, job_id, attempt_id):
                uc_calls.append({"jobId": job_id, "attemptId": attempt_id})

            uc.execute = fake_execute
            uc.repository = MagicMock()
            return uc

        main(
            env={"JOB_ID": "job-abc"},
            use_case_factory=factory,
            attempt_id_factory=aid,
            install_signal_handlers=False,
        )

        assert called["count"] == 1
        assert uc_calls == [{"jobId": "job-abc", "attemptId": "att-from-factory"}]


# ---------------------------------------------------------------------------
# CLOUD_RUN_EXECUTION env var passthrough (used as the execution name when
# the worker self-reports back to its attempt doc).
# ---------------------------------------------------------------------------


class TestCloudRunEnvVars:
    def test_worker_runs_with_cloud_run_env_present(self):
        # The Cloud Run Jobs runtime injects CLOUD_RUN_EXECUTION automatically.
        # The worker doesn't need to do anything with it directly today, but
        # the test guards against a future refactor that breaks the env passthrough.
        env = {
            "JOB_ID": "job-abc",
            "CLOUD_RUN_EXECUTION": (
                "projects/p/locations/l/jobs/ai-core-worker/executions/exec-x"
            ),
            "CLOUD_RUN_TASK_INDEX": "0",
            "CLOUD_RUN_TASK_ATTEMPT": "0",
        }
        assert (
            main(
                env=env,
                use_case_factory=_factory(),
                attempt_id_factory=lambda: "att-1",
                install_signal_handlers=False,
            )
            == 0
        )

"""End-to-end orchestration tests for RunPipelineJobUseCase.

These tests use the in-memory repository and fake runner/storage adapters
so they exercise the lifecycle (claim → run → checkpoint → terminal) without
touching Firestore, GCS, or Cloud Run Jobs. They are the regression net
for the bug that motivated this whole rewrite: silent cancellations that
left the UI hanging forever.
"""

from __future__ import annotations

import asyncio
from typing import Any, Optional

import pytest

from src.pipeline_jobs.application.ports.pdf_storage import IPdfStorage, PdfMetadata
from src.pipeline_jobs.application.ports.pipeline_runner import (
    IPipelineRunner,
    OnPartidaResolved,
    PipelineRunResult,
)
from src.pipeline_jobs.application.use_cases.run_pipeline_job_uc import (
    RunPipelineJobUseCase,
)
from src.pipeline_jobs.domain.entities import (
    JobStatus,
    JobType,
    PipelineJob,
)
from src.pipeline_jobs.infrastructure.in_memory_pipeline_job_repository import (
    InMemoryPipelineJobRepository,
)


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakePdfStorage(IPdfStorage):
    """Returns predetermined bytes for any URI; records the URIs it saw."""

    def __init__(self, payload: bytes = b"%PDF-FAKE") -> None:
        self.payload = payload
        self.calls: list[str] = []

    async def download_to_bytes(
        self, gcs_uri: str, *, max_bytes: int = 100 * 1024 * 1024,
        strict_content_type: bool = False,
    ) -> bytes:
        self.calls.append(gcs_uri)
        return self.payload

    async def get_metadata(self, gcs_uri: str) -> PdfMetadata:
        return PdfMetadata(
            size=len(self.payload),
            contentType="application/pdf",
            generation=1,
        )


class FakePipelineRunner(IPipelineRunner):
    """Configurable fake. The test seeds partidas to emit, optional sleeps to
    leave room for cancellation, and an optional exception to raise."""

    def __init__(
        self,
        *,
        partidas: Optional[list[tuple[str, dict[str, Any]]]] = None,
        sleep_per_partida: float = 0.0,
        raise_at_index: Optional[int] = None,
        exception_to_raise: Optional[BaseException] = None,
    ) -> None:
        self.partidas = partidas or []
        self.sleep_per_partida = sleep_per_partida
        self.raise_at_index = raise_at_index
        self.exception_to_raise = exception_to_raise or RuntimeError("kaboom")
        # Recorded inputs for assertions
        self.received_resume_codes: Optional[set[str]] = None
        self.received_pdf_bytes: Optional[bytes] = None
        self.received_payload: Optional[dict[str, Any]] = None
        self.received_budget_id: Optional[str] = None
        self.received_job_type: Optional[JobType] = None

    async def run(
        self,
        *,
        job_type: JobType,
        payload: dict[str, Any],
        budget_id: str,
        lead_id: str,
        pdf_bytes: Optional[bytes],
        resume_partidas: list[dict[str, Any]],
        on_partida_resolved: OnPartidaResolved,
        cancellation_event: asyncio.Event,
    ) -> PipelineRunResult:
        # P4.b: the runner now receives full partida dicts (not just codes).
        # We derive the code set locally for the skip check.
        resumed_codes = {p.get("code") for p in resume_partidas if p.get("code")}
        self.received_resume_codes = resumed_codes
        self.received_pdf_bytes = pdf_bytes
        self.received_payload = payload
        self.received_budget_id = budget_id
        self.received_job_type = job_type

        emitted = 0
        for i, (code, partida_dict) in enumerate(self.partidas):
            # Cooperative cancellation point.
            if cancellation_event.is_set():
                raise asyncio.CancelledError()
            # Skip codes already resolved (resume semantics).
            if code in resumed_codes:
                continue
            if self.sleep_per_partida > 0:
                await asyncio.sleep(self.sleep_per_partida)
            if self.raise_at_index is not None and i == self.raise_at_index:
                raise self.exception_to_raise
            await on_partida_resolved(code, partida_dict, 1.5)
            emitted += 1

        return PipelineRunResult(
            budgetId=budget_id,
            partidasResolved=emitted + len(resume_partidas),
            totalEstimated=1000.0 * (emitted + len(resume_partidas)),
        )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def repo():
    return InMemoryPipelineJobRepository()


@pytest.fixture
def storage():
    return FakePdfStorage()


async def _seed_job(repo, *, job_type=JobType.MEASUREMENTS, payload=None) -> PipelineJob:
    job = PipelineJob.new(
        jobId="job-1",
        jobType=job_type,
        leadId="lead-1",
        budgetId="budget-1",
        uid="user-1",
        payload=payload
        or {"gcsUri": "gs://b/user-1/job-1/x.pdf", "strategy": "INLINE"},
    )
    await repo.create(job)
    await repo.attach_execution_name("job-1", "exec-1")
    return job


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


class TestHappyPath:
    async def test_completes_job_and_emits_checkpoints(self, repo, storage):
        await _seed_job(repo)
        runner = FakePipelineRunner(
            partidas=[
                ("P001", {"code": "P001", "totalPrice": 10.0}),
                ("P002", {"code": "P002", "totalPrice": 20.0}),
                ("P003", {"code": "P003", "totalPrice": 30.0}),
            ]
        )
        uc = RunPipelineJobUseCase(
            repository=repo, pdf_storage=storage, runner=runner,
            heartbeat_interval_seconds=999,  # disable for unit speed
            cancellation_poll_interval_seconds=999,
        )

        await uc.execute(job_id="job-1", attempt_id="att-1")

        # Job transitioned queued → running → completed
        job = await repo.get_by_id("job-1")
        assert job.status is JobStatus.COMPLETED
        assert job.finishedAt is not None
        # Three checkpoints persisted
        checkpoints = await repo.list_checkpoints("job-1")
        assert sorted(c.partidaCode for c in checkpoints) == [
            "P001", "P002", "P003"
        ]
        # Attempt closed with partidasResolved counter
        [attempt] = await repo.list_attempts("job-1")
        assert attempt.status is JobStatus.COMPLETED
        assert attempt.partidasResolved == 3

    async def test_pdf_downloaded_for_measurements(self, repo, storage):
        await _seed_job(repo)
        runner = FakePipelineRunner(partidas=[("P001", {"code": "P001"})])
        uc = RunPipelineJobUseCase(
            repository=repo, pdf_storage=storage, runner=runner,
            heartbeat_interval_seconds=999,
            cancellation_poll_interval_seconds=999,
        )
        await uc.execute(job_id="job-1", attempt_id="att-1")
        assert storage.calls == ["gs://b/user-1/job-1/x.pdf"]
        assert runner.received_pdf_bytes == b"%PDF-FAKE"

    async def test_no_pdf_download_for_nl_budget(self, repo, storage):
        await _seed_job(
            repo,
            job_type=JobType.NL_BUDGET,
            payload={"narrative": "casa de 100m2"},
        )
        runner = FakePipelineRunner(partidas=[("P001", {"code": "P001"})])
        uc = RunPipelineJobUseCase(
            repository=repo, pdf_storage=storage, runner=runner,
            heartbeat_interval_seconds=999,
            cancellation_poll_interval_seconds=999,
        )
        await uc.execute(job_id="job-1", attempt_id="att-1")
        assert storage.calls == []
        assert runner.received_pdf_bytes is None
        assert runner.received_payload == {"narrative": "casa de 100m2"}


# ---------------------------------------------------------------------------
# Resume semantics
# ---------------------------------------------------------------------------


class TestResume:
    async def test_resume_from_existing_checkpoints(self, repo, storage):
        # Seed a job that previously failed leaving 2 checkpoints behind.
        await _seed_job(repo)
        await repo.claim_for_attempt("job-1", attempt_id="att-prev")
        for code in ("P001", "P002"):
            from src.pipeline_jobs.domain.entities import PipelineJobCheckpoint
            await repo.append_checkpoint(
                "job-1",
                PipelineJobCheckpoint(
                    partidaCode=code, attemptId="att-prev",
                    partida={"code": code},
                ),
            )
        await repo.mark_failed("job-1", error_message="x", error_type="E")
        await repo.retry_for_new_attempt("job-1")
        await repo.attach_execution_name("job-1", "exec-2")

        runner = FakePipelineRunner(
            partidas=[
                ("P001", {"code": "P001"}),  # already resolved → skipped
                ("P002", {"code": "P002"}),  # already resolved → skipped
                ("P003", {"code": "P003"}),  # NEW
            ]
        )
        uc = RunPipelineJobUseCase(
            repository=repo, pdf_storage=storage, runner=runner,
            heartbeat_interval_seconds=999,
            cancellation_poll_interval_seconds=999,
        )

        await uc.execute(job_id="job-1", attempt_id="att-2")

        # Runner saw the resume set.
        assert runner.received_resume_codes == {"P001", "P002"}
        # And only P003 was newly added.
        checkpoints = await repo.list_checkpoints("job-1")
        assert sorted(c.partidaCode for c in checkpoints) == [
            "P001", "P002", "P003"
        ]
        # Both attempts on file.
        attempts = await repo.list_attempts("job-1")
        assert [a.attemptNumber for a in attempts] == [1, 2]
        assert attempts[1].resumeFromCount == 2


# ---------------------------------------------------------------------------
# Failure → mark_failed
# ---------------------------------------------------------------------------


class TestFailure:
    async def test_exception_propagates_to_failed_status(self, repo, storage):
        await _seed_job(repo)
        runner = FakePipelineRunner(
            partidas=[
                ("P001", {"code": "P001"}),
                ("P002", {"code": "P002"}),
                ("P003", {"code": "P003"}),
            ],
            raise_at_index=2,
            exception_to_raise=ValueError("OOM at chunk 42"),
        )
        uc = RunPipelineJobUseCase(
            repository=repo, pdf_storage=storage, runner=runner,
            heartbeat_interval_seconds=999,
            cancellation_poll_interval_seconds=999,
        )

        with pytest.raises(ValueError):
            await uc.execute(job_id="job-1", attempt_id="att-1")

        job = await repo.get_by_id("job-1")
        assert job.status is JobStatus.FAILED
        assert "OOM at chunk 42" in job.errorMessage
        assert job.errorType == "ValueError"
        # The 2 partidas resolved before the crash WERE checkpointed.
        checkpoints = await repo.list_checkpoints("job-1")
        assert sorted(c.partidaCode for c in checkpoints) == ["P001", "P002"]

    async def test_pdf_download_failure_marks_failed(self, repo):
        await _seed_job(repo)

        class BrokenStorage(FakePdfStorage):
            async def download_to_bytes(self, *args, **kwargs):
                raise RuntimeError("GCS unavailable")

        uc = RunPipelineJobUseCase(
            repository=repo, pdf_storage=BrokenStorage(),
            runner=FakePipelineRunner(),
            heartbeat_interval_seconds=999,
            cancellation_poll_interval_seconds=999,
        )

        with pytest.raises(RuntimeError):
            await uc.execute(job_id="job-1", attempt_id="att-1")

        job = await repo.get_by_id("job-1")
        assert job.status is JobStatus.FAILED
        assert "GCS unavailable" in job.errorMessage


# ---------------------------------------------------------------------------
# Cancellation → mark_canceled (the regression the whole rewrite exists for)
# ---------------------------------------------------------------------------


class TestCancellation:
    async def test_cancelled_error_maps_to_canceled_status(self, repo, storage):
        await _seed_job(repo)
        runner = FakePipelineRunner(
            partidas=[("P001", {"code": "P001"})],
            raise_at_index=0,
            exception_to_raise=asyncio.CancelledError(),
        )
        uc = RunPipelineJobUseCase(
            repository=repo, pdf_storage=storage, runner=runner,
            heartbeat_interval_seconds=999,
            cancellation_poll_interval_seconds=999,
        )

        # CancelledError re-propagates so the worker process sees exit 1
        # via the BaseException path. The job status is still recorded.
        with pytest.raises(asyncio.CancelledError):
            await uc.execute(job_id="job-1", attempt_id="att-1")

        job = await repo.get_by_id("job-1")
        assert job.status is JobStatus.CANCELED
        assert job.finishedAt is not None
        # finishedAt must be set so the UI can stop polling.

    async def test_polling_detects_cancellation_requested(
        self, repo, storage
    ):
        await _seed_job(repo)

        # Runner sleeps long enough for the poller to detect the flag.
        runner = FakePipelineRunner(
            partidas=[("P001", {"code": "P001"}), ("P002", {"code": "P002"})],
            sleep_per_partida=0.05,
        )
        uc = RunPipelineJobUseCase(
            repository=repo, pdf_storage=storage, runner=runner,
            heartbeat_interval_seconds=999,
            # Tight poll so the test runs fast.
            cancellation_poll_interval_seconds=0.01,
        )

        async def request_cancel_shortly():
            await asyncio.sleep(0.02)
            await repo.request_cancellation("job-1")

        cancel_task = asyncio.create_task(request_cancel_shortly())
        try:
            with pytest.raises(asyncio.CancelledError):
                await uc.execute(job_id="job-1", attempt_id="att-1")
        finally:
            cancel_task.cancel()

        job = await repo.get_by_id("job-1")
        assert job.status is JobStatus.CANCELED


# ---------------------------------------------------------------------------
# Heartbeat
# ---------------------------------------------------------------------------


class TestHeartbeat:
    async def test_heartbeat_bumps_updatedAt(self, repo, storage):
        await _seed_job(repo)
        runner = FakePipelineRunner(
            partidas=[("P001", {"code": "P001"})],
            sleep_per_partida=0.05,
        )
        uc = RunPipelineJobUseCase(
            repository=repo, pdf_storage=storage, runner=runner,
            heartbeat_interval_seconds=0.01,
            cancellation_poll_interval_seconds=999,
        )

        before = (await repo.get_by_id("job-1")).updatedAt
        await uc.execute(job_id="job-1", attempt_id="att-1")
        after = (await repo.get_by_id("job-1")).updatedAt
        # Multiple ticks should have fired during the run.
        assert after > before

"""Unit tests for FirestorePipelineJobRepository.

The Firestore client is mocked end-to-end — this matches the rest of the
ai-core codebase (e.g. test_firestore_catalog_repository.py uses MagicMock
of the Firestore client). Deep state-machine semantics are already covered
by the InMemory adapter contract tests; what we verify here is:

  1. PipelineJob serialises to / deserialises from Firestore dicts cleanly,
     including the JobStatus/JobType enums and datetimes.
  2. The right Firestore operations are issued for each public method.
  3. JobNotFoundError is raised when the doc is missing.

Production correctness of the atomic transitions (Firestore transactions
under contention) requires an emulator-based integration test, which the
plan tracks as P1.c follow-up work.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from unittest.mock import MagicMock

import pytest

from src.pipeline_jobs.domain.entities import (
    JobStatus,
    JobType,
    PipelineJob,
    PipelineJobAttempt,
    PipelineJobCheckpoint,
)
from src.pipeline_jobs.domain.exceptions import JobNotFoundError
from src.pipeline_jobs.infrastructure.firestore_pipeline_job_repository import (
    FirestorePipelineJobRepository,
    _dict_to_attempt,
    _dict_to_checkpoint,
    _dict_to_job,
    _job_to_dict,
)


def _make_job(**overrides) -> PipelineJob:
    defaults = dict(
        jobId="job-1",
        jobType=JobType.MEASUREMENTS,
        leadId="lead-1",
        budgetId="budget-1",
        uid="user-1",
        payload={"gcsUri": "gs://b/u/job-1/x.pdf", "strategy": "INLINE"},
    )
    defaults.update(overrides)
    return PipelineJob.new(**defaults)


# ---------------------------------------------------------------------------
# Serialisation round-trip — no Firestore at all
# ---------------------------------------------------------------------------


class TestSerialisationRoundtrip:
    def test_job_dict_roundtrip_preserves_all_fields(self):
        original = _make_job()
        as_dict = _job_to_dict(original)
        # Enums become string values for Firestore.
        assert as_dict["jobType"] == "measurements"
        assert as_dict["status"] == "queued"
        # Round-trip rebuilds an equivalent entity.
        rebuilt = _dict_to_job(as_dict)
        assert rebuilt.jobId == original.jobId
        assert rebuilt.jobType is JobType.MEASUREMENTS
        assert rebuilt.status is JobStatus.QUEUED
        assert rebuilt.payload == original.payload
        assert rebuilt.leadId == original.leadId

    def test_job_dict_handles_terminal_state(self):
        original = (
            _make_job()
            .claim_for_attempt("att-1")
            .mark_failed(error_message="boom", error_type="RuntimeError")
        )
        as_dict = _job_to_dict(original)
        rebuilt = _dict_to_job(as_dict)
        assert rebuilt.status is JobStatus.FAILED
        assert rebuilt.errorMessage == "boom"
        assert rebuilt.errorType == "RuntimeError"
        assert rebuilt.finishedAt is not None

    def test_attempt_dict_roundtrip(self):
        att = PipelineJobAttempt.new(
            attempt_id="att-1",
            attempt_number=2,
            resume_from_count=3,
            execution_name="projects/p/locations/l/jobs/j/executions/exec-x",
        )
        rebuilt = _dict_to_attempt(att.model_dump(mode="json", by_alias=True))
        assert rebuilt.attemptId == "att-1"
        assert rebuilt.attemptNumber == 2
        assert rebuilt.resumeFromCount == 3
        assert (
            rebuilt.executionName
            == "projects/p/locations/l/jobs/j/executions/exec-x"
        )

    def test_checkpoint_dict_roundtrip(self):
        cp = PipelineJobCheckpoint(
            partidaCode="P001",
            attemptId="att-1",
            partida={"code": "P001", "totalPrice": 12.5},
            tokenCost=3.5,
        )
        rebuilt = _dict_to_checkpoint(cp.model_dump(mode="json", by_alias=True))
        assert rebuilt.partidaCode == "P001"
        assert rebuilt.attemptId == "att-1"
        assert rebuilt.partida == {"code": "P001", "totalPrice": 12.5}
        assert rebuilt.tokenCost == 3.5


# ---------------------------------------------------------------------------
# Mock Firestore — verify the right operations are issued
# ---------------------------------------------------------------------------


def _wire_mock_db():
    """Build a MagicMock that mimics enough of `firebase_admin.firestore.client()`
    for the adapter's read paths. Returns (db_mock, collection_mock, doc_mock)."""
    db = MagicMock()
    collection = MagicMock()
    db.collection.return_value = collection
    doc_ref = MagicMock()
    collection.document.return_value = doc_ref
    return db, collection, doc_ref


@pytest.fixture
def db():
    db, _, _ = _wire_mock_db()
    return db


@pytest.fixture
def repo(db) -> FirestorePipelineJobRepository:
    return FirestorePipelineJobRepository(db=db)


class TestCreate:
    async def test_create_issues_create_call_with_serialised_dict(
        self, repo, db
    ):
        job = _make_job()
        doc_ref = db.collection.return_value.document.return_value
        await repo.create(job)
        db.collection.assert_called_with("pipeline_jobs")
        db.collection.return_value.document.assert_called_with("job-1")
        # `create()` is used (not set) so duplicate creation fails loudly.
        doc_ref.create.assert_called_once()
        payload = doc_ref.create.call_args.args[0]
        assert payload["jobId"] == "job-1"
        assert payload["status"] == "queued"
        assert payload["jobType"] == "measurements"


class TestGetById:
    async def test_get_by_id_returns_pipeline_job(self, repo, db):
        job = _make_job()
        doc_snapshot = MagicMock()
        doc_snapshot.exists = True
        doc_snapshot.to_dict.return_value = _job_to_dict(job)
        db.collection.return_value.document.return_value.get.return_value = (
            doc_snapshot
        )
        loaded = await repo.get_by_id("job-1")
        assert loaded.jobId == "job-1"
        assert loaded.status is JobStatus.QUEUED

    async def test_get_by_id_missing_raises_job_not_found(self, repo, db):
        doc_snapshot = MagicMock()
        doc_snapshot.exists = False
        db.collection.return_value.document.return_value.get.return_value = (
            doc_snapshot
        )
        with pytest.raises(JobNotFoundError):
            await repo.get_by_id("does-not-exist")


class TestSimpleMutations:
    """The non-transactional methods (touch, attach_execution_name,
    mark_dispatch_failed, request_cancellation, retry) issue a `get` + an
    `update` (or a transactional read-modify-write). We verify the
    semantics through round-trip with a stateful fake."""

    async def test_touch_updated_at_calls_update(self, repo, db):
        existing = _make_job()
        snapshot = MagicMock()
        snapshot.exists = True
        snapshot.to_dict.return_value = _job_to_dict(existing)
        db.collection.return_value.document.return_value.get.return_value = (
            snapshot
        )
        await repo.touch_updated_at("job-1")
        db.collection.return_value.document.return_value.update.assert_called_once()
        # The update payload includes ONLY updatedAt — heartbeat must be cheap.
        update_payload = (
            db.collection.return_value.document.return_value.update.call_args.args[
                0
            ]
        )
        assert set(update_payload.keys()) == {"updatedAt"}
        assert isinstance(update_payload["updatedAt"], datetime)

    async def test_attach_execution_name_writes_field(self, repo, db):
        existing = _make_job()
        snapshot = MagicMock()
        snapshot.exists = True
        snapshot.to_dict.return_value = _job_to_dict(existing)
        db.collection.return_value.document.return_value.get.return_value = (
            snapshot
        )
        await repo.attach_execution_name("job-1", "exec-xyz")
        db.collection.return_value.document.return_value.set.assert_called_once()
        payload = (
            db.collection.return_value.document.return_value.set.call_args.args[0]
        )
        assert payload["currentExecutionName"] == "exec-xyz"
        assert payload["status"] == "queued"


class TestSubcollectionReads:
    async def test_list_attempts_returns_sorted_by_number(self, repo, db):
        # Job exists.
        job_snapshot = MagicMock()
        job_snapshot.exists = True
        job_snapshot.to_dict.return_value = _job_to_dict(_make_job())
        db.collection.return_value.document.return_value.get.return_value = (
            job_snapshot
        )

        # Attempts sub-collection returns 2 docs.
        att1 = PipelineJobAttempt.new(
            attempt_id="a1", attempt_number=1, resume_from_count=0
        )
        att2 = PipelineJobAttempt.new(
            attempt_id="a2", attempt_number=2, resume_from_count=5
        )
        snaps = [MagicMock(), MagicMock()]
        snaps[0].to_dict.return_value = att1.model_dump(mode="json", by_alias=True)
        snaps[1].to_dict.return_value = att2.model_dump(mode="json", by_alias=True)

        attempts_col = MagicMock()
        attempts_col.stream.return_value = iter(snaps)
        db.collection.return_value.document.return_value.collection.return_value = (
            attempts_col
        )

        attempts = await repo.list_attempts("job-1")
        assert [a.attemptNumber for a in attempts] == [1, 2]

    async def test_list_checkpoints_returns_all_in_partida_code_order(
        self, repo, db
    ):
        job_snapshot = MagicMock()
        job_snapshot.exists = True
        job_snapshot.to_dict.return_value = _job_to_dict(_make_job())
        db.collection.return_value.document.return_value.get.return_value = (
            job_snapshot
        )

        cps_data: list[dict[str, Any]] = []
        for code in ("P003", "P001", "P002"):
            cps_data.append(
                PipelineJobCheckpoint(
                    partidaCode=code,
                    attemptId="att-1",
                    partida={"code": code},
                ).model_dump(mode="json", by_alias=True)
            )

        snaps = []
        for d in cps_data:
            s = MagicMock()
            s.to_dict.return_value = d
            snaps.append(s)
        cps_col = MagicMock()
        cps_col.stream.return_value = iter(snaps)
        db.collection.return_value.document.return_value.collection.return_value = (
            cps_col
        )

        cps = await repo.list_checkpoints("job-1")
        assert [c.partidaCode for c in cps] == ["P001", "P002", "P003"]

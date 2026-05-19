import pytest
from datetime import datetime
from unittest.mock import MagicMock

from src.pipeline_telemetry.domain.entities import TelemetryEvent
from src.pipeline_telemetry.application.use_cases.emit_telemetry_uc import EmitTelemetryUseCase
from src.pipeline_telemetry.infrastructure.firebase_telemetry_repository import (
    FirebaseTelemetryRepository,
)


class MockTelemetryRepository:
    def __init__(self):
        self.saved_events = []

    def save(self, event: TelemetryEvent) -> None:
        self.saved_events.append(event)


def test_telemetry_event_entity_defaults():
    data = {"step": "searching"}
    event = TelemetryEvent(job_id="job-123", event_type="test", data=data)

    assert event.job_id == "job-123"
    assert event.event_type == "test"
    assert event.data == data
    assert event.id is not None
    assert isinstance(event.timestamp, datetime)
    assert event.expires_at is None


def test_emit_telemetry_use_case_ttl():
    repo = MockTelemetryRepository()
    use_case = EmitTelemetryUseCase(repository=repo, ttl_hours=12)

    use_case.execute(job_id="job-456", event_type="progress", data={"percent": 50})

    assert len(repo.saved_events) == 1
    saved_event = repo.saved_events[0]

    assert saved_event.job_id == "job-456"
    assert saved_event.event_type == "progress"
    assert saved_event.data == {"percent": 50}

    # Check TTL Calculation
    assert saved_event.expires_at is not None
    time_diff = saved_event.expires_at - saved_event.timestamp
    assert time_diff.total_seconds() == pytest.approx(12 * 3600, rel=1e-2)


# ---------------------------------------------------------------------------
# Firestore adapter — regression for the "empty parent doc" bug.
# ---------------------------------------------------------------------------


def _wire_firestore_mock() -> tuple[MagicMock, MagicMock, MagicMock]:
    """Build a fluent mock that mirrors `firestore.client()` chain.

    Returns (db_mock, parent_doc_ref_mock, event_doc_ref_mock) so individual
    tests can assert which path got `.set(...)` called.
    """
    db = MagicMock()
    parent_doc = MagicMock()
    events_collection = MagicMock()
    event_doc = MagicMock()

    parent_doc.collection.return_value = events_collection
    events_collection.document.return_value = event_doc

    root_collection = MagicMock()
    root_collection.document.return_value = parent_doc
    db.collection.return_value = root_collection
    return db, parent_doc, event_doc


def test_save_writes_parent_doc_for_admin_list_query():
    """Regression: before P5.a the repo only wrote the leaf event document.
    Firestore does NOT auto-create the parent doc at
    `pipeline_telemetry/{jobId}`, so `collection('pipeline_telemetry').get()`
    returned [] and the admin UI at /dashboard/admin/jobs showed no jobs.

    The save() implementation must touch the parent BEFORE writing the event.
    """
    db, parent_doc, event_doc = _wire_firestore_mock()
    repo = FirebaseTelemetryRepository(db=db)

    event = TelemetryEvent(
        job_id="job-789",
        event_type="progress",
        data={"step": "x"},
    )
    repo.save(event)

    # Parent doc was set with jobId + updatedAt (merge=True keeps prior fields).
    assert parent_doc.set.called
    args, kwargs = parent_doc.set.call_args
    parent_payload = args[0]
    assert parent_payload["jobId"] == "job-789"
    assert "updatedAt" in parent_payload
    # merge=True so we never blow away the event subcollection or other fields.
    assert kwargs.get("merge") is True

    # Event leaf doc was set with the telemetry payload.
    assert event_doc.set.called
    event_payload = event_doc.set.call_args.args[0]
    assert event_payload["type"] == "progress"
    assert event_payload["jobId"] == "job-789"


def test_save_swallows_exceptions_to_not_kill_pipeline():
    """The telemetry write is fire-and-forget — a Firestore outage must
    NOT crash the budget pipeline. Verify .save() returns normally even when
    the underlying client raises."""
    db, parent_doc, event_doc = _wire_firestore_mock()
    parent_doc.set.side_effect = RuntimeError("firestore down")
    repo = FirebaseTelemetryRepository(db=db)

    event = TelemetryEvent(
        job_id="job-resilience",
        event_type="progress",
        data={},
    )
    # Should NOT raise.
    repo.save(event)

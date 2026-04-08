import pytest
from datetime import datetime
from src.pipeline_telemetry.domain.entities import TelemetryEvent
from src.pipeline_telemetry.application.use_cases.emit_telemetry_uc import EmitTelemetryUseCase

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

import pytest
from datetime import datetime
from typing import Any, Dict, List, Tuple
from src.pipeline_telemetry.domain.entities import TelemetryEvent
from src.pipeline_telemetry.application.use_cases.emit_telemetry_uc import EmitTelemetryUseCase

class MockTelemetryRepository:
    def __init__(self):
        self.saved_events = []

    def save(self, event: TelemetryEvent) -> None:
        self.saved_events.append(event)


class MockMetricsEmitter:
    """Records every metric call so assertions can verify routing.

    Does NOT pretend to be ``enabled``-aware unless explicitly set; the
    use-case treats a missing ``enabled`` attribute as 'go ahead'.
    """

    def __init__(self, enabled: bool = True):
        self.enabled = enabled
        self.calls: List[Tuple[str, Dict[str, Any]]] = []

    def emit_pipeline_job_duration_seconds(self, *, seconds, job_type, final_status):
        self.calls.append(("duration", {"seconds": seconds, "job_type": job_type, "final_status": final_status}))

    def emit_pipeline_job_total_cost_usd(self, *, cost_usd, job_type):
        self.calls.append(("cost", {"cost_usd": cost_usd, "job_type": job_type}))

    def increment_pipeline_job_failure(self, *, error_type):
        self.calls.append(("failure", {"error_type": error_type}))

    def emit_cache_hit_rate(self, *, rate):
        self.calls.append(("cache", {"rate": rate}))

    def increment_circuit_breaker_open(self):
        self.calls.append(("breaker", {}))

    def increment_llm_timeout(self, *, model):
        self.calls.append(("llm_timeout", {"model": model}))


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


def test_metrics_fan_out_on_budget_completed():
    repo = MockTelemetryRepository()
    metrics = MockMetricsEmitter()
    use_case = EmitTelemetryUseCase(repository=repo, metrics_emitter=metrics)

    use_case.execute(
        job_id="job-1",
        event_type="budget_completed",
        data={"durationSeconds": 42.0, "totalCostUsd": 0.50, "jobType": "nl-budget"},
    )

    # Firestore write still happens.
    assert len(repo.saved_events) == 1
    # Duration + cost emitted, no failure increment.
    kinds = [c[0] for c in metrics.calls]
    assert "duration" in kinds
    assert "cost" in kinds
    assert "failure" not in kinds


def test_metrics_fan_out_on_budget_failed():
    repo = MockTelemetryRepository()
    metrics = MockMetricsEmitter()
    use_case = EmitTelemetryUseCase(repository=repo, metrics_emitter=metrics)

    use_case.execute(
        job_id="job-2",
        event_type="budget_failed",
        data={"durationSeconds": 10.0, "errorType": "WorkerOOM", "jobType": "measurements"},
    )

    kinds = {c[0] for c in metrics.calls}
    assert "duration" in kinds
    assert "failure" in kinds
    failure = [c for c in metrics.calls if c[0] == "failure"][0]
    assert failure[1]["error_type"] == "WorkerOOM"


def test_metrics_fan_out_on_breaker_and_timeout():
    repo = MockTelemetryRepository()
    metrics = MockMetricsEmitter()
    use_case = EmitTelemetryUseCase(repository=repo, metrics_emitter=metrics)

    use_case.execute(job_id="j", event_type="circuit_breaker_opened", data={})
    use_case.execute(job_id="j", event_type="llm_timeout", data={"model": "gemini-2.5-flash"})
    use_case.execute(job_id="j", event_type="cache_hit_rate_sample", data={"rate": 0.73})

    kinds = [c[0] for c in metrics.calls]
    assert kinds == ["breaker", "llm_timeout", "cache"]
    assert metrics.calls[1][1]["model"] == "gemini-2.5-flash"
    assert metrics.calls[2][1]["rate"] == 0.73


def test_metrics_disabled_short_circuits_fanout():
    repo = MockTelemetryRepository()
    metrics = MockMetricsEmitter(enabled=False)
    use_case = EmitTelemetryUseCase(repository=repo, metrics_emitter=metrics)

    use_case.execute(
        job_id="job-3",
        event_type="budget_completed",
        data={"durationSeconds": 1.0, "jobType": "nl-budget"},
    )

    assert metrics.calls == []


def test_metrics_emitter_exception_does_not_break_persistence():
    class BoomEmitter:
        enabled = True
        def emit_pipeline_job_duration_seconds(self, **_):  # noqa: D401
            raise RuntimeError("monitoring api down")
        def emit_pipeline_job_total_cost_usd(self, **_):
            raise RuntimeError("monitoring api down")

    repo = MockTelemetryRepository()
    use_case = EmitTelemetryUseCase(repository=repo, metrics_emitter=BoomEmitter())

    # Should not raise.
    use_case.execute(
        job_id="job-4",
        event_type="budget_completed",
        data={"durationSeconds": 1.0, "totalCostUsd": 0.1, "jobType": "nl-budget"},
    )

    assert len(repo.saved_events) == 1

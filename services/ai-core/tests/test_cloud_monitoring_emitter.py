"""Unit tests for the CloudMonitoringEmitter — no real GCP traffic.

We override ``client_factory`` so the emitter uses a recording stub
instead of constructing a real ``MetricServiceClient``. Tests verify:
  - ``enabled`` is False when project_id is unset.
  - Disabled emitter is a no-op on every call.
  - Gauge writes call ``create_time_series`` with the right metric path.
  - Cumulative writes share the same ``start_time`` across emits for the
    same labelset (monotonicity invariant).
  - Exceptions inside the GCP client never propagate out.
"""

from src.pipeline_telemetry.infrastructure.cloud_monitoring_emitter import (
    CloudMonitoringEmitter,
    METRIC_PREFIX,
)


class RecordingClient:
    def __init__(self, *, fail: bool = False):
        self.calls = []
        self._fail = fail

    def create_time_series(self, *, name, time_series):  # noqa: D401
        if self._fail:
            raise RuntimeError("simulated monitoring failure")
        self.calls.append({"name": name, "time_series": list(time_series)})


def make_enabled_emitter(client: RecordingClient) -> CloudMonitoringEmitter:
    return CloudMonitoringEmitter(
        project_id="test-project",
        client_factory=lambda: client,
    )


def test_disabled_when_no_project_id():
    emitter = CloudMonitoringEmitter(project_id=None)
    assert emitter.enabled is False
    # Should not crash even though no client exists.
    emitter.emit_cache_hit_rate(rate=0.5)
    emitter.increment_circuit_breaker_open()


def test_gauge_emit_calls_monitoring_client():
    client = RecordingClient()
    emitter = make_enabled_emitter(client)
    emitter.emit_pipeline_job_duration_seconds(
        seconds=42.0,
        job_type="nl-budget",
        final_status="completed",
    )

    assert len(client.calls) == 1
    series_list = client.calls[0]["time_series"]
    assert len(series_list) == 1
    series = series_list[0]
    assert series.metric.type == f"{METRIC_PREFIX}/pipeline_job_duration_seconds"
    assert series.metric.labels["jobType"] == "nl-budget"
    assert series.metric.labels["finalStatus"] == "completed"
    assert client.calls[0]["name"] == "projects/test-project"


def test_cache_rate_is_clamped():
    client = RecordingClient()
    emitter = make_enabled_emitter(client)
    emitter.emit_cache_hit_rate(rate=2.5)  # out of bounds; should clamp to 1.0
    emitter.emit_cache_hit_rate(rate=-0.5)  # should clamp to 0.0
    assert len(client.calls) == 2
    v0 = client.calls[0]["time_series"][0].points[0].value.double_value
    v1 = client.calls[1]["time_series"][0].points[0].value.double_value
    assert v0 == 1.0
    assert v1 == 0.0


def test_cumulative_shares_start_time_across_emits():
    client = RecordingClient()
    emitter = make_enabled_emitter(client)
    emitter.increment_pipeline_job_failure(error_type="WorkerOOM")
    emitter.increment_pipeline_job_failure(error_type="WorkerOOM")
    emitter.increment_pipeline_job_failure(error_type="LLMTimeout")  # different label
    assert len(client.calls) == 3
    # First two share start; third has its own start.
    first_start = client.calls[0]["time_series"][0].points[0].interval.start_time.seconds
    second_start = client.calls[1]["time_series"][0].points[0].interval.start_time.seconds
    third_start = client.calls[2]["time_series"][0].points[0].interval.start_time.seconds
    assert first_start == second_start
    # Third labelset gets a fresh start_time (might equal first if same epoch
    # second — assert it's >=, not strictly greater).
    assert third_start >= first_start


def test_client_exception_does_not_propagate():
    client = RecordingClient(fail=True)
    emitter = make_enabled_emitter(client)
    # Should swallow the simulated failure.
    emitter.emit_pipeline_job_duration_seconds(
        seconds=1.0,
        job_type="nl-budget",
        final_status="completed",
    )
    emitter.increment_llm_timeout(model="gemini-2.5-flash")

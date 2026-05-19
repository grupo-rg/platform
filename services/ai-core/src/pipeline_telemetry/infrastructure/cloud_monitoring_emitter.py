"""Cloud Monitoring custom-metric emitter.

Bridge from the pipeline_telemetry domain events to Google Cloud
Monitoring (formerly Stackdriver) custom metrics. The dispatcher /
worker calls `emit_metric` from `EmitTelemetryUseCase` (when configured)
in parallel with the Firestore telemetry write, so the same event
populates both the in-app SSE timeline AND the GCP alerting plane.

Metrics implemented (custom.googleapis.com/dochevi/...):

  pipeline_job_duration_seconds       — GAUGE, labels {jobType, finalStatus}
  pipeline_job_total_cost_usd         — GAUGE, label {jobType}
  pipeline_job_failure_rate           — CUMULATIVE counter of failures by
                                        error_type; rate is derived in the
                                        Monitoring query.
  cache_hit_rate                      — GAUGE, value in [0,1]
  circuit_breaker_open_count          — CUMULATIVE counter of breaker trips
  llm_timeout_count                   — CUMULATIVE counter, label {model}

Design notes:

  - All writes are best-effort. Cloud Monitoring throttling, IAM, or
    project misconfiguration must NEVER crash the worker — losing a
    metric is preferable to failing a budget run. Every call is wrapped
    in try/except with a `logger.warning`.

  - The client is lazily constructed on first emit. Constructing the
    `MetricServiceClient` triggers credential resolution; we don't want
    that on import (it would break the unit tests for the rest of the
    pipeline).

  - GCP requires that, for CUMULATIVE metrics, every successive write of
    the same labelset uses the SAME `start_time`. We pin start_time to
    the moment of FIRST emit per labelset (held in `_cumulative_starts`)
    so the counter is monotonic from Monitoring's point of view.

See `services/ai-core/MONITORING.md` for the gcloud alert policy CLI
commands that consume these metrics.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)


METRIC_PREFIX = "custom.googleapis.com/dochevi"


class CloudMonitoringEmitter:
    """Lightweight wrapper around `google.cloud.monitoring_v3`.

    Disabled by default. Enable in production by setting
    `MONITORING_PROJECT_ID` (typically the same as GCLOUD_PROJECT) on the
    worker / dispatcher Cloud Run service.
    """

    def __init__(
        self,
        *,
        project_id: Optional[str] = None,
        client_factory: Optional[Any] = None,
    ) -> None:
        self._project_id = project_id or os.getenv("MONITORING_PROJECT_ID") or os.getenv("GCLOUD_PROJECT")
        self._client_factory = client_factory
        self._client = None
        self._lock = threading.Lock()
        # Per-labelset start_time for CUMULATIVE metrics.
        self._cumulative_starts: Dict[Tuple[str, Tuple[Tuple[str, str], ...]], float] = {}

    @property
    def enabled(self) -> bool:
        return bool(self._project_id)

    def _ensure_client(self):
        """Lazy-init the client; returns None if monitoring is disabled."""
        if not self.enabled:
            return None
        if self._client is not None:
            return self._client
        with self._lock:
            if self._client is not None:
                return self._client
            try:
                if self._client_factory is not None:
                    self._client = self._client_factory()
                else:
                    # Imported lazily so unit tests that don't touch this
                    # module never pay the cost of installing the SDK.
                    from google.cloud import monitoring_v3  # type: ignore
                    self._client = monitoring_v3.MetricServiceClient()
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "[cloud-monitoring] could not init client (monitoring disabled): %s",
                    exc,
                )
                self._client = None
            return self._client

    # ------------------------------------------------------------------
    # Public API — one method per metric so callers stay readable.
    # ------------------------------------------------------------------

    def emit_pipeline_job_duration_seconds(
        self,
        *,
        seconds: float,
        job_type: str,
        final_status: str,
    ) -> None:
        self._emit_gauge(
            metric_type="pipeline_job_duration_seconds",
            value=float(seconds),
            labels={"jobType": job_type, "finalStatus": final_status},
        )

    def emit_pipeline_job_total_cost_usd(
        self,
        *,
        cost_usd: float,
        job_type: str,
    ) -> None:
        self._emit_gauge(
            metric_type="pipeline_job_total_cost_usd",
            value=float(cost_usd),
            labels={"jobType": job_type},
        )

    def increment_pipeline_job_failure(self, *, error_type: str) -> None:
        self._emit_cumulative(
            metric_type="pipeline_job_failure_rate",
            increment=1,
            labels={"error_type": error_type},
        )

    def emit_cache_hit_rate(self, *, rate: float) -> None:
        # Clamp to [0,1] so a malformed caller can't poison the chart.
        rate = max(0.0, min(1.0, float(rate)))
        self._emit_gauge(
            metric_type="cache_hit_rate",
            value=rate,
            labels={},
        )

    def increment_circuit_breaker_open(self) -> None:
        self._emit_cumulative(
            metric_type="circuit_breaker_open_count",
            increment=1,
            labels={},
        )

    def increment_llm_timeout(self, *, model: str) -> None:
        self._emit_cumulative(
            metric_type="llm_timeout_count",
            increment=1,
            labels={"model": model},
        )

    # ------------------------------------------------------------------
    # Internals — actual Cloud Monitoring write paths.
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # Internal — light-weight dataclass-style stand-ins for monitoring_v3
    # primitives. They keep tests workable without the SDK installed AND
    # let the production code paths use the real types interchangeably
    # because the emitter only assigns attributes (no isinstance checks).
    # ------------------------------------------------------------------

    @staticmethod
    def _build_series(metric_type: str, labels: Dict[str, str], point_value, interval):
        # If google.cloud.monitoring_v3 is available, prefer its rich
        # types — they include all the protobuf fields Cloud Monitoring
        # requires when the call goes over the wire. Otherwise (tests,
        # disabled mode) fall back to plain attribute-only objects.
        try:
            from google.cloud import monitoring_v3  # type: ignore
            series = monitoring_v3.TimeSeries()
            series.metric.type = f"{METRIC_PREFIX}/{metric_type}"
            for k, v in labels.items():
                series.metric.labels[k] = v
            series.resource.type = "global"
            point = monitoring_v3.Point({"interval": interval, "value": point_value})
            series.points = [point]
            return series
        except Exception:  # noqa: BLE001
            # Plain Python stand-ins — only used in tests with an injected
            # client_factory. The structure intentionally mirrors what the
            # real types expose so the test assertions read naturally.
            class _Labels(dict):
                pass

            class _Metric:
                def __init__(self):
                    self.type = ""
                    self.labels = _Labels()

            class _Resource:
                def __init__(self):
                    self.type = ""

            class _Value:
                def __init__(self, payload):
                    self.double_value = payload.get("double_value", 0.0)
                    self.int64_value = payload.get("int64_value", 0)

            class _Point:
                def __init__(self, interval, payload):
                    self.interval = interval
                    self.value = _Value(payload)

            class _Series:
                def __init__(self):
                    self.metric = _Metric()
                    self.resource = _Resource()
                    self.points: list = []

            series = _Series()
            series.metric.type = f"{METRIC_PREFIX}/{metric_type}"
            for k, v in labels.items():
                series.metric.labels[k] = v
            series.resource.type = "global"
            series.points = [_Point(interval, point_value)]
            return series

    @staticmethod
    def _interval(end_seconds: int, end_nanos: int, start_seconds: Optional[int] = None, start_nanos: Optional[int] = None):
        try:
            from google.cloud import monitoring_v3  # type: ignore
            params = {"end_time": {"seconds": end_seconds, "nanos": end_nanos}}
            if start_seconds is not None:
                params["start_time"] = {"seconds": start_seconds, "nanos": start_nanos or 0}
            return monitoring_v3.TimeInterval(params)
        except Exception:  # noqa: BLE001
            class _T:
                def __init__(self, s, n):
                    self.seconds = s
                    self.nanos = n

            class _Interval:
                def __init__(self):
                    self.end_time = _T(end_seconds, end_nanos)
                    self.start_time = _T(start_seconds or 0, start_nanos or 0)

            return _Interval()

    def _emit_gauge(self, *, metric_type: str, value: float, labels: Dict[str, str]) -> None:
        client = self._ensure_client()
        if client is None:
            return
        try:
            now = time.time()
            seconds = int(now)
            nanos = int((now - seconds) * 1e9)
            interval = self._interval(seconds, nanos)
            series = self._build_series(
                metric_type=metric_type,
                labels=labels,
                point_value={"double_value": float(value)},
                interval=interval,
            )
            project_name = f"projects/{self._project_id}"
            client.create_time_series(name=project_name, time_series=[series])
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "[cloud-monitoring] emit_gauge(%s) failed: %s", metric_type, exc
            )

    def _emit_cumulative(
        self,
        *,
        metric_type: str,
        increment: float,
        labels: Dict[str, str],
    ) -> None:
        client = self._ensure_client()
        if client is None:
            return
        try:
            key = (metric_type, tuple(sorted(labels.items())))
            now = time.time()
            with self._lock:
                start = self._cumulative_starts.setdefault(key, now)
            start_seconds = int(start)
            start_nanos = int((start - start_seconds) * 1e9)
            end_seconds = int(now)
            end_nanos = int((now - end_seconds) * 1e9)
            interval = self._interval(end_seconds, end_nanos, start_seconds, start_nanos)
            series = self._build_series(
                metric_type=metric_type,
                labels=labels,
                point_value={"int64_value": int(increment)},
                interval=interval,
            )
            project_name = f"projects/{self._project_id}"
            client.create_time_series(name=project_name, time_series=[series])
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "[cloud-monitoring] emit_cumulative(%s) failed: %s",
                metric_type,
                exc,
            )


# Singleton accessor — keeps boilerplate at call sites to one import.
_default_emitter: Optional[CloudMonitoringEmitter] = None


def get_default_emitter() -> CloudMonitoringEmitter:
    global _default_emitter
    if _default_emitter is None:
        _default_emitter = CloudMonitoringEmitter()
    return _default_emitter


def reset_default_emitter_for_testing(emitter: Optional[CloudMonitoringEmitter] = None) -> None:
    """Reset the singleton — used by tests so each case sees a fresh emitter."""
    global _default_emitter
    _default_emitter = emitter

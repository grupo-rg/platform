from datetime import datetime, timedelta
from typing import Dict, Any, Optional
import logging

from src.pipeline_telemetry.domain.entities import TelemetryEvent
from src.pipeline_telemetry.application.ports import ITelemetryRepository

logger = logging.getLogger(__name__)


class EmitTelemetryUseCase:
    """
    Coordinates emitting a telemetry event, injecting the appropriate
    expiration configuration (TTL) to ensure the database remains clean.

    P2 addition: optionally fans out specific event types to Google Cloud
    Monitoring as custom metrics (durations, costs, failures, cache
    hit-rate, breaker trips, LLM timeouts). The metrics emitter is
    injected via the constructor; if absent OR if the emitter has no
    project configured, the fan-out becomes a no-op and the Firestore
    write proceeds exactly like before.

    The mapping from `event_type` to Cloud Monitoring metric is implemented
    here (not inside the emitter) so the emitter stays a pure infra
    adapter and we can unit-test the routing with mocks.
    """

    def __init__(
        self,
        repository: ITelemetryRepository,
        ttl_hours: int = 12,
        metrics_emitter: Optional[Any] = None,
    ):
        self.repository = repository
        self.ttl_hours = ttl_hours
        self.metrics_emitter = metrics_emitter

    def execute(self, job_id: str, event_type: str, data: Dict[str, Any]) -> None:
        """
        Creates and delegates the persistence of a telemetry event, plus
        optional Cloud Monitoring custom-metric emission.
        """
        expires_at = datetime.utcnow() + timedelta(hours=self.ttl_hours)

        event = TelemetryEvent(
            job_id=job_id,
            event_type=event_type,
            data=data,
            expires_at=expires_at,
        )

        self.repository.save(event)
        self._maybe_emit_metric(event_type, data)

    # ------------------------------------------------------------------
    # Cloud Monitoring routing — best-effort, never raises.
    # ------------------------------------------------------------------

    def _maybe_emit_metric(self, event_type: str, data: Dict[str, Any]) -> None:
        emitter = self.metrics_emitter
        if emitter is None:
            return
        # If the emitter exposes `enabled`, respect it so callers can
        # short-circuit without paying the cost of constructing a series.
        if hasattr(emitter, "enabled") and not getattr(emitter, "enabled"):
            return
        try:
            if event_type == "budget_completed":
                duration = float(data.get("durationSeconds") or data.get("duration_seconds") or 0.0)
                cost = float(data.get("totalCostUsd") or data.get("total_cost_usd") or 0.0)
                job_type = str(data.get("jobType") or data.get("job_type") or "unknown")
                if duration > 0:
                    emitter.emit_pipeline_job_duration_seconds(
                        seconds=duration,
                        job_type=job_type,
                        final_status="completed",
                    )
                if cost > 0:
                    emitter.emit_pipeline_job_total_cost_usd(
                        cost_usd=cost,
                        job_type=job_type,
                    )
            elif event_type == "budget_failed":
                duration = float(data.get("durationSeconds") or data.get("duration_seconds") or 0.0)
                error_type = str(data.get("errorType") or data.get("error_type") or "Unknown")
                job_type = str(data.get("jobType") or data.get("job_type") or "unknown")
                if duration > 0:
                    emitter.emit_pipeline_job_duration_seconds(
                        seconds=duration,
                        job_type=job_type,
                        final_status="failed",
                    )
                emitter.increment_pipeline_job_failure(error_type=error_type)
            elif event_type == "cache_hit_rate_sample":
                rate = float(data.get("rate") or 0.0)
                emitter.emit_cache_hit_rate(rate=rate)
            elif event_type == "circuit_breaker_opened":
                emitter.increment_circuit_breaker_open()
            elif event_type == "llm_timeout":
                model = str(data.get("model") or "unknown")
                emitter.increment_llm_timeout(model=model)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "[emit-telemetry] metrics fan-out for event_type=%s failed: %s",
                event_type,
                exc,
            )

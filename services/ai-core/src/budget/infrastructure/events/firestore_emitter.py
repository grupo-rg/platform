import logging
from typing import Dict, Any

from src.budget.application.ports.ports import IGenerationEmitter
from src.pipeline_telemetry.application.use_cases.emit_telemetry_uc import EmitTelemetryUseCase

logger = logging.getLogger(__name__)

class FirestoreProgressEmitter(IGenerationEmitter):
    """
    Adapter for real-time streaming of UI progress.
    Delegates persistence to the PipelineTelemetry domain to decouple
    ephemeral streaming from local logic and ensure TTL enforcement.
    """
    
    def __init__(self, emit_uc: EmitTelemetryUseCase):
        self.emit_uc = emit_uc

    def emit_event(self, budget_id: str, event_type: str, data: Dict[str, Any]) -> None:
        """Publishes progress data using the telemetry pipeline."""
        try:
            self.emit_uc.execute(job_id=budget_id, event_type=event_type, data=data)
            logger.debug(f"Emitted telemetry event [{event_type}] for Job {budget_id}")
            
        except Exception as e:
            # We don't want a UI progress error to crash the whole generation
            logger.error(f"Failed to emit telemetry event [{event_type}]: {str(e)}")

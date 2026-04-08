from datetime import datetime, timedelta
from typing import Dict, Any

from src.pipeline_telemetry.domain.entities import TelemetryEvent
from src.pipeline_telemetry.application.ports import ITelemetryRepository

class EmitTelemetryUseCase:
    """
    Coordinates emitting a telemetry event, injecting the appropriate
    expiration configuration (TTL) to ensure the database remains clean.
    """
    
    def __init__(self, repository: ITelemetryRepository, ttl_hours: int = 12):
        self.repository = repository
        self.ttl_hours = ttl_hours
        
    def execute(self, job_id: str, event_type: str, data: Dict[str, Any]) -> None:
        """
        Creates and delegates the persistence of a telemetry event.
        """
        expires_at = datetime.utcnow() + timedelta(hours=self.ttl_hours)
        
        event = TelemetryEvent(
            job_id=job_id,
            event_type=event_type,
            data=data,
            expires_at=expires_at
        )
        
        self.repository.save(event)

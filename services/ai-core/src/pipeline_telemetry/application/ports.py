from abc import ABC, abstractmethod
from src.pipeline_telemetry.domain.entities import TelemetryEvent

class ITelemetryRepository(ABC):
    """
    Output Port for persisting pipeline telemetry events.
    The underlying implementation should place these out of standard
    business schemas (CRM) and rely on NoSQL fast-writes.
    """
    
    @abstractmethod
    def save(self, event: TelemetryEvent) -> None:
        """
        Persists a single telemetry event.
        Must honor the `expires_at` field if the underlying system supports native TTL.
        """
        pass

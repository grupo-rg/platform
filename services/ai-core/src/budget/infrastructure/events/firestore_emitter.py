import logging
from typing import Dict, Any
from datetime import datetime
from firebase_admin import firestore

from src.budget.application.ports.ports import IGenerationEmitter

logger = logging.getLogger(__name__)

class FirestoreProgressEmitter(IGenerationEmitter):
    """
    Adapter for real-time streaming of UI progress via Firebase WebSockets.
    Writes subtask status to the `generation_events` collection.
    """
    
    def __init__(self, collection_name: str = "generation_events"):
        self.collection_name = collection_name
        self.db = firestore.client()

    def emit_event(self, lead_id: str, event_type: str, data: Dict[str, Any]) -> None:
        """Publishes progress data to Firestore so the TS Frontend can listen to it."""
        try:
            event_payload = {
                "type": event_type,
                "timestamp": datetime.utcnow().isoformat(),
                "data": data,
            }
            # Creates an auto-id document in the events subcollection of the specific lead
            self.db.collection("leads").document(lead_id).collection(self.collection_name).add(event_payload)
            logger.debug(f"Emitted event [{event_type}] for lead {lead_id}")
            
        except Exception as e:
            # We don't want a UI progress error to crash the whole budget generation
            logger.error(f"Failed to emit Firestore event [{event_type}]: {str(e)}")

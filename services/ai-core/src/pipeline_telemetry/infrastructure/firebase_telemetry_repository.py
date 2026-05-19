import logging
from google.cloud import firestore
from src.pipeline_telemetry.domain.entities import TelemetryEvent
from src.pipeline_telemetry.application.ports import ITelemetryRepository

logger = logging.getLogger(__name__)

class FirebaseTelemetryRepository(ITelemetryRepository):
    """
    Firebase implementation of ITelemetryRepository.
    Writes flat into a root-level collection `pipeline_telemetry` designed for
    ephemeral streams and TTL constraints, disjointed from CRM constructs.
    """

    def __init__(self, db: firestore.Client):
        self.db = db

    def save(self, event: TelemetryEvent) -> None:
        try:
            # Collection architecture: pipeline_telemetry / {job_id} / events / {uuid}
            #
            # Firestore does NOT auto-create parent documents — writing only the
            # nested event leaves `pipeline_telemetry/{job_id}` as an empty
            # collection-only doc, which `collection('pipeline_telemetry').get()`
            # never returns. The admin UI at /dashboard/admin/jobs queries that
            # collection and was getting empty results despite emit_event() calls.
            #
            # We `set(..., merge=True)` the parent first so each event also
            # touches `updatedAt` for free — the admin UI can sort by it.
            parent_ref = self.db.collection('pipeline_telemetry') \
                                .document(event.job_id)
            parent_ref.set(
                {
                    "jobId": event.job_id,
                    "updatedAt": firestore.SERVER_TIMESTAMP,
                },
                merge=True,
            )

            doc_ref = parent_ref.collection('events').document(event.id)

            # Dump to dict, parsing datetime to iso or passing native python datetime
            # Firestore client handles python datetime out of the box
            payload = {
                "type": event.event_type,
                "data": event.data,
                "timestamp": event.timestamp,
                "expiresAt": event.expires_at,  # Field mapped to GCP TTL Policy
                "jobId": event.job_id
            }

            # Fire and forget
            doc_ref.set(payload)
        except Exception as e:
            logger.warning(f"[TelemetryRepo] Failed to emit telemetry event {event.event_type} for Job {event.job_id}: {e}")

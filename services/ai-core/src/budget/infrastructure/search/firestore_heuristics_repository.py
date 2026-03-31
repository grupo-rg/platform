import logging
from typing import List
from google.cloud.firestore_v1.vector import Vector
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.base_query import FieldFilter

from src.budget.application.ports.ports import IHeuristicsRepository
from src.budget.domain.entities import HeuristicFragment

logger = logging.getLogger(__name__)

class FirestoreHeuristicsRepository(IHeuristicsRepository):
    def __init__(self, db_client):
        self.db = db_client
        self.collection = self.db.collection('training_heuristics')

    def save(self, heuristic: HeuristicFragment, embedding: List[float] = None) -> None:
        data = heuristic.model_dump()
        if embedding:
            data['embedding'] = Vector(embedding)
        self.collection.document(heuristic.id).set(data)

    def find_nearest_golden_rules(self, query_vector: List[float], limit: int = 5) -> List[HeuristicFragment]:
        try:
            base_query = self.collection.where(filter=FieldFilter("status", "==", "golden"))
            
            # Use native Firestore Vector Search
            vector_query = base_query.find_nearest(
                vector_field="embedding",
                query_vector=Vector(query_vector),
                distance_measure=DistanceMeasure.COSINE,
                limit=limit
            )
            
            results = []
            for doc in vector_query.get():
                data = doc.to_dict()
                try:
                    # Exclude the vector itself from the Pydantic instantiation if it crashes
                    if "embedding" in data:
                        del data["embedding"]
                    results.append(HeuristicFragment(**data))
                except Exception as ex:
                    logger.warning(f"Skipping malformed heuristic {doc.id}: {ex}")
                    
            return results
        except Exception as e:
            logger.error(f"Firestore find_nearest failed: {e}")
            return []

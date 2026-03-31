import os
import logging
from typing import List, Dict, Any
from qdrant_client import QdrantClient
from qdrant_client.models import ScoredPoint

from src.budget.application.ports.ports import IVectorSearch

logger = logging.getLogger(__name__)

class QdrantCatalogAdapter(IVectorSearch):
    """
    Adapter for connecting to Qdrant Vector Database.
    Searches against the 'prices-2025-v004' collection.
    """
    
    def __init__(self, collection_name: str = "prices-2025-v004"):
        qdrant_url = os.environ.get("QDRANT_URL")
        qdrant_api_key = os.environ.get("QDRANT_API_KEY")
        
        if not qdrant_url or not qdrant_api_key:
            logger.warning("QDRANT_URL or QDRANT_API_KEY missing in Env. Proceeding without remote DB, will fail if actually called.")
            self.client = None
        else:
            self.client = QdrantClient(url=qdrant_url, api_key=qdrant_api_key)
            
        self.collection_name = collection_name

    def search_similar_items(self, query_vector: List[float], limit: int = 3, score_threshold: float = 0.5) -> List[Dict[str, Any]]:
        """
        Executes a semantic search using the Qdrant Cloud client.
        Note: The incoming 'query_vector' must be pre-embedded by an Embedding model.
        """
        if not self.client:
            raise ConnectionError("QdrantClient is not initialized. Check environment variables.")
        
        try:
            search_result: List[ScoredPoint] = self.client.search(
                collection_name=self.collection_name,
                query_vector=query_vector,
                limit=limit,
                score_threshold=score_threshold,
                with_payload=True # Crucial: We need the actual JSON payload (price, name, brand) back
            )
            
            # Map the Qdrant ScoredPoint object to a generic Dictionary for our Application Layer
            candidates = []
            for hit in search_result:
                payload = hit.payload or {}
                # Inject the score so the AI knows how close the match was
                payload["matchConfidence"] = hit.score 
                candidates.append(payload)
                
            return candidates
            
        except Exception as e:
            logger.error(f"Failed to execute semantic search in Qdrant: {str(e)}")
            # Fail gracefully, returning empty candidates so the AI Budget agent can at least try to guess the price
            return []

import logging
import math
from typing import List, Dict, Any
from firebase_admin import firestore
from google.cloud.firestore_v1.vector import Vector
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.base_query import FieldFilter

from src.budget.application.ports.ports import IVectorSearch

logger = logging.getLogger(__name__)

class FirestorePriceBookAdapter(IVectorSearch):
    """
    Adapter for connecting to Google Cloud Firestore's native Vector Search.
    Searches against the 'price_book_2025' collection with Hybrid Semantic + Keyword reranking.
    """
    
    def __init__(self):
        self.db = firestore.client()

    def _cosine_similarity(self, vec_a: List[float], vec_b: List[float]) -> float:
        """Calculate cosine similarity between two vectors."""
        if len(vec_a) != len(vec_b):
            return 0.0
        
        dot_product = sum(a * b for a, b in zip(vec_a, vec_b))
        norm_a = math.sqrt(sum(a * a for a in vec_a))
        norm_b = math.sqrt(sum(b * b for b in vec_b))
        
        if norm_a == 0 or norm_b == 0:
            return 0.0
            
        return dot_product / (norm_a * norm_b)

    def search_similar_items(self, query_vector: List[float], query_text: str = "", limit: int = 3, score_threshold: float = 0.5, chapter_filters: List[str] = None) -> List[Dict[str, Any]]:
        """
        Executes a Hybrid Firestore vector search:
        1. Fetches candidate pool via Cosine distance.
        2. Computes precise cosine similarity score.
        3. Reranks using keywords from the original query text.
        4. Applies strict array IN filtering if chapter_filters are provided.
        """
        try:
            # Firestore vector length safety truncation (matching poc_pipeline_v3 behavior)
            query_vector = query_vector[:768]
            
            logger.info(f"Searching Firestore with {len(query_vector)} dimensions...")
            collection_ref = self.db.collection('price_book_2025')
            
            # Fetch a larger candidate pool to rerank
            candidate_limit = limit * 3 if query_text else limit
            
            if chapter_filters and len(chapter_filters) > 0:
                # Max 10 items in `in` clause natively in Firestore
                safe_filters = chapter_filters[:10]
                vector_query = collection_ref.where(filter=FieldFilter("chapter", "in", safe_filters)).find_nearest(
                    vector_field="embedding",
                    query_vector=Vector(query_vector),
                    distance_measure=DistanceMeasure.COSINE,
                    limit=candidate_limit
                )
            else:
                vector_query = collection_ref.find_nearest(
                    vector_field="embedding",
                    query_vector=Vector(query_vector),
                    distance_measure=DistanceMeasure.COSINE,
                    limit=candidate_limit
                )
            
            docs = vector_query.get()
            candidates = []
            
            for doc in docs:
                data = doc.to_dict()
                stored_embedding = data.get('embedding')
                match_score = 0.0
                
                # Compute exact cosine similarity
                if stored_embedding:
                    vec = list(stored_embedding)
                    match_score = self._cosine_similarity(query_vector, vec)
                    
                data['matchScore'] = match_score
                data["id"] = doc.id
                
                # Remove large embedding
                if 'embedding' in data:
                    del data['embedding']
                    
                candidates.append(data)
                
            # Hybrid Keyword Reranking
            if query_text:
                keywords = [k for k in query_text.lower().split() if len(k) > 2]
                
                for candidate in candidates:
                    text = (candidate.get('description', '') or '').lower()
                    matches = sum(1 for kw in keywords if kw in text)
                    
                    keyword_score = (matches / len(keywords)) if keywords else 0.0
                    
                    # New Score = Vector * (1 + 0.5 * KeywordScore)
                    candidate['matchScore'] *= (1 + 0.5 * keyword_score)
                    
            # Final Sort and Limit
            candidates.sort(key=lambda x: x.get('matchScore', 0), reverse=True)
            return candidates[:limit]
            
        except Exception as e:
            logger.error(f"Failed to execute native Firestore hybrid search: {str(e)}")
            return []

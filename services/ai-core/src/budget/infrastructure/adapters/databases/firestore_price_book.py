import logging
import math
from typing import Any, Dict, List, Optional

from firebase_admin import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.vector import Vector

from src.budget.application.ports.ports import IVectorSearch

logger = logging.getLogger(__name__)

# Factor de degradación aplicado al `matchScore` cuando la unidad del
# candidato no es compatible dimensionalmente con la partida. No se excluye
# el candidato — el Judge aguas abajo decide; solo se le baja el ranking.
_DIMENSIONAL_MISMATCH_FACTOR = 0.3


class FirestorePriceBookAdapter(IVectorSearch):
    """Adapter de vector search sobre `price_book_2025`.

    La colección contiene documentos de dos `kind`:
      - `item`: la partida padre del libro (LVC010, etc.).
      - `breakdown`: un componente individual de una partida (oficial,
        material, maquinaria…).

    El adapter devuelve ambos kinds tal cual los indexamos — el Judge
    razona distinto según el kind. El campo `kind` se preserva en el dict
    de salida, junto con `unit_dimension` para que el caller pueda seguir
    razonando sobre compatibilidad.

    Filtro dimensional opcional: cuando el caller pasa la
    `partida_unit_dimension`, los candidatos con dimensión física distinta
    ven su `matchScore` degradado por `_DIMENSIONAL_MISMATCH_FACTOR`. Los
    candidatos sin `unit_dimension` (legacy / vacío) NO se degradan —
    preferimos ser permisivos y dejar que el Judge decida.
    """

    def __init__(self, db: Optional[Any] = None) -> None:
        # db inyectable para tests; en producción default al cliente de
        # firebase_admin inicializado globalmente.
        self.db = db if db is not None else firestore.client()

    def _cosine_similarity(self, vec_a: List[float], vec_b: List[float]) -> float:
        if len(vec_a) != len(vec_b):
            return 0.0
        dot_product = sum(a * b for a, b in zip(vec_a, vec_b))
        norm_a = math.sqrt(sum(a * a for a in vec_a))
        norm_b = math.sqrt(sum(b * b for b in vec_b))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot_product / (norm_a * norm_b)

    def search_similar_items(
        self,
        query_vector: List[float],
        query_text: str = "",
        limit: int = 3,
        score_threshold: float = 0.5,
        chapter_filters: Optional[List[str]] = None,
        partida_unit_dimension: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Hybrid Firestore vector search con reranking léxico + filtro dimensional.

        Args:
          query_vector: embedding de la query (se trunca a 768 por compat).
          query_text: texto original — habilita reranking léxico si no vacío.
          limit: número de candidatos a devolver tras reranking.
          score_threshold: umbral (actualmente informativo, no filtra).
          chapter_filters: lista de capítulos permitidos (max 10 por Firestore).
          partida_unit_dimension: si se pasa, degradamos candidatos con
            `unit_dimension` distinta para que queden al final del ranking.
        """
        try:
            # Firestore vector length safety truncation.
            query_vector = query_vector[:768]

            logger.info(f"Searching Firestore with {len(query_vector)} dimensions...")
            collection_ref = self.db.collection("price_book_2025")

            # Fetch a larger candidate pool to rerank.
            candidate_limit = limit * 3 if query_text else limit

            if chapter_filters and len(chapter_filters) > 0:
                # Max 10 items in `in` clause natively in Firestore.
                safe_filters = chapter_filters[:10]
                vector_query = collection_ref.where(
                    filter=FieldFilter("chapter", "in", safe_filters)
                ).find_nearest(
                    vector_field="embedding",
                    query_vector=Vector(query_vector),
                    distance_measure=DistanceMeasure.COSINE,
                    limit=candidate_limit,
                )
            else:
                vector_query = collection_ref.find_nearest(
                    vector_field="embedding",
                    query_vector=Vector(query_vector),
                    distance_measure=DistanceMeasure.COSINE,
                    limit=candidate_limit,
                )

            docs = vector_query.get()
            candidates: List[Dict[str, Any]] = []

            for doc in docs:
                data = doc.to_dict()
                stored_embedding = data.get("embedding")
                match_score = 0.0

                if stored_embedding:
                    vec = list(stored_embedding)
                    match_score = self._cosine_similarity(query_vector, vec)

                data["matchScore"] = match_score
                data["id"] = doc.id

                # Remove large embedding from the payload returned upstream.
                if "embedding" in data:
                    del data["embedding"]

                candidates.append(data)

            # Hybrid Keyword Reranking.
            if query_text:
                keywords = [k for k in query_text.lower().split() if len(k) > 2]
                for candidate in candidates:
                    text = (candidate.get("description", "") or "").lower()
                    matches = sum(1 for kw in keywords if kw in text)
                    keyword_score = (matches / len(keywords)) if keywords else 0.0
                    candidate["matchScore"] *= (1 + 0.5 * keyword_score)

            # Dimensional degradation: solo si el caller aportó la dim de la
            # partida Y el candidato tiene su propia dim declarada. Los
            # candidatos sin `unit_dimension` no se degradan (permissive).
            if partida_unit_dimension:
                for candidate in candidates:
                    cand_dim = candidate.get("unit_dimension")
                    if cand_dim and cand_dim != partida_unit_dimension:
                        candidate["matchScore"] *= _DIMENSIONAL_MISMATCH_FACTOR

            # Final Sort and Limit.
            candidates.sort(key=lambda x: x.get("matchScore", 0), reverse=True)
            return candidates[:limit]

        except Exception as e:
            logger.error(f"Failed to execute native Firestore hybrid search: {str(e)}")
            return []

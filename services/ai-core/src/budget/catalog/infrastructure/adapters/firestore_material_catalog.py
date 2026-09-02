"""Adapter de vector search sobre `material_catalog` (OBRAMAT).

Espeja `FirestorePriceBookAdapter` pero sobre la colección de materiales:
~29k productos con `price` real y `embedding` 768-dim (mismo modelo
`gemini-embedding-001@768` que la query del pricing → coseno válido).

Se usa en el motor de composición (`from_scratch`) para valorar el material
con precios reales de catálogo, respetando la regla de "no inventar precios".
"""
from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Optional

from firebase_admin import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.vector import Vector

from src.budget.catalog.application.ports.material_search import IMaterialSearch

logger = logging.getLogger(__name__)

COLLECTION = "material_catalog"


class FirestoreMaterialCatalogAdapter(IMaterialSearch):
    def __init__(self, db: Optional[Any] = None) -> None:
        # db inyectable para tests; en prod default al cliente global.
        self.db = db if db is not None else firestore.client()

    @staticmethod
    def _cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
        if len(vec_a) != len(vec_b):
            return 0.0
        dot = sum(a * b for a, b in zip(vec_a, vec_b))
        norm_a = math.sqrt(sum(a * a for a in vec_a))
        norm_b = math.sqrt(sum(b * b for b in vec_b))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)

    def search_materials(
        self,
        query_vector: List[float],
        query_text: str = "",
        limit: int = 5,
        category_filter: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        try:
            qv = query_vector[:768]  # safety truncation (Firestore vector length)
            coll = self.db.collection(COLLECTION)
            candidate_pool = limit * 3 if query_text else limit

            if category_filter:
                vector_query = coll.where(
                    filter=FieldFilter("category", "==", category_filter)
                ).find_nearest(
                    vector_field="embedding",
                    query_vector=Vector(qv),
                    distance_measure=DistanceMeasure.COSINE,
                    limit=candidate_pool,
                )
            else:
                vector_query = coll.find_nearest(
                    vector_field="embedding",
                    query_vector=Vector(qv),
                    distance_measure=DistanceMeasure.COSINE,
                    limit=candidate_pool,
                )

            candidates: List[Dict[str, Any]] = []
            for doc in vector_query.get():
                data = doc.to_dict() or {}
                stored = data.get("embedding")
                score = self._cosine_similarity(qv, list(stored)) if stored else 0.0
                candidates.append({
                    "sku": data.get("sku"),
                    "id": doc.id,
                    "name": data.get("name"),
                    "description": data.get("description"),
                    "unit": data.get("unit"),
                    "price": data.get("price"),
                    "category": data.get("category"),
                    "matchScore": score,
                })

            # Reranking léxico: sube candidatos cuyo texto contiene keywords de la query.
            if query_text:
                keywords = [k for k in query_text.lower().split() if len(k) > 2]
                if keywords:
                    for c in candidates:
                        text = f"{c.get('name', '') or ''} {c.get('description', '') or ''}".lower()
                        matches = sum(1 for kw in keywords if kw in text)
                        c["matchScore"] *= (1 + 0.5 * (matches / len(keywords)))

            candidates.sort(key=lambda x: x.get("matchScore", 0.0), reverse=True)
            return candidates[:limit]

        except Exception as e:  # nunca lanzamos hacia el pricing
            logger.error(f"[material_catalog] search failed: {e}")
            return []

"""Adapter Firestore del `IHeuristicFragmentRepository`.

Colección: `heuristic_fragments`. Tabla esperada pequeña-mediana (cientos,
no miles — una corrección aprobada por partida corregida). Sin vector index
en esta fase: retrieval híbrido (tag `chapter:XXX` + stream + fuzzy client-side),
barato por el tamaño.

Firestore no soporta fuzzy matching nativo; la similaridad y el ranking se
delegan al helper puro en `application._retrieval`.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from src.budget.domain.entities import HeuristicFragment
from src.budget.learning.application._retrieval import filter_and_rank_fragments
from src.budget.learning.application.ports.heuristic_fragment_repository import (
    IHeuristicFragmentRepository,
)

logger = logging.getLogger(__name__)

COLLECTION_NAME = "heuristic_fragments"


class FirestoreHeuristicFragmentRepository(IHeuristicFragmentRepository):
    def __init__(self, db: Any) -> None:
        self.db = db

    async def save(self, fragment: HeuristicFragment) -> None:
        ref = self.db.collection(COLLECTION_NAME).document(fragment.id)
        ref.set(fragment.model_dump(mode="json"))

    async def find_by_id(self, fragment_id: str) -> Optional[HeuristicFragment]:
        doc = self.db.collection(COLLECTION_NAME).document(fragment_id).get()
        if not getattr(doc, "exists", False):
            return None
        data = doc.to_dict()
        if data is None:
            return None
        try:
            return HeuristicFragment.model_validate(data)
        except Exception as e:
            logger.warning(f"Skipping malformed heuristic_fragment doc {fragment_id}: {e}")
            return None

    async def find_relevant(
        self,
        chapter: str,
        description: str,
        similarity_threshold: float = 0.70,
        min_count: int = 2,
        max_age_months: int = 12,
        partida_code: str | None = None,
    ) -> list[HeuristicFragment]:
        fragments: list[HeuristicFragment] = []
        for snap in self.db.collection(COLLECTION_NAME).stream():
            data = snap.to_dict()
            if data is None:
                continue
            try:
                fragments.append(HeuristicFragment.model_validate(data))
            except Exception as e:
                logger.warning(
                    f"Skipping malformed heuristic_fragment doc {getattr(snap, 'id', '?')}: {e}"
                )
                continue

        return filter_and_rank_fragments(
            fragments,
            chapter=chapter,
            description=description,
            similarity_threshold=similarity_threshold,
            min_count=min_count,
            max_age_months=max_age_months,
            partida_code=partida_code,
        )

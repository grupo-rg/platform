"""Adapter Firestore del `ICatalogRepository`.

Colección: `labor_rates_2025`. Tabla pequeña (<100 docs). Sin embedding —
el Judge invoca `get_labor_rate(query)` vía tool call, no via vector search.

Diseñado para testing: acepta cualquier cliente con la forma estándar de
`firebase_admin.firestore.client()` (collection/document/set/get + batch).
Los tests inyectan un fake; en producción se inyecta el cliente real.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from src.budget.catalog.application.ports.catalog_repository import ICatalogRepository
from src.budget.catalog.domain.entities import LaborRate

logger = logging.getLogger(__name__)

COLLECTION_NAME = "labor_rates_2025"


class FirestoreCatalogRepository(ICatalogRepository):
    def __init__(self, db: Any) -> None:
        self.db = db

    async def get_labor_rate_by_id(self, id: str) -> Optional[LaborRate]:
        doc = self.db.collection(COLLECTION_NAME).document(id).get()
        if not getattr(doc, "exists", False):
            return None
        data = doc.to_dict()
        if data is None:
            return None
        return LaborRate.model_validate(data)

    async def find_labor_rates(
        self,
        query: str,
        trade: Optional[str] = None,
        limit: int = 5,
    ) -> list[LaborRate]:
        # Tabla pequeña (<100 docs): stream completo + fuzzy en memoria.
        # Más simple y determinista que índices compuestos Firestore.
        tokens = [t for t in (query or "").lower().split() if t]
        all_rates: list[LaborRate] = []
        for snap in self.db.collection(COLLECTION_NAME).stream():
            data = snap.to_dict()
            if data is None:
                continue
            try:
                all_rates.append(LaborRate.model_validate(data))
            except Exception as e:
                logger.warning(f"Skipping malformed labor_rate doc: {e}")

        scored: list[tuple[int, LaborRate]] = []
        for rate in all_rates:
            if trade is not None and (rate.trade or "") != trade:
                continue
            haystack = " ".join([
                rate.category,
                rate.trade or "",
                rate.label_es,
                " ".join(rate.aliases),
            ]).lower()
            score = sum(1 for t in tokens if t in haystack)
            if score > 0:
                scored.append((score, rate))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [r for _, r in scored[:limit]]

    async def save_labor_rate(self, labor_rate: LaborRate) -> None:
        doc_ref = self.db.collection(COLLECTION_NAME).document(labor_rate.id)
        doc_ref.set(labor_rate.model_dump())

    async def save_labor_rates_batch(self, rates: list[LaborRate]) -> None:
        batch = self.db.batch()
        col = self.db.collection(COLLECTION_NAME)
        for r in rates:
            batch.set(col.document(r.id), r.model_dump())
        batch.commit()

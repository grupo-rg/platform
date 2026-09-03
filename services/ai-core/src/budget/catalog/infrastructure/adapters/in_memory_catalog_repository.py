"""Fake in-memory del `ICatalogRepository` para tests de dominio/aplicación.

Vive en infrastructure porque es un adapter intercambiable (igual que
FirestoreCatalogRepository), no una entidad de dominio. Sirve de:
  - Referencia viva del contrato del port (cualquier adapter debe superar
    los mismos tests de contrato).
  - Backend de los tests de service/use_case sin Firestore arrancado.
"""

from __future__ import annotations

from typing import Optional

from src.budget.catalog.application.ports.catalog_repository import ICatalogRepository
from src.budget.catalog.domain.entities import LaborRate, MachineryRate


class InMemoryCatalogRepository(ICatalogRepository):
    def __init__(self) -> None:
        self._rates: dict[str, LaborRate] = {}
        self._machinery: dict[str, MachineryRate] = {}

    async def get_labor_rate_by_id(self, id: str) -> Optional[LaborRate]:
        return self._rates.get(id)

    async def find_labor_rates(
        self,
        query: str,
        trade: Optional[str] = None,
        limit: int = 5,
    ) -> list[LaborRate]:
        tokens = [t for t in (query or "").lower().split() if t]
        scored: list[tuple[int, LaborRate]] = []
        for rate in self._rates.values():
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
        self._rates[labor_rate.id] = labor_rate

    async def save_labor_rates_batch(self, rates: list[LaborRate]) -> None:
        for r in rates:
            self._rates[r.id] = r

    # ---- Maquinaria -------------------------------------------------------

    async def get_machinery_rate_by_id(self, id: str) -> Optional[MachineryRate]:
        return self._machinery.get(id)

    async def find_machinery_rates(
        self,
        query: str,
        category: Optional[str] = None,
        limit: int = 5,
    ) -> list[MachineryRate]:
        tokens = [t for t in (query or "").lower().split() if t]
        scored: list[tuple[int, MachineryRate]] = []
        for rate in self._machinery.values():
            if category is not None and rate.category != category:
                continue
            haystack = " ".join([
                rate.category,
                rate.label_es,
                " ".join(rate.aliases),
            ]).lower()
            score = sum(1 for t in tokens if t in haystack)
            if score > 0:
                scored.append((score, rate))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [r for _, r in scored[:limit]]

    async def save_machinery_rate(self, machinery_rate: MachineryRate) -> None:
        self._machinery[machinery_rate.id] = machinery_rate

    async def save_machinery_rates_batch(self, rates: list[MachineryRate]) -> None:
        for r in rates:
            self._machinery[r.id] = r

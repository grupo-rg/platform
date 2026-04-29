"""`CatalogLookupService` — superficie de consulta del subdominio catalog.

Usada por el Judge del Swarm Pricing vía tool calls:
  - `get_labor_rate(query, trade?)` — busca tarifa de mano de obra.
  - `convert_measurement(value, from_unit, to_unit, bridge?)` — conversión
    determinista (Python puro, no LLM).

El service normaliza la jerga antes de consultar (la UI/LLM pueden enviar
`"Ud"`, `"m²"`, etc.), orquesta el repo y los value objects, y nunca lanza
excepciones: devuelve None/empty cuando no puede responder.
"""

from __future__ import annotations

from typing import Optional

from src.budget.catalog.application.ports.catalog_repository import ICatalogRepository
from src.budget.catalog.domain.entities import LaborRate
from src.budget.catalog.domain.measurement import Measurement, UnitConverter


class CatalogLookupService:
    def __init__(self, repo: ICatalogRepository) -> None:
        self.repo = repo

    async def get_labor_rate(
        self,
        query: str,
        trade: Optional[str] = None,
    ) -> Optional[LaborRate]:
        results = await self.repo.find_labor_rates(query=query, trade=trade, limit=1)
        return results[0] if results else None

    def convert_measurement(
        self,
        value: float,
        from_unit: str,
        to_unit: str,
        bridge: Optional[dict] = None,
    ) -> Optional[Measurement]:
        source = Measurement(value=value, unit=from_unit)
        return UnitConverter.convert(source=source, target_unit=to_unit, bridge=bridge)

"""Use case `SeedMachineryRatesUseCase` — núcleo testeable del seed de maquinaria.

Gemelo de `SeedLaborRatesUseCase` pero para la colección `machinery_rates_2025`
(tarifas de ALQUILER €/h de maquinaria). Recibe una lista de dicts (ya parseada
del JSON fuente) y:
  1. Valida cada entrada contra el schema `MachineryRate` (Pydantic).
  2. Separa válidas de inválidas ANTES de tocar el repo — evita estado parcial.
  3. Persiste las válidas en batch.
  4. Devuelve un `SeedReport` honesto: `saved_count + len(errors) == len(input)`.

Nota: los registros de scaffolding se siembran como PLACEHOLDER
(``rate_eur_hour = null`` + ``is_placeholder = true``). Son válidos contra el
schema (la tarifa es Optional a propósito), pero el compositor los tratará como
'sin tarifa' y marcará la partida ``needs_human_review`` hasta que el operador
rellene el €/h real de alquiler COAATMCA.
"""

from __future__ import annotations

from pydantic import ValidationError

from src.budget.catalog.application.ports.catalog_repository import ICatalogRepository
from src.budget.catalog.application.use_cases.seed_labor_rates_uc import (
    SeedEntryError,
    SeedReport,
)
from src.budget.catalog.domain.entities import MachineryRate


class SeedMachineryRatesUseCase:
    def __init__(self, repo: ICatalogRepository) -> None:
        self.repo = repo

    async def execute(self, entries: list[dict]) -> SeedReport:
        valid: list[MachineryRate] = []
        errors: list[SeedEntryError] = []

        for entry in entries:
            entry_id = entry.get("id", "<missing-id>")
            try:
                valid.append(MachineryRate.model_validate(entry))
            except ValidationError as e:
                errors.append(SeedEntryError(entry_id=str(entry_id), reason=str(e)))
            except Exception as e:
                errors.append(SeedEntryError(entry_id=str(entry_id), reason=f"{type(e).__name__}: {e}"))

        if valid:
            await self.repo.save_machinery_rates_batch(valid)

        return SeedReport(saved_count=len(valid), errors=errors)

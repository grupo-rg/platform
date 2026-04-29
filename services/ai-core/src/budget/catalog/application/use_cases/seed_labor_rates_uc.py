"""Use case `SeedLaborRatesUseCase` — núcleo testeable del seed.

Recibe una lista de dicts (ya parseada del JSON fuente) y:
  1. Valida cada entrada contra el schema `LaborRate` (Pydantic).
  2. Separa válidas de inválidas ANTES de tocar el repo — evita estado parcial.
  3. Persiste las válidas en batch.
  4. Devuelve un `SeedReport` honesto: `saved_count + len(errors) == len(input)`.

El script CLI (`scripts/seed_labor_rates_2025.py`) es un thin wrapper que
solo se encarga de cargar el JSON, instanciar repo y use case, y pintar el
report. No añade lógica; si hay que testearla, va aquí.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from pydantic import ValidationError

from src.budget.catalog.application.ports.catalog_repository import ICatalogRepository
from src.budget.catalog.domain.entities import LaborRate


@dataclass
class SeedEntryError:
    entry_id: str
    reason: str


@dataclass
class SeedReport:
    saved_count: int
    errors: list[SeedEntryError] = field(default_factory=list)


class SeedLaborRatesUseCase:
    def __init__(self, repo: ICatalogRepository) -> None:
        self.repo = repo

    async def execute(self, entries: list[dict]) -> SeedReport:
        valid: list[LaborRate] = []
        errors: list[SeedEntryError] = []

        for entry in entries:
            entry_id = entry.get("id", "<missing-id>")
            try:
                valid.append(LaborRate.model_validate(entry))
            except ValidationError as e:
                errors.append(SeedEntryError(entry_id=str(entry_id), reason=str(e)))
            except Exception as e:
                errors.append(SeedEntryError(entry_id=str(entry_id), reason=f"{type(e).__name__}: {e}"))

        if valid:
            await self.repo.save_labor_rates_batch(valid)

        return SeedReport(saved_count=len(valid), errors=errors)

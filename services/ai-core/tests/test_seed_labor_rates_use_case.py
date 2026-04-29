"""Fase 2.1 — tests del `SeedLaborRatesUseCase`.

El use case es el núcleo testeable del seed: toma una lista de dicts (ya
parseados del JSON fuente), valida cada uno contra el schema `LaborRate`,
y llama al repo en batch. El script CLI es un thin wrapper encima.

Invariantes:
  - Entradas válidas se persisten vía `repo.save_labor_rates_batch`.
  - Entradas inválidas (e.g. `rate_eur_hour <= 0`, falta `id`) se omiten
    y se reportan en `SeedReport.errors`.
  - La colección NUNCA queda en estado parcial por una entrada mala —
    el use case separa inválidas ANTES de llamar al repo, no durante.
  - El report es honesto: `saved_count + len(errors) == len(input)`.
"""

from __future__ import annotations

import asyncio

import pytest

from src.budget.catalog.application.use_cases.seed_labor_rates_uc import (
    SeedLaborRatesUseCase,
    SeedReport,
)
from src.budget.catalog.infrastructure.adapters.in_memory_catalog_repository import (
    InMemoryCatalogRepository,
)


def _valid_entry(**overrides) -> dict:
    base = {
        "id": "labor-oficial-1a-albanil",
        "category": "oficial_1a",
        "trade": "albañileria",
        "label_es": "Oficial 1ª albañil",
        "rate_eur_hour": 28.50,
        "source_book": "COAATMCA_2025",
        "source_page": 7,
        "aliases": ["oficial 1", "off 1a"],
    }
    base.update(overrides)
    return base


class TestSeedHappyPath:
    def test_saves_all_valid_entries(self) -> None:
        repo = InMemoryCatalogRepository()
        uc = SeedLaborRatesUseCase(repo=repo)
        entries = [
            _valid_entry(),
            _valid_entry(id="labor-peon-ordinario", category="peon_ordinario", trade=None),
        ]
        report = asyncio.run(uc.execute(entries))

        assert isinstance(report, SeedReport)
        assert report.saved_count == 2
        assert report.errors == []

        # Persisted
        assert asyncio.run(repo.get_labor_rate_by_id("labor-oficial-1a-albanil")) is not None
        assert asyncio.run(repo.get_labor_rate_by_id("labor-peon-ordinario")) is not None

    def test_empty_input_is_valid_noop(self) -> None:
        repo = InMemoryCatalogRepository()
        uc = SeedLaborRatesUseCase(repo=repo)
        report = asyncio.run(uc.execute([]))
        assert report.saved_count == 0
        assert report.errors == []


class TestSeedRejectsInvalidEntries:
    def test_rejects_zero_rate_but_saves_valid_siblings(self) -> None:
        repo = InMemoryCatalogRepository()
        uc = SeedLaborRatesUseCase(repo=repo)
        entries = [
            _valid_entry(),                                         # válida
            _valid_entry(id="bad", rate_eur_hour=0.0),              # inválida
            _valid_entry(id="labor-capataz", category="capataz"),   # válida
        ]
        report = asyncio.run(uc.execute(entries))

        assert report.saved_count == 2
        assert len(report.errors) == 1
        assert report.errors[0].entry_id == "bad"
        assert "rate_eur_hour" in report.errors[0].reason.lower()

        # La válida sibling se guardó pese al error de la intermedia
        assert asyncio.run(repo.get_labor_rate_by_id("labor-capataz")) is not None
        # La inválida no
        assert asyncio.run(repo.get_labor_rate_by_id("bad")) is None

    def test_rejects_missing_required_field(self) -> None:
        repo = InMemoryCatalogRepository()
        uc = SeedLaborRatesUseCase(repo=repo)
        entries = [
            {"category": "peon_ordinario", "rate_eur_hour": 22.0},   # falta id, label_es, source_*
        ]
        report = asyncio.run(uc.execute(entries))
        assert report.saved_count == 0
        assert len(report.errors) == 1

    def test_rejects_unknown_category(self) -> None:
        repo = InMemoryCatalogRepository()
        uc = SeedLaborRatesUseCase(repo=repo)
        entries = [_valid_entry(category="jefe_supremo")]
        report = asyncio.run(uc.execute(entries))
        assert report.saved_count == 0
        assert len(report.errors) == 1

    def test_report_accounts_for_every_input(self) -> None:
        repo = InMemoryCatalogRepository()
        uc = SeedLaborRatesUseCase(repo=repo)
        entries = [
            _valid_entry(),
            _valid_entry(id="bad1", rate_eur_hour=-5),
            _valid_entry(id="bad2", category="jefe_supremo"),
            _valid_entry(id="labor-peon-especialista", category="peon_especialista", trade=None),
        ]
        report = asyncio.run(uc.execute(entries))
        assert report.saved_count + len(report.errors) == len(entries)
        assert {e.entry_id for e in report.errors} == {"bad1", "bad2"}


class TestRealJsonFileMatchesSchema:
    """Valida que `data/coaatmca_2025_cuadros_base.json` (el fichero real
    versionado) se puede seedear sin errores. Es un contrato entre los datos
    y el schema: si alguien edita el JSON rompiendo el schema, el test rompe.
    """

    def test_real_json_seeds_without_errors(self) -> None:
        import json
        from pathlib import Path

        # Path relativo a la raíz del proyecto Python (services/ai-core/).
        json_path = Path(__file__).resolve().parents[1] / "data" / "coaatmca_2025_cuadros_base.json"
        assert json_path.exists(), f"Falta el fichero {json_path}"

        with json_path.open("r", encoding="utf-8") as f:
            payload = json.load(f)

        entries = payload["labor_rates"]
        assert isinstance(entries, list)
        assert len(entries) > 0

        repo = InMemoryCatalogRepository()
        uc = SeedLaborRatesUseCase(repo=repo)
        report = asyncio.run(uc.execute(entries))

        assert report.errors == [], (
            f"El JSON real tiene entradas inválidas: {[(e.entry_id, e.reason[:80]) for e in report.errors]}"
        )
        assert report.saved_count == len(entries)


class TestSeedIdempotency:
    def test_re_seeding_same_data_is_idempotent(self) -> None:
        repo = InMemoryCatalogRepository()
        uc = SeedLaborRatesUseCase(repo=repo)
        entries = [_valid_entry()]
        asyncio.run(uc.execute(entries))
        report2 = asyncio.run(uc.execute(entries))
        assert report2.saved_count == 1
        assert report2.errors == []
        # Sigue habiendo solo un documento
        got = asyncio.run(repo.get_labor_rate_by_id("labor-oficial-1a-albanil"))
        assert got is not None

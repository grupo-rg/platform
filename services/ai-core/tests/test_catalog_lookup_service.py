"""Fase 1.5 — tests del `CatalogLookupService`.

Este service es la superficie que el Judge del Swarm Pricing invoca como tool:
  - `get_labor_rate(query, trade?)` — busca tarifa de mano de obra.
  - `convert_measurement(value, from_unit, to_unit, bridge?)` — conversión.

Responsabilidades:
  - Orquestar repo + value objects.
  - Devolver siempre respuestas deterministas (no LLM dentro).
  - Normalizar la jerga de entrada (`Ud` == `ud`).
  - Degradarse limpiamente: None cuando no hay match, no exceptions.
"""

from __future__ import annotations

import asyncio

import pytest

from src.budget.catalog.application.services.catalog_lookup_service import (
    CatalogLookupService,
)
from src.budget.catalog.domain.entities import LaborRate
from src.budget.catalog.domain.measurement import Measurement
from src.budget.catalog.infrastructure.adapters.in_memory_catalog_repository import (
    InMemoryCatalogRepository,
)


def _seed(repo: InMemoryCatalogRepository) -> None:
    rates = [
        LaborRate(
            id="labor-oficial-1a-albanil",
            category="oficial_1a",
            trade="albañileria",
            label_es="Oficial 1ª albañil",
            rate_eur_hour=28.50,
            source_book="COAATMCA_2025",
            source_page=7,
            aliases=["oficial 1", "oficial primera", "off 1a"],
        ),
        LaborRate(
            id="labor-peon-ordinario",
            category="peon_ordinario",
            trade=None,
            label_es="Peón ordinario",
            rate_eur_hour=22.00,
            source_book="COAATMCA_2025",
            source_page=7,
            aliases=["peón", "peon"],
        ),
        LaborRate(
            id="labor-oficial-1a-fontanero",
            category="oficial_1a",
            trade="fontaneria",
            label_es="Oficial 1ª fontanero",
            rate_eur_hour=29.00,
            source_book="COAATMCA_2025",
            source_page=8,
            aliases=["oficial 1"],
        ),
    ]
    asyncio.run(repo.save_labor_rates_batch(rates))


class TestGetLaborRate:
    """`get_labor_rate` delega al repo con la jerga ya normalizada."""

    def test_returns_best_match_for_direct_category_query(self) -> None:
        repo = InMemoryCatalogRepository()
        _seed(repo)
        svc = CatalogLookupService(repo=repo)
        got = asyncio.run(svc.get_labor_rate(query="peón ordinario"))
        assert got is not None
        assert got.id == "labor-peon-ordinario"

    def test_disambiguates_with_trade_filter(self) -> None:
        repo = InMemoryCatalogRepository()
        _seed(repo)
        svc = CatalogLookupService(repo=repo)
        got = asyncio.run(svc.get_labor_rate(query="oficial 1", trade="fontaneria"))
        assert got is not None
        assert got.id == "labor-oficial-1a-fontanero"

    def test_returns_none_when_no_match(self) -> None:
        repo = InMemoryCatalogRepository()
        _seed(repo)
        svc = CatalogLookupService(repo=repo)
        got = asyncio.run(svc.get_labor_rate(query="jefe supremo intergalactico"))
        assert got is None

    def test_returns_top_scored_when_ambiguous(self) -> None:
        # Sin trade, "oficial 1" matchea a dos rates. Debe devolver una sola
        # (la de mejor score o la primera estable).
        repo = InMemoryCatalogRepository()
        _seed(repo)
        svc = CatalogLookupService(repo=repo)
        got = asyncio.run(svc.get_labor_rate(query="oficial 1"))
        assert got is not None
        assert got.category == "oficial_1a"


class TestConvertMeasurement:
    """`convert_measurement` delega al UnitConverter. Jerga permitida en entrada."""

    def test_acondicionamiento_case_m2_to_m3_with_thickness(self) -> None:
        # El caso canónico: 50 m² × 0.10 m = 5 m³
        svc = CatalogLookupService(repo=InMemoryCatalogRepository())
        result = svc.convert_measurement(
            value=50.0,
            from_unit="m2",
            to_unit="m3",
            bridge={"thickness_m": 0.10},
        )
        assert result is not None
        assert result.unit == "m3"
        assert result.value == pytest.approx(5.0)

    def test_accepts_jerga_on_from_unit(self) -> None:
        svc = CatalogLookupService(repo=InMemoryCatalogRepository())
        # Aparejador escribió "M²" (mayúscula + símbolo unicode)
        result = svc.convert_measurement(
            value=50.0,
            from_unit="M²",
            to_unit="m3",
            bridge={"thickness_m": 0.10},
        )
        assert result is not None
        assert result.value == pytest.approx(5.0)

    def test_returns_none_for_forbidden_conversion(self) -> None:
        svc = CatalogLookupService(repo=InMemoryCatalogRepository())
        # m² → ud sin puente válido
        result = svc.convert_measurement(
            value=50.0,
            from_unit="m2",
            to_unit="ud",
        )
        assert result is None

    def test_returns_none_without_required_bridge(self) -> None:
        svc = CatalogLookupService(repo=InMemoryCatalogRepository())
        # m3 → kg requiere density
        result = svc.convert_measurement(
            value=1.0,
            from_unit="m3",
            to_unit="kg",
        )
        assert result is None


class TestServiceContract:
    """Contratos transversales del service."""

    def test_constructor_accepts_icatalog_repository(self) -> None:
        # El service depende del puerto, no del adapter concreto.
        repo = InMemoryCatalogRepository()
        svc = CatalogLookupService(repo=repo)
        assert svc.repo is repo

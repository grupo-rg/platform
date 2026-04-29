"""Fase 5.A.3 — tests del helper `_prepare_tool_context` del Swarm.

Este helper **precomputa** las tools que el Judge va a necesitar antes de
invocar al LLM. Hoy cubre solo la conversión de unidades (el path "caliente"
del caso canónico del acondicionamiento). Las tarifas de mano de obra se
inyectan aparte, como parte del `{{rules}}` del prompt.

Entrada: un `RestructuredItem` (ya normalizado por el extractor).
Salida: dict serializable que se concatena al prompt como `{{tool_context}}`.

Contrato:
  - Sin `unit_conversion_hints` → `conversions` vacía.
  - Con hints válidos → ejecuta `catalog_lookup.convert_measurement()` y
    devuelve un `UnitConversionRecord` serializable por cada hint que
    produjo un resultado.
  - Si el hint existe pero la conversión devuelve `None` (puente incompatible),
    ese hint se descarta silenciosamente — el Judge verá que no hay
    conversion_applied y decidirá.
"""

from __future__ import annotations

import asyncio

import pytest

from src.budget.application.services.pdf_extractor_service import RestructuredItem
from src.budget.application.services.swarm_pricing_service import (
    SwarmPricingService,
    _prepare_tool_context,
)
from src.budget.catalog.application.services.catalog_lookup_service import (
    CatalogLookupService,
)
from src.budget.catalog.infrastructure.adapters.in_memory_catalog_repository import (
    InMemoryCatalogRepository,
)


def _partida(
    unit_normalized: str | None = "m2",
    unit_conversion_hints: dict | None = None,
    quantity: float = 50.0,
) -> RestructuredItem:
    return RestructuredItem(
        code="1.1",
        description="Acondicionamiento",
        quantity=quantity,
        unit="m2",
        unit_normalized=unit_normalized,
        unit_dimension="superficie",
        unit_conversion_hints=unit_conversion_hints,
        chapter="Movimiento de tierras",
    )


@pytest.fixture
def catalog() -> CatalogLookupService:
    return CatalogLookupService(repo=InMemoryCatalogRepository())


class TestNoHintsNoContext:
    def test_returns_empty_conversions_when_no_hints(self, catalog) -> None:
        partida = _partida(unit_conversion_hints=None)
        ctx = _prepare_tool_context(partida=partida, catalog=catalog)
        assert ctx["conversions"] == []

    def test_empty_hints_dict_is_noop(self, catalog) -> None:
        partida = _partida(unit_conversion_hints={})
        ctx = _prepare_tool_context(partida=partida, catalog=catalog)
        assert ctx["conversions"] == []


class TestThicknessHintTriggersM2ToM3:
    def test_canonical_case_50_m2_with_10cm_gives_5_m3(self, catalog) -> None:
        """El caso estrella del sprint: grava 10 cm espesor, 50 m² → 5 m³."""
        partida = _partida(
            unit_normalized="m2",
            quantity=50.0,
            unit_conversion_hints={"thickness_m": 0.10},
        )
        ctx = _prepare_tool_context(partida=partida, catalog=catalog)

        assert len(ctx["conversions"]) == 1
        conv = ctx["conversions"][0]
        assert conv["value"] == pytest.approx(50.0)
        assert conv["from_unit"] == "m2"
        assert conv["to_unit"] == "m3"
        assert conv["bridge"] == {"thickness_m": 0.10}
        assert conv["result"] == pytest.approx(5.0)

    def test_thickness_hint_from_m3_source_inverts_to_m2(self, catalog) -> None:
        partida = _partida(
            unit_normalized="m3",
            quantity=5.0,
            unit_conversion_hints={"thickness_m": 0.10},
        )
        ctx = _prepare_tool_context(partida=partida, catalog=catalog)

        assert len(ctx["conversions"]) == 1
        conv = ctx["conversions"][0]
        assert conv["from_unit"] == "m3"
        assert conv["to_unit"] == "m2"
        assert conv["result"] == pytest.approx(50.0)


class TestPieceLengthHint:
    def test_ml_to_ud_with_piece_length(self, catalog) -> None:
        partida = _partida(
            unit_normalized="ml",
            quantity=30.0,
            unit_conversion_hints={"piece_length_m": 3.0},
        )
        partida.unit_dimension = "lineal"  # type: ignore[attr-defined]
        ctx = _prepare_tool_context(partida=partida, catalog=catalog)
        assert len(ctx["conversions"]) == 1
        assert ctx["conversions"][0]["to_unit"] == "ud"
        assert ctx["conversions"][0]["result"] == pytest.approx(10.0)


class TestDensityHint:
    def test_m3_to_kg_with_density(self, catalog) -> None:
        partida = _partida(
            unit_normalized="m3",
            quantity=1.0,
            unit_conversion_hints={"density_kg_m3": 2400.0},
        )
        ctx = _prepare_tool_context(partida=partida, catalog=catalog)
        assert len(ctx["conversions"]) == 1
        assert ctx["conversions"][0]["to_unit"] == "kg"
        assert ctx["conversions"][0]["result"] == pytest.approx(2400.0)


class TestInvalidHintsAreSkipped:
    def test_unknown_hint_key_is_skipped_without_crash(self, catalog) -> None:
        partida = _partida(
            unit_normalized="m2",
            quantity=50.0,
            unit_conversion_hints={"yolo_factor": 0.5},
        )
        ctx = _prepare_tool_context(partida=partida, catalog=catalog)
        assert ctx["conversions"] == []

    def test_non_positive_bridge_value_is_skipped(self, catalog) -> None:
        partida = _partida(
            unit_normalized="m2",
            quantity=50.0,
            unit_conversion_hints={"thickness_m": 0.0},
        )
        ctx = _prepare_tool_context(partida=partida, catalog=catalog)
        assert ctx["conversions"] == []

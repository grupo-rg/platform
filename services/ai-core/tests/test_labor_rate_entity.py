"""Fase 1.3 — tests de la entidad `LaborRate`.

Representa una tarifa oficial COAATMCA 2025 de mano de obra (peón, oficial,
etc.). Se guarda en la colección Firestore `labor_rates_2025` y se consulta
vía `CatalogLookupService.get_labor_rate()` cuando el Judge necesita
componer una partida desde cero.

Invariantes:
  - `id` único, determinista — permite seed idempotente.
  - `rate_eur_hour` > 0 (no hay salarios negativos/cero en el libro).
  - `unit` siempre "h" (siempre cobrada por hora, por contrato del libro).
  - `source_book` y `source_page` son obligatorios → auditabilidad.
  - `aliases` es lista (puede estar vacía) — sirve para fuzzy lookup.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.budget.catalog.domain.entities import LaborRate


class TestLaborRateConstruction:
    """La entidad se construye con todos los campos obligatorios."""

    def test_builds_with_minimal_required_fields(self) -> None:
        lr = LaborRate(
            id="labor-oficial-1a-albanil",
            category="oficial_1a",
            trade="albañileria",
            label_es="Oficial 1ª albañil",
            rate_eur_hour=28.50,
            source_book="COAATMCA_2025",
            source_page=7,
        )
        assert lr.id == "labor-oficial-1a-albanil"
        assert lr.category == "oficial_1a"
        assert lr.rate_eur_hour == 28.50
        assert lr.unit == "h"  # default por contrato
        assert lr.aliases == []

    def test_trade_is_optional(self) -> None:
        # Peón ordinario genérico sin oficio
        lr = LaborRate(
            id="labor-peon-ordinario",
            category="peon_ordinario",
            label_es="Peón ordinario",
            rate_eur_hour=22.00,
            source_book="COAATMCA_2025",
            source_page=7,
        )
        assert lr.trade is None

    def test_accepts_aliases_for_fuzzy_lookup(self) -> None:
        lr = LaborRate(
            id="labor-oficial-1a-albanil",
            category="oficial_1a",
            trade="albañileria",
            label_es="Oficial 1ª albañil",
            rate_eur_hour=28.50,
            source_book="COAATMCA_2025",
            source_page=7,
            aliases=["oficial 1", "oficial primera", "off 1a"],
        )
        assert "oficial 1" in lr.aliases
        assert len(lr.aliases) == 3


class TestLaborRateValidation:
    """Invariantes estrictas — previenen datos basura en Firestore."""

    def test_rate_must_be_positive(self) -> None:
        with pytest.raises(ValidationError):
            LaborRate(
                id="x",
                category="oficial_1a",
                label_es="X",
                rate_eur_hour=0.0,
                source_book="COAATMCA_2025",
                source_page=7,
            )
        with pytest.raises(ValidationError):
            LaborRate(
                id="x",
                category="oficial_1a",
                label_es="X",
                rate_eur_hour=-10.0,
                source_book="COAATMCA_2025",
                source_page=7,
            )

    def test_required_fields_are_required(self) -> None:
        # Falta id
        with pytest.raises(ValidationError):
            LaborRate(  # type: ignore[call-arg]
                category="peon_ordinario",
                label_es="X",
                rate_eur_hour=20.0,
                source_book="COAATMCA_2025",
                source_page=7,
            )
        # Falta label_es
        with pytest.raises(ValidationError):
            LaborRate(  # type: ignore[call-arg]
                id="x",
                category="peon_ordinario",
                rate_eur_hour=20.0,
                source_book="COAATMCA_2025",
                source_page=7,
            )

    def test_category_must_be_known(self) -> None:
        # Categorías permitidas del COAATMCA: oficial_1a, oficial_2a,
        # peon_ordinario, peon_especialista, capataz, ayudante.
        # Un valor fuera de ese conjunto debe fallar.
        with pytest.raises(ValidationError):
            LaborRate(
                id="x",
                category="jefe_supremo",
                label_es="X",
                rate_eur_hour=20.0,
                source_book="COAATMCA_2025",
                source_page=7,
            )


class TestLaborRateSerialization:
    """La entidad debe poder serializarse/deserializarse para Firestore."""

    def test_round_trip_model_dump_and_validate(self) -> None:
        original = LaborRate(
            id="labor-oficial-1a-albanil",
            category="oficial_1a",
            trade="albañileria",
            label_es="Oficial 1ª albañil",
            rate_eur_hour=28.50,
            source_book="COAATMCA_2025",
            source_page=7,
            aliases=["oficial 1"],
        )
        as_dict = original.model_dump()
        restored = LaborRate.model_validate(as_dict)
        assert restored == original

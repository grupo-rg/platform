"""Fase 3.1 — tests de las entries `PriceBookItemEntry` + `PriceBookBreakdownEntry`
+ `EmbeddingTextBuilder`.

El nuevo price_book v005 escribe N+1 documentos por cada item del libro
original: un padre `kind="item"` y N hijos `kind="breakdown"`. Las entries
son Pydantic schemas que viven en domain/ (reused por el transformer y
por el adapter Firestore).

El text builder es una función pura que construye la cadena a embeder
para cada kind. Aislarlo aquí facilita A/B testing de variantes de prompt
de embedding sin tocar el transformer ni el use case.

Invariantes:
  - `PriceBookItemEntry.kind == "item"` (literal).
  - `PriceBookBreakdownEntry.kind == "breakdown"` (literal).
  - `PriceBookBreakdownEntry.code` tiene forma `{parent_code}#{idx:02d}`.
  - unit_normalized y unit_dimension se derivan de unit_raw vía Unit VO.
  - Los textos de embedding son deterministas: misma entry → mismo string.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.budget.catalog.domain.price_book_entry import (
    EmbeddingTextBuilder,
    PriceBookBreakdownEntry,
    PriceBookItemEntry,
)


# -------- PriceBookItemEntry ------------------------------------------------


class TestPriceBookItemEntry:
    def test_builds_with_minimal_required_fields(self) -> None:
        item = PriceBookItemEntry(
            code="LVC010",
            chapter="ACRISTALAMIENTOS",
            section="Vidrios dobles estándar",
            description="Suministro y colocación de doble acristalamiento...",
            unit_raw="m2",
            unit_normalized="m2",
            unit_dimension="superficie",
            priceTotal=75.02,
            source_page=353,
        )
        assert item.kind == "item"
        assert item.code == "LVC010"
        assert item.breakdown_ids == []
        assert item.source_book == "COAATMCA_2025"

    def test_breakdown_ids_are_serialized(self) -> None:
        item = PriceBookItemEntry(
            code="LVC010",
            chapter="ACRISTALAMIENTOS",
            section="",
            description="x",
            unit_raw="m2",
            unit_normalized="m2",
            unit_dimension="superficie",
            priceTotal=10.0,
            breakdown_ids=["LVC010#01", "LVC010#02"],
        )
        assert item.breakdown_ids == ["LVC010#01", "LVC010#02"]

    def test_kind_is_immutable_literal(self) -> None:
        # kind siempre debe ser "item"; pasar otro valor falla
        with pytest.raises(ValidationError):
            PriceBookItemEntry(
                kind="breakdown",  # type: ignore[arg-type]
                code="X",
                chapter="Y",
                section="",
                description="z",
                unit_raw="m2",
                unit_normalized="m2",
                unit_dimension="superficie",
                priceTotal=1.0,
            )

    def test_required_fields_validation(self) -> None:
        # Falta code
        with pytest.raises(ValidationError):
            PriceBookItemEntry(  # type: ignore[call-arg]
                chapter="x",
                section="",
                description="z",
                unit_raw="m2",
                unit_normalized="m2",
                unit_dimension="superficie",
                priceTotal=1.0,
            )


# -------- PriceBookBreakdownEntry -------------------------------------------


class TestPriceBookBreakdownEntry:
    def test_builds_with_required_fields(self) -> None:
        bk = PriceBookBreakdownEntry(
            code="LVC010#01",
            parent_code="LVC010",
            parent_description="Suministro y colocación de doble acristalamiento",
            parent_unit="m2",
            chapter="ACRISTALAMIENTOS",
            description="Oficial 1ª cristalero.",
            unit_raw="h",
            unit_normalized="h",
            unit_dimension="tiempo",
            quantity=0.41,
            price_unit=35.2,
            price=14.43,
        )
        assert bk.kind == "breakdown"
        assert bk.parent_code == "LVC010"
        assert bk.is_variable is False

    def test_kind_is_immutable_literal(self) -> None:
        with pytest.raises(ValidationError):
            PriceBookBreakdownEntry(
                kind="item",  # type: ignore[arg-type]
                code="X#01",
                parent_code="X",
                parent_description="y",
                parent_unit="m2",
                chapter="Z",
                description="W",
                unit_raw="h",
                unit_normalized="h",
                unit_dimension="tiempo",
                quantity=1,
                price_unit=1,
                price=1,
            )


# -------- EmbeddingTextBuilder ----------------------------------------------


class TestEmbeddingTextBuilder:
    def test_item_text_contains_chapter_section_unit_description(self) -> None:
        item = PriceBookItemEntry(
            code="LVC010",
            chapter="ACRISTALAMIENTOS",
            section="Vidrios dobles estándar",
            description="Suministro y colocación de doble acristalamiento",
            unit_raw="m2",
            unit_normalized="m2",
            unit_dimension="superficie",
            priceTotal=75.02,
        )
        text = EmbeddingTextBuilder.for_item(item)
        # Componentes mínimos que el embedding DEBE capturar
        assert "ACRISTALAMIENTOS" in text
        assert "Vidrios dobles" in text
        assert "m2" in text
        assert "Suministro y colocación" in text

    def test_item_text_uses_normalized_unit_when_available(self) -> None:
        item = PriceBookItemEntry(
            code="x",
            chapter="c",
            section="s",
            description="d",
            unit_raw="M²",         # jerga
            unit_normalized="m2",  # canonical
            unit_dimension="superficie",
            priceTotal=1.0,
        )
        text = EmbeddingTextBuilder.for_item(item)
        assert "m2" in text
        # El texto embedded usa el canonical, no la jerga
        assert "M²" not in text

    def test_item_text_is_deterministic(self) -> None:
        # Mismo entry → mismo texto (idempotencia del builder)
        item = PriceBookItemEntry(
            code="x", chapter="c", section="s", description="d",
            unit_raw="m2", unit_normalized="m2", unit_dimension="superficie",
            priceTotal=1.0,
        )
        assert EmbeddingTextBuilder.for_item(item) == EmbeddingTextBuilder.for_item(item)

    def test_breakdown_text_includes_parent_context(self) -> None:
        bk = PriceBookBreakdownEntry(
            code="LVC010#01",
            parent_code="LVC010",
            parent_description="Suministro y colocación de doble acristalamiento",
            parent_unit="m2",
            chapter="ACRISTALAMIENTOS",
            description="Oficial 1ª cristalero.",
            unit_raw="h",
            unit_normalized="h",
            unit_dimension="tiempo",
            quantity=0.41,
            price_unit=35.2,
            price=14.43,
        )
        text = EmbeddingTextBuilder.for_breakdown(bk)
        # El texto del breakdown incluye el contexto del padre
        # para que un search por "oficial 1ª cristalero" devuelva
        # mejor los componentes de partidas de cristalería.
        assert "ACRISTALAMIENTOS" in text
        assert "Suministro y colocación de doble acristalamiento" in text
        assert "Oficial 1ª cristalero" in text
        assert "h" in text  # unidad

    def test_breakdown_text_is_deterministic(self) -> None:
        bk = PriceBookBreakdownEntry(
            code="X#01",
            parent_code="X",
            parent_description="pd",
            parent_unit="m2",
            chapter="c",
            description="d",
            unit_raw="h",
            unit_normalized="h",
            unit_dimension="tiempo",
            quantity=1,
            price_unit=1,
            price=1,
        )
        assert EmbeddingTextBuilder.for_breakdown(bk) == EmbeddingTextBuilder.for_breakdown(bk)

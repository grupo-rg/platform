"""Fase 7.A — `Phase1Result` admite `orphan_tail_text` y `last_item_truncated`.

Estos campos son lo que el reduce de 7.B lee para fusionar una descripción
truncada de la página N con su continuación huérfana en la página N+1 (mismo
patrón que el flujo INLINE en pdf_extractor_service.py:331-346).

Invariantes cubiertos:
  1. Los campos existen con defaults ("", False) → schemas antiguos no rompen.
  2. Se pueden poblar explícitamente.
  3. `cut_item_carryover` / `has_more_items` se conservan (retrocompat), pero
     están marcados como deprecated en el código — los reemplazan los nuevos.
"""
from __future__ import annotations

from src.budget.application.services.pdf_extractor_service import (
    DescriptionItem,
    Phase1Result,
)


def _make_description_item() -> DescriptionItem:
    return DescriptionItem(
        code="C04.02",
        description="SOLADO GRES PORCELÁNICO 120 x 20 CM",
        unit="m2",
        chapter="C04 ALICATADOS",
    )


def test_defaults_are_empty_and_false():
    """Sin pasar los campos nuevos, defaults seguros (retrocompat)."""
    r = Phase1Result(items=[_make_description_item()])
    assert r.orphan_tail_text == ""
    assert r.last_item_truncated is False


def test_accepts_orphan_tail_text_when_provided():
    r = Phase1Result(
        items=[_make_description_item()],
        orphan_tail_text="Suministro y colocación de solado de gres porcelánico CIFRE - MODELO BAVARO...",
    )
    assert "BAVARO" in r.orphan_tail_text


def test_accepts_last_item_truncated_flag():
    r = Phase1Result(items=[_make_description_item()], last_item_truncated=True)
    assert r.last_item_truncated is True


def test_legacy_fields_still_work_for_backcompat():
    """`has_more_items` y `cut_item_carryover` siguen aceptándose (retrocompat)."""
    r = Phase1Result(
        items=[_make_description_item()],
        has_more_items=True,
        cut_item_carryover="tail fragment",
    )
    assert r.has_more_items is True
    assert r.cut_item_carryover == "tail fragment"


def test_all_four_fields_coexist():
    """Los campos nuevos y los legacy no se pisan entre sí."""
    r = Phase1Result(
        items=[_make_description_item()],
        has_more_items=True,
        cut_item_carryover="legacy tail",
        orphan_tail_text="new tail",
        last_item_truncated=True,
    )
    assert r.has_more_items is True
    assert r.cut_item_carryover == "legacy tail"
    assert r.orphan_tail_text == "new tail"
    assert r.last_item_truncated is True

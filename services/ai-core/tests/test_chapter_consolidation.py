"""Fase 8 — consolidación de nombres de capítulo por código.

Root cause: `stabilize_chapter_name` es sin estado — compara solo el capítulo
del item actual con el anterior. Si entre items con el mismo código (ej. C02)
se cuelan items de otro capítulo, la "memoria" de C02 se pierde y el nombre
puede cambiar. Resultado: en un mismo presupuesto aparecen "C02 ALBAÑILERIA"
y "C02 TABIQUES Y PARTICIONES" como dos capítulos distintos.

Fix: `consolidate_chapters(items)` mantiene un dict `prefix → canonical_name`
global. Primer nombre completo visto para un prefijo gana. Upgrade si el
primer avistamiento era solo el código (sin nombre) y después aparece uno
completo.
"""
from __future__ import annotations

from src.budget.application.services.pdf_extractor_service import (
    RestructuredItem,
    consolidate_chapters,
)


def _item(code: str, chapter: str) -> RestructuredItem:
    return RestructuredItem(
        code=code,
        description=f"Partida {code}",
        quantity=1.0,
        unit="ud",
        chapter=chapter,
    )


def test_same_prefix_collapses_to_first_seen_name():
    """C02 ALBAÑILERIA es el primero → todo C02 debe quedar con ese nombre."""
    items = [
        _item("C02.01", "C02 ALBAÑILERIA"),
        _item("C01.01", "C01 TRABAJOS PREVIOS"),
        _item("C02.02", "C02 TABIQUES Y PARTICIONES"),  # conflicto
        _item("C02.03", "C02 TABIQUES Y PARTICIONES"),  # conflicto
    ]
    consolidate_chapters(items)
    c02s = [i.chapter for i in items if i.code.startswith("C02")]
    assert all(c == "C02 ALBAÑILERIA" for c in c02s), c02s


def test_code_only_chapter_upgraded_when_named_version_appears():
    """Primer avistamiento 'C03' (solo código) → luego aparece 'C03 AISLAMIENTOS'.
    El nombre completo debe propagarse a todos los items con prefijo C03."""
    items = [
        _item("C03.01", "C03"),  # sin nombre
        _item("C03.02", "C03 AISLAMIENTOS"),  # ya con nombre
        _item("C03.03", "C03"),  # vuelve a venir sin nombre
    ]
    consolidate_chapters(items)
    c03s = [i.chapter for i in items if i.code.startswith("C03")]
    assert all(c == "C03 AISLAMIENTOS" for c in c03s), c03s


def test_leaves_distinct_prefixes_untouched():
    """Capítulos con prefijos distintos NO se mezclan."""
    items = [
        _item("C01.01", "C01 TRABAJOS PREVIOS"),
        _item("C02.01", "C02 ALBAÑILERIA"),
        _item("C03.01", "C03 AISLAMIENTOS"),
    ]
    consolidate_chapters(items)
    assert items[0].chapter == "C01 TRABAJOS PREVIOS"
    assert items[1].chapter == "C02 ALBAÑILERIA"
    assert items[2].chapter == "C03 AISLAMIENTOS"


def test_items_without_chapter_prefix_are_left_as_is():
    """Items con chapter="" o sin prefijo detectable no deben reventar ni
    ser modificados por la consolidación."""
    items = [
        _item("X.01", "Sin Capítulo"),
        _item("X.02", ""),
    ]
    consolidate_chapters(items)
    # No crash es suficiente; los nombres quedan tal cual.
    assert items[0].chapter == "Sin Capítulo"
    assert items[1].chapter == ""


def test_idempotent():
    """Ejecutar consolidate_chapters dos veces seguidas produce el mismo resultado."""
    items = [
        _item("C02.01", "C02 ALBAÑILERIA"),
        _item("C02.02", "C02 TABIQUES Y PARTICIONES"),
    ]
    consolidate_chapters(items)
    snapshot = [i.chapter for i in items]
    consolidate_chapters(items)
    assert [i.chapter for i in items] == snapshot

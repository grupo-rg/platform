"""Tests para header_detector.detect_header_in_page."""
from __future__ import annotations

import pytest

from src.budget.pdf_tabular_parser.application.header_detector import (
    detect_header_in_page,
)
from src.budget.pdf_tabular_parser.domain.column import ColumnConcept
from src.budget.pdf_tabular_parser.domain.row import TabularWord


def _make_word(text: str, x0: float, x1: float, y: float, page: int = 1) -> TabularWord:
    """Helper para construir TabularWord con coords mínimas."""
    return TabularWord(
        text=text, x0=x0, x1=x1, top=y - 5, bottom=y + 5, page_number=page
    )


def test_detect_header_with_canonical_layout():
    """Layout PRESTO canónico: CÓDIGO RESUMEN UDS LONGITUD ANCHURA ALTURA PARCIALES CANTIDAD PRECIO IMPORTE."""
    words = [
        _make_word("CÓDIGO", 50, 90, 100),
        _make_word("RESUMEN", 100, 150, 100),
        _make_word("UDS", 200, 220, 100),
        _make_word("LONGITUD", 240, 290, 100),
        _make_word("ANCHURA", 310, 360, 100),
        _make_word("ALTURA", 380, 420, 100),
        _make_word("PARCIALES", 440, 500, 100),
        _make_word("CANTIDAD", 520, 580, 100),
        _make_word("PRECIO", 600, 640, 100),
        _make_word("IMPORTE", 660, 720, 100),
    ]
    result = detect_header_in_page(words, page_number=1)
    assert result.found is True
    assert len(result.columns) == 10
    concepts = {c.concept for c in result.columns}
    assert ColumnConcept.CODIGO in concepts
    assert ColumnConcept.RESUMEN in concepts
    assert ColumnConcept.CANTIDAD in concepts
    assert ColumnConcept.IMPORTE in concepts
    assert ColumnConcept.PARCIALES in concepts


def test_detect_header_without_accents():
    """Acentos faltantes (CODIGO en vez de CÓDIGO) — debe seguir matcheando."""
    words = [
        _make_word("CODIGO", 50, 90, 100),
        _make_word("RESUMEN", 100, 150, 100),
        _make_word("UDS", 200, 220, 100),
        _make_word("CANTIDAD", 520, 580, 100),
        _make_word("PRECIO", 600, 640, 100),
        _make_word("IMPORTE", 660, 720, 100),
    ]
    result = detect_header_in_page(words, page_number=1)
    assert result.found is True


def test_detect_header_lowercase_tolerated():
    """Header en lowercase debería detectarse."""
    words = [
        _make_word("codigo", 50, 90, 100),
        _make_word("resumen", 100, 150, 100),
        _make_word("cantidad", 520, 580, 100),
        _make_word("importe", 660, 720, 100),
        _make_word("precio", 600, 640, 100),
    ]
    result = detect_header_in_page(words, page_number=1)
    assert result.found is True
    concepts = {c.concept for c in result.columns}
    assert ColumnConcept.CODIGO in concepts
    assert ColumnConcept.IMPORTE in concepts


def test_detect_header_too_few_concepts_returns_false():
    """Solo 2 conceptos (mínimo es 4) → no header."""
    words = [
        _make_word("CODIGO", 50, 90, 100),
        _make_word("CANTIDAD", 520, 580, 100),
    ]
    result = detect_header_in_page(words, page_number=1)
    assert result.found is False
    assert result.columns == []


def test_detect_header_missing_critical_concept():
    """4 conceptos pero ninguno crítico (CODIGO/CANTIDAD/IMPORTE) → no header."""
    words = [
        _make_word("LONGITUD", 50, 90, 100),
        _make_word("ANCHURA", 100, 150, 100),
        _make_word("ALTURA", 200, 250, 100),
        _make_word("PARCIALES", 300, 350, 100),
    ]
    result = detect_header_in_page(words, page_number=1)
    assert result.found is False


def test_detect_header_empty_input():
    result = detect_header_in_page([], page_number=1)
    assert result.found is False
    assert result.columns == []


def test_columns_are_ordered_by_x0():
    """Las columnas detectadas deben venir ordenadas izquierda a derecha."""
    words = [
        # Desordenadas a propósito.
        _make_word("IMPORTE", 660, 720, 100),
        _make_word("CODIGO", 50, 90, 100),
        _make_word("CANTIDAD", 520, 580, 100),
        _make_word("RESUMEN", 100, 150, 100),
        _make_word("PRECIO", 600, 640, 100),
    ]
    result = detect_header_in_page(words, page_number=1)
    assert result.found is True
    x_centers = [c.x_center for c in result.columns]
    assert x_centers == sorted(x_centers), f"Columnas desordenadas: {x_centers}"


def test_column_x_ranges_are_contiguous():
    """Las columnas no deben dejar gaps grandes ni solaparse fuertemente."""
    words = [
        _make_word("CODIGO", 50, 90, 100),
        _make_word("RESUMEN", 100, 150, 100),
        _make_word("CANTIDAD", 520, 580, 100),
        _make_word("PRECIO", 600, 640, 100),
        _make_word("IMPORTE", 660, 720, 100),
    ]
    result = detect_header_in_page(words, page_number=1)
    assert result.found is True

    cols = sorted(result.columns, key=lambda c: c.x_min)
    for i in range(len(cols) - 1):
        # x_max de columna i debe ser ≈ x_min de columna i+1.
        gap = cols[i + 1].x_min - cols[i].x_max
        assert abs(gap) < 1.0, (
            f"Gap excesivo entre columnas {cols[i].concept} y {cols[i+1].concept}: {gap}"
        )


def test_header_ignores_lines_that_dont_match():
    """Si hay una línea con palabras random ANTES de la cabecera, se ignora."""
    words = [
        # Línea de header de impresora (Y bajo = arriba en PDF).
        _make_word("Fecha:", 50, 70, 50),
        _make_word("25-mar-2025", 80, 120, 50),
        # La cabecera real.
        _make_word("CODIGO", 50, 90, 100),
        _make_word("RESUMEN", 100, 150, 100),
        _make_word("CANTIDAD", 520, 580, 100),
        _make_word("PRECIO", 600, 640, 100),
        _make_word("IMPORTE", 660, 720, 100),
    ]
    result = detect_header_in_page(words, page_number=1)
    assert result.found is True
    assert result.y_center is not None and result.y_center == pytest.approx(100, abs=2.0)


def test_page_number_propagates_to_columns():
    """page_number se transfiere correctamente a las columnas."""
    words = [
        _make_word("CODIGO", 50, 90, 100, page=7),
        _make_word("RESUMEN", 100, 150, 100, page=7),
        _make_word("CANTIDAD", 520, 580, 100, page=7),
        _make_word("IMPORTE", 660, 720, 100, page=7),
        _make_word("PRECIO", 600, 640, 100, page=7),
    ]
    result = detect_header_in_page(words, page_number=7)
    assert result.found is True
    assert all(c.page_number == 7 for c in result.columns)

"""Tests para partida_extractor."""
from __future__ import annotations

from src.budget.pdf_tabular_parser.application.partida_extractor import (
    detect_partida_header_from_text,
    detect_summary_row,
    extract_quantity_from_row,
)
from src.budget.pdf_tabular_parser.domain.column import ColumnConcept
from src.budget.pdf_tabular_parser.domain.row import TabularRow, TabularWord


def test_summary_row_three_decimals():
    """Fila summary clásica `CANT PRECIO IMPORTE`."""
    s = detect_summary_row("10,000 25,50 255,00")
    assert s.is_summary
    assert s.quantity == 10.0
    assert s.price == 25.5
    assert s.amount == 255.0


def test_summary_row_zero_price():
    """`10,000 0,00 0,00` — qty real, precio aún sin pricer."""
    s = detect_summary_row("10,000 0,00 0,00")
    assert s.is_summary
    assert s.quantity == 10.0
    assert s.price == 0.0


def test_summary_row_requires_3_numbers():
    """Solo 2 números → no es summary."""
    s = detect_summary_row("10,000 25,50")
    assert not s.is_summary


def test_summary_row_with_text_rejected():
    """Hay texto → no es summary."""
    s = detect_summary_row("Subtotal 10,000 25,50 255,00")
    assert not s.is_summary


def test_summary_row_dot_decimals():
    """Con punto decimal (anglo) — también acepta."""
    s = detect_summary_row("10.50 25.00 262.50")
    assert s.is_summary


def test_summary_row_empty():
    s = detect_summary_row("")
    assert not s.is_summary


def test_partida_header_with_partida_word():
    """`XX.YY Partida UD TÍTULO` — caso RdLL."""
    h = detect_partida_header_from_text("01.04 Partida UD REPLANTEO DE LA CIMENTACIÓN")
    assert h.is_partida
    assert h.code == "01.04"
    assert h.unit == "UD"
    assert "REPLANTEO" in h.title


def test_partida_header_without_partida_word():
    """`XX.YY UD TÍTULO` — caso REFORMA_AV_ALEX."""
    h = detect_partida_header_from_text("01.04 ud Replanteo general")
    assert h.is_partida
    assert h.code == "01.04"
    assert h.unit == "ud"


def test_partida_header_4_levels():
    """Código de 4 niveles `XX.YY.ZZ.WW`."""
    h = detect_partida_header_from_text("01.01.01.01 m2 Demolición de tabique")
    assert h.is_partida
    assert h.code == "01.01.01.01"


def test_partida_header_with_blocklist_word_rejected():
    """`TOTAL CAPÍTULO ...` no es partida."""
    h = detect_partida_header_from_text("01.01 m2 TOTAL CAPÍTULO de albañilería")
    assert not h.is_partida


def test_partida_header_unicode_units():
    """m²/m³ se aceptan."""
    h = detect_partida_header_from_text("01.01 m² Pavimentado con baldosa cerámica")
    assert h.is_partida
    assert h.unit == "m²"


def test_extract_quantity_from_row_with_cantidad_cell():
    row = TabularRow(page_number=1, y_center=200.0)
    row.cells[ColumnConcept.CANTIDAD] = "10,000"
    row.cells[ColumnConcept.RESUMEN] = "Demolicion"
    qty = extract_quantity_from_row(row)
    assert qty == 10.0


def test_extract_quantity_from_row_with_invalid_cantidad():
    row = TabularRow(page_number=1, y_center=200.0)
    row.cells[ColumnConcept.CANTIDAD] = "abc"
    qty = extract_quantity_from_row(row)
    assert qty is None


def test_extract_quantity_from_summary_row():
    """Una fila con sólo summary `CANT PRECIO IMPORTE` y sin celdas."""
    row = TabularRow(page_number=1, y_center=200.0)
    row.raw_words = [
        TabularWord("10,000", x0=100, x1=140, top=195, bottom=205, page_number=1),
        TabularWord("25,50", x0=160, x1=200, top=195, bottom=205, page_number=1),
        TabularWord("255,00", x0=220, x1=260, top=195, bottom=205, page_number=1),
    ]
    qty = extract_quantity_from_row(row)
    assert qty == 10.0


def test_partida_header_too_short_title():
    """Título de menos de 5 chars no es válido."""
    h = detect_partida_header_from_text("01.01 m2 ab")
    assert not h.is_partida
    assert h.rejection_reason == "title_too_short"


def test_partida_header_invalid_unit():
    """Unidad random no reconocible."""
    h = detect_partida_header_from_text("01.01 zzz Una descripción larga")
    assert not h.is_partida

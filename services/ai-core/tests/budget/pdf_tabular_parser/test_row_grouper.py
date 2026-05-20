"""Tests para row_grouper.group_words_into_rows."""
from __future__ import annotations

from src.budget.pdf_tabular_parser.application.row_grouper import (
    group_words_into_rows,
)
from src.budget.pdf_tabular_parser.domain.column import ColumnConcept, TabularColumn
from src.budget.pdf_tabular_parser.domain.row import TabularWord


def _make_word(text: str, x0: float, x1: float, y: float, page: int = 1) -> TabularWord:
    return TabularWord(
        text=text, x0=x0, x1=x1, top=y - 5, bottom=y + 5, page_number=page
    )


def _make_col(concept: ColumnConcept, x_min: float, x_max: float) -> TabularColumn:
    return TabularColumn(
        concept=concept,
        x_min=x_min,
        x_max=x_max,
        x_center=(x_min + x_max) / 2,
        header_word=concept.value,
        page_number=1,
    )


def test_group_simple_row():
    """Una sola línea con 2 palabras alineadas en y."""
    columns = [
        _make_col(ColumnConcept.CODIGO, 0, 100),
        _make_col(ColumnConcept.RESUMEN, 100, 600),
    ]
    words = [
        _make_word("01.01", 50, 90, 200),
        _make_word("Demolicion", 150, 250, 200),
    ]
    rows = group_words_into_rows(
        words=words,
        columns=columns,
        header_y=100.0,
        page_number=1,
    )
    assert len(rows) == 1
    assert rows[0].get_cell(ColumnConcept.CODIGO) == "01.01"
    assert rows[0].get_cell(ColumnConcept.RESUMEN) == "Demolicion"


def test_group_multiple_rows_separated_by_y():
    """Dos filas separadas por delta y suficiente."""
    columns = [
        _make_col(ColumnConcept.CODIGO, 0, 100),
        _make_col(ColumnConcept.RESUMEN, 100, 600),
    ]
    words = [
        _make_word("01.01", 50, 90, 200),
        _make_word("Demolicion", 150, 250, 200),
        # Fila siguiente
        _make_word("01.02", 50, 90, 230),
        _make_word("Replanteo", 150, 250, 230),
    ]
    rows = group_words_into_rows(
        words=words,
        columns=columns,
        header_y=100.0,
        page_number=1,
    )
    assert len(rows) == 2
    assert rows[0].get_cell(ColumnConcept.CODIGO) == "01.01"
    assert rows[1].get_cell(ColumnConcept.CODIGO) == "01.02"


def test_filter_words_above_header_y():
    """Palabras above del header_y deben ser ignoradas."""
    columns = [
        _make_col(ColumnConcept.CODIGO, 0, 100),
        _make_col(ColumnConcept.RESUMEN, 100, 600),
    ]
    words = [
        # Header garbage (above body).
        _make_word("Empresa", 50, 100, 50),
        _make_word("Fecha", 150, 200, 50),
        # Body real.
        _make_word("01.01", 50, 90, 200),
        _make_word("Demolicion", 150, 250, 200),
    ]
    rows = group_words_into_rows(
        words=words,
        columns=columns,
        header_y=100.0,
        page_number=1,
    )
    assert len(rows) == 1
    assert rows[0].get_cell(ColumnConcept.CODIGO) == "01.01"


def test_assignment_by_nearest_center():
    """Word entre dos columnas — se asigna a la más cercana."""
    columns = [
        _make_col(ColumnConcept.CODIGO, 0, 50),    # center 25
        _make_col(ColumnConcept.RESUMEN, 50, 200), # center 125
    ]
    # Palabra centrada en x=60 — más cerca de CODIGO (25 dist 35) que de RESUMEN (125 dist 65) → CODIGO.
    # Wait: dist(60,25)=35, dist(60,125)=65. CODIGO gana.
    # Pero como x=60 está DENTRO de RESUMEN (50-200), gana RESUMEN por contención.
    words = [_make_word("X", 55, 65, 200)]
    rows = group_words_into_rows(
        words=words,
        columns=columns,
        header_y=100.0,
        page_number=1,
    )
    # Word x_center=60, dentro de RESUMEN (50-200) → RESUMEN.
    assert rows[0].get_cell(ColumnConcept.RESUMEN) == "X"


def test_concatenation_within_cell_orders_by_x0():
    """Palabras en la misma celda deben concatenarse de izquierda a derecha."""
    columns = [
        _make_col(ColumnConcept.RESUMEN, 0, 600),
    ]
    words = [
        _make_word("mundo", 200, 280, 200),
        _make_word("Hola", 50, 150, 200),
    ]
    rows = group_words_into_rows(
        words=words,
        columns=columns,
        header_y=100.0,
        page_number=1,
    )
    assert rows[0].get_cell(ColumnConcept.RESUMEN) == "Hola mundo"


def test_empty_input_returns_empty():
    rows = group_words_into_rows(
        words=[],
        columns=[_make_col(ColumnConcept.CODIGO, 0, 100)],
        header_y=100.0,
        page_number=1,
    )
    assert rows == []


def test_no_columns_returns_empty():
    """Sin columnas, no se puede agrupar."""
    rows = group_words_into_rows(
        words=[_make_word("X", 50, 60, 200)],
        columns=[],
        header_y=100.0,
        page_number=1,
    )
    assert rows == []


def test_y_tolerance_clusters_close_lines():
    """Líneas separadas por menos de tolerance deben fusionarse."""
    columns = [_make_col(ColumnConcept.CODIGO, 0, 500)]
    words = [
        _make_word("a", 10, 20, 200.0),
        _make_word("b", 30, 40, 200.5),  # delta 0.5 < tolerance 3
        _make_word("c", 50, 60, 200.8),  # delta 0.3
    ]
    rows = group_words_into_rows(
        words=words,
        columns=columns,
        header_y=100.0,
        page_number=1,
        y_tolerance=3.0,
    )
    assert len(rows) == 1
    assert "a" in rows[0].get_cell(ColumnConcept.CODIGO)
    assert "b" in rows[0].get_cell(ColumnConcept.CODIGO)
    assert "c" in rows[0].get_cell(ColumnConcept.CODIGO)


def test_get_full_text_concatenates_all_words():
    """get_full_text devuelve todas las palabras en orden x0."""
    columns = [_make_col(ColumnConcept.CODIGO, 0, 500)]
    words = [
        _make_word("01.01", 50, 100, 200),
        _make_word("Demolicion", 150, 250, 200),
        _make_word("m2", 300, 320, 200),
    ]
    rows = group_words_into_rows(
        words=words,
        columns=columns,
        header_y=100.0,
        page_number=1,
    )
    assert rows[0].get_full_text() == "01.01 Demolicion m2"

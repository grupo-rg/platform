"""RowGrouper — agrupa palabras de una página en filas tabulares.

Dadas las palabras de una página y las columnas detectadas:

1. Agrupa palabras por y-coord (línea visual).
2. Para cada línea, asigna cada palabra a la columna cuyo x_center está más
   cerca del x_center de la palabra (asignación nearest-center).
3. Concatena las palabras de cada celda en orden de x0 izquierda-a-derecha.

Una excepción: las líneas que están ABOVE de la cabecera (y_center < header_y)
se descartan automáticamente — son numeración de página, fecha, etc.
"""
from __future__ import annotations

from typing import List, Sequence

from src.budget.pdf_tabular_parser.domain.column import ColumnConcept, TabularColumn
from src.budget.pdf_tabular_parser.domain.row import TabularRow, TabularWord


def group_words_into_rows(
    words: Sequence[TabularWord],
    columns: Sequence[TabularColumn],
    header_y: float,
    page_number: int,
    y_tolerance: float = 3.0,
) -> List[TabularRow]:
    """Agrupa palabras en TabularRows.

    Args:
        words: todas las palabras de la página.
        columns: cabecera memorizada (mapping concepto → x_range).
        header_y: y-coord de la cabecera (líneas por encima se ignoran).
        page_number: 1-indexed.
        y_tolerance: tolerancia de línea visual (±pt).

    Returns:
        Lista de TabularRow, ordenadas de arriba hacia abajo (top→bottom).
        Cada row tiene `cells` poblado con texto de cada columna detectada.
    """
    if not words or not columns:
        return []

    # Filtrar palabras debajo de la cabecera (en PDF y crece hacia abajo).
    # Usamos un margen pequeño para tolerar el grosor de la cabecera misma.
    body_words = [w for w in words if w.y_center > header_y + 1.0]

    if not body_words:
        return []

    # Agrupar por línea visual.
    sorted_words = sorted(body_words, key=lambda w: (w.y_center, w.x0))
    rows: List[List[TabularWord]] = []
    current_line: List[TabularWord] = [sorted_words[0]]
    current_y = sorted_words[0].y_center

    for w in sorted_words[1:]:
        if abs(w.y_center - current_y) <= y_tolerance:
            current_line.append(w)
            # Re-promediar y para evitar drift en líneas largas.
            current_y = sum(x.y_center for x in current_line) / len(current_line)
        else:
            rows.append(current_line)
            current_line = [w]
            current_y = w.y_center
    if current_line:
        rows.append(current_line)

    # Para cada línea, crear TabularRow asignando palabras a columnas.
    tabular_rows: List[TabularRow] = []
    for line_words in rows:
        row = _build_row_from_words(line_words, columns, page_number)
        tabular_rows.append(row)

    return tabular_rows


def _build_row_from_words(
    line_words: List[TabularWord],
    columns: Sequence[TabularColumn],
    page_number: int,
) -> TabularRow:
    """Construye un TabularRow a partir de las palabras de una línea."""
    y_center = sum(w.y_center for w in line_words) / len(line_words)
    row = TabularRow(
        page_number=page_number,
        y_center=y_center,
        raw_words=sorted(line_words, key=lambda w: w.x0),
    )

    # Acumular palabras por concepto (en orden de x0).
    accumulator: dict[ColumnConcept, List[TabularWord]] = {}
    for w in sorted(line_words, key=lambda w: w.x0):
        target_concept = _assign_word_to_column(w, columns)
        if target_concept is None:
            continue
        accumulator.setdefault(target_concept, []).append(w)

    # Concatenar cada celda.
    for concept, words_in_cell in accumulator.items():
        text = " ".join(w.text for w in sorted(words_in_cell, key=lambda w: w.x0))
        row.cells[concept] = text

    return row


def _assign_word_to_column(
    word: TabularWord,
    columns: Sequence[TabularColumn],
) -> ColumnConcept | None:
    """Asigna una palabra a una columna por nearest x_center.

    Reglas:
    - Si el x_center cae estrictamente DENTRO del rango de una columna, esa
      columna gana sin más.
    - Si está entre dos columnas, gana la más cercana en x_center.
    - Si está antes de la primera columna (x < col[0].x_min), se asigna a la
      primera columna (típicamente RESUMEN/descripción).
    - Si está después de la última, se asigna a la última.
    """
    if not columns:
        return None

    word_x = word.x_center

    # Buscar columna que contiene estrictamente x_center.
    for col in columns:
        if col.x_min <= word_x <= col.x_max:
            return col.concept

    # No cayó dentro: nearest center (fallback defensivo).
    closest = min(columns, key=lambda c: c.distance_to(word_x))
    return closest.concept

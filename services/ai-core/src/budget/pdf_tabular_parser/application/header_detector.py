"""HeaderDetector — busca la cabecera tabular PRESTO/CIFRE en cada página.

La cabecera real (verificada en goldens) es:

    CÓDIGO RESUMEN UDS LONGITUD ANCHURA ALTURA PARCIALES CANTIDAD PRECIO IMPORTE

Variantes observadas:
- Sin tildes ("CODIGO" vs "CÓDIGO").
- Sin algunas columnas (ej. "PARCIALES" puede faltar en PDFs simples).
- Espaciado variable.
- Multilínea (algunos PDFs ponen UDS/LONGITUD en una segunda línea encima
  de la fila principal).

Estrategia: agrupar palabras por línea (y-coord) y comprobar si ≥4 conceptos
canónicos aparecen consecutivos en orden estricto x0.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence

from src.budget.pdf_tabular_parser.domain.column import (
    ColumnConcept,
    TabularColumn,
    _normalize_header_word,
)
from src.budget.pdf_tabular_parser.domain.row import TabularWord

# Mínimo número de conceptos canónicos requeridos para considerar una línea
# como cabecera. Empíricamente 4 — descarta líneas con 1-2 falsos positivos
# (ej. una partida que mencione "CANTIDAD" en su descripción).
MIN_HEADER_CONCEPTS = 4

# Conceptos críticos: si no aparece NINGUNO, no es cabecera (incluso si por
# casualidad aparecen 4 palabras genéricas).
CRITICAL_CONCEPTS = {ColumnConcept.CODIGO, ColumnConcept.CANTIDAD, ColumnConcept.IMPORTE}


@dataclass(frozen=True)
class HeaderDetectionResult:
    """Resultado de buscar cabecera en una página."""

    found: bool
    columns: List[TabularColumn]
    y_center: Optional[float] = None  # y-coord aproximada de la cabecera
    raw_words: Optional[List[TabularWord]] = None  # palabras que conforman la cabecera


def detect_header_in_page(
    words: Sequence[TabularWord],
    page_number: int,
    y_tolerance: float = 3.0,
) -> HeaderDetectionResult:
    """Busca la cabecera tabular entre las `words` de una página.

    Algoritmo:
    1. Agrupar `words` por y-coord (tolerance ±y_tolerance pt).
    2. Para cada línea, mapear cada palabra a un ColumnConcept si encaja.
    3. La línea con más conceptos canónicos (>= MIN_HEADER_CONCEPTS) es la cabecera.
    4. Si hay empate, ganar la línea con CODIGO+CANTIDAD+IMPORTE.

    Retorna found=False si ninguna línea cumple el threshold.
    """
    if not words:
        return HeaderDetectionResult(found=False, columns=[])

    # Agrupar palabras por y_center (línea visual).
    lines = _group_words_by_y(list(words), y_tolerance)

    best_line: Optional[List[TabularWord]] = None
    best_concepts: List[tuple[TabularWord, ColumnConcept]] = []
    best_score = 0

    for line in lines:
        matches: List[tuple[TabularWord, ColumnConcept]] = []
        for w in line:
            concept = ColumnConcept.from_header_word(w.text)
            if concept is not None:
                matches.append((w, concept))
        # Deduplicar por concepto (si la palabra "ud" aparece dos veces, nos
        # quedamos solo con la primera por x0).
        seen_concepts: set[ColumnConcept] = set()
        dedup_matches: List[tuple[TabularWord, ColumnConcept]] = []
        for w, c in sorted(matches, key=lambda t: t[0].x0):
            if c not in seen_concepts:
                seen_concepts.add(c)
                dedup_matches.append((w, c))
        score = len(dedup_matches)
        if score < MIN_HEADER_CONCEPTS:
            continue
        if not seen_concepts & CRITICAL_CONCEPTS:
            continue
        # Bonus si están los críticos
        critical_bonus = sum(1 for c in CRITICAL_CONCEPTS if c in seen_concepts)
        weighted = score + critical_bonus
        if weighted > best_score:
            best_score = weighted
            best_line = line
            best_concepts = dedup_matches

    if not best_line or not best_concepts:
        return HeaderDetectionResult(found=False, columns=[])

    columns = _build_columns_from_matches(best_concepts, page_number)
    y_center = sum(w.y_center for w in best_line) / len(best_line)

    return HeaderDetectionResult(
        found=True,
        columns=columns,
        y_center=y_center,
        raw_words=best_line,
    )


def _group_words_by_y(words: List[TabularWord], y_tolerance: float) -> List[List[TabularWord]]:
    """Agrupa palabras por línea visual (mismo y_center ± tolerance).

    Orden de salida: top→bottom (y crece hacia abajo).
    """
    if not words:
        return []

    sorted_words = sorted(words, key=lambda w: (w.y_center, w.x0))
    lines: List[List[TabularWord]] = []
    current_line: List[TabularWord] = [sorted_words[0]]
    current_y = sorted_words[0].y_center

    for w in sorted_words[1:]:
        if abs(w.y_center - current_y) <= y_tolerance:
            current_line.append(w)
        else:
            lines.append(current_line)
            current_line = [w]
            current_y = w.y_center
    if current_line:
        lines.append(current_line)
    return lines


def _build_columns_from_matches(
    matches: List[tuple[TabularWord, ColumnConcept]],
    page_number: int,
) -> List[TabularColumn]:
    """Convierte matches (word, concept) en TabularColumn con x ranges.

    Los x_min/x_max se calculan tomando como referencia los puntos medios entre
    el final de la columna anterior y el inicio de la columna siguiente. Esto
    asegura que el espacio entre columnas se reparte mitad-mitad.

    La primera columna empieza en 0 (o el x0 de la palabra si es pequeño).
    La última columna se extiende hasta page_width (asumimos 1000pt como
    upper bound — corregible si tenemos el width real).
    """
    if not matches:
        return []

    sorted_matches = sorted(matches, key=lambda t: t[0].x0)

    columns: List[TabularColumn] = []
    for i, (word, concept) in enumerate(sorted_matches):
        # x_min: punto medio con la columna anterior (o 0 si es la primera).
        if i == 0:
            x_min = max(0.0, word.x0 - 5.0)  # margen 5pt a la izquierda
        else:
            prev_word = sorted_matches[i - 1][0]
            x_min = (prev_word.x1 + word.x0) / 2

        # x_max: punto medio con la columna siguiente (o page_width si es la última).
        if i == len(sorted_matches) - 1:
            x_max = word.x1 + 1000.0  # ancho generoso al final
        else:
            next_word = sorted_matches[i + 1][0]
            x_max = (word.x1 + next_word.x0) / 2

        x_center = (word.x0 + word.x1) / 2

        columns.append(
            TabularColumn(
                concept=concept,
                x_min=x_min,
                x_max=x_max,
                x_center=x_center,
                header_word=word.text,
                page_number=page_number,
            )
        )

    return columns

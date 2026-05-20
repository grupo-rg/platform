"""TabularRow — fila de la tabla con cells por columna.

Una página PDF tiene N filas. Cada fila es un set de palabras agrupadas por
y-coord (tolerance ±2pt). Las palabras de cada fila se asignan a su columna
por nearest x_center.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from src.budget.pdf_tabular_parser.domain.column import ColumnConcept


@dataclass(frozen=True)
class TabularWord:
    """Palabra extraída por pdfplumber.

    Espejo simplificado de la salida de `page.extract_words()`. Inmutable
    para que el row_grouper pueda crear sets y deduplicar.
    """

    text: str
    x0: float       # borde izquierdo
    x1: float       # borde derecho
    top: float      # borde superior (y crece hacia abajo en PDF)
    bottom: float   # borde inferior
    page_number: int  # 1-indexed

    @property
    def x_center(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def y_center(self) -> float:
        return (self.top + self.bottom) / 2

    @property
    def height(self) -> float:
        return self.bottom - self.top

    @property
    def width(self) -> float:
        return self.x1 - self.x0


@dataclass
class TabularRow:
    """Una fila de la tabla — agrupación de palabras por y-coord.

    `cells` mapea cada concepto de columna a la concatenación de palabras
    que cayeron en esa columna. El orden de las palabras dentro de cada cell
    es izquierda-a-derecha (por x0).

    `raw_words` mantiene la lista cruda para debugging.
    """

    page_number: int
    y_center: float
    raw_words: List[TabularWord] = field(default_factory=list)
    cells: Dict[ColumnConcept, str] = field(default_factory=dict)

    def get_cell(self, concept: ColumnConcept) -> str:
        """Devuelve el texto de la celda (vacío si no hay valor)."""
        return self.cells.get(concept, "").strip()

    def has_cell(self, concept: ColumnConcept) -> bool:
        """¿La celda existe y NO está vacía?"""
        return bool(self.get_cell(concept))

    def get_full_text(self) -> str:
        """Texto raw de toda la fila (todas las palabras separadas por espacio)."""
        return " ".join(w.text for w in sorted(self.raw_words, key=lambda w: w.x0))

    def is_empty(self) -> bool:
        return not self.raw_words

    def as_dict(self) -> Dict[str, str]:
        """Vista cómoda para debugging y telemetría."""
        return {c.value: self.cells.get(c, "") for c in ColumnConcept}

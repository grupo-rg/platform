"""ColumnMapper — persiste el mapping concept→x_range entre páginas.

PRESTO repite la cabecera en cada página, pero a veces no la imprime
completa (ej. la última página puede estar truncada). Esta clase
"memoriza" el último mapping válido para reutilizarlo en páginas que no
tengan cabecera visible.

Usage:
    mapper = ColumnMapper()
    mapper.update_from_detection(header_detection_for_page_1)
    if mapper.has_mapping():
        columns = mapper.get_columns()
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from src.budget.pdf_tabular_parser.application.header_detector import HeaderDetectionResult
from src.budget.pdf_tabular_parser.domain.column import TabularColumn


@dataclass
class ColumnMapper:
    """Memoriza el mapping de columnas para reutilizarlo en páginas sucesivas."""

    columns: List[TabularColumn] = field(default_factory=list)
    last_page_with_header: Optional[int] = None
    last_y_center: Optional[float] = None

    def update_from_detection(self, detection: HeaderDetectionResult) -> bool:
        """Actualiza el mapping desde un HeaderDetectionResult.

        Retorna True si la detección fue válida y se aplicó el cambio.
        """
        if not detection.found or not detection.columns:
            return False
        self.columns = list(detection.columns)
        self.last_page_with_header = detection.columns[0].page_number
        self.last_y_center = detection.y_center
        return True

    def has_mapping(self) -> bool:
        return bool(self.columns)

    def get_columns(self) -> List[TabularColumn]:
        return list(self.columns)

    def get_y_center(self) -> Optional[float]:
        return self.last_y_center

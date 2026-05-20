"""Domain models — value objects puros, sin I/O."""
from src.budget.pdf_tabular_parser.domain.column import TabularColumn, ColumnConcept
from src.budget.pdf_tabular_parser.domain.row import TabularRow, TabularWord
from src.budget.pdf_tabular_parser.domain.hierarchy import ChapterHierarchy, HierarchyLevel
from src.budget.pdf_tabular_parser.domain.result import (
    TabularExtractionResult,
    TabularPartida,
    PageMetrics,
)

__all__ = [
    "TabularColumn",
    "ColumnConcept",
    "TabularRow",
    "TabularWord",
    "ChapterHierarchy",
    "HierarchyLevel",
    "TabularExtractionResult",
    "TabularPartida",
    "PageMetrics",
]

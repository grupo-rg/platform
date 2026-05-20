"""Tests para ColumnMapper — persistencia del mapping entre páginas."""
from __future__ import annotations

from src.budget.pdf_tabular_parser.application.column_mapper import ColumnMapper
from src.budget.pdf_tabular_parser.application.header_detector import (
    HeaderDetectionResult,
)
from src.budget.pdf_tabular_parser.domain.column import ColumnConcept, TabularColumn


def _make_col(
    concept: ColumnConcept, x_min: float, x_max: float, page: int = 1
) -> TabularColumn:
    return TabularColumn(
        concept=concept,
        x_min=x_min,
        x_max=x_max,
        x_center=(x_min + x_max) / 2,
        header_word=concept.value,
        page_number=page,
    )


def test_fresh_mapper_has_no_mapping():
    m = ColumnMapper()
    assert not m.has_mapping()
    assert m.get_columns() == []
    assert m.get_y_center() is None


def test_update_from_detection_with_valid_columns():
    cols = [
        _make_col(ColumnConcept.CODIGO, 50, 90, page=1),
        _make_col(ColumnConcept.CANTIDAD, 100, 150, page=1),
    ]
    det = HeaderDetectionResult(found=True, columns=cols, y_center=100.0, raw_words=[])
    m = ColumnMapper()
    assert m.update_from_detection(det) is True
    assert m.has_mapping()
    assert len(m.get_columns()) == 2
    assert m.last_page_with_header == 1
    assert m.get_y_center() == 100.0


def test_update_from_detection_with_not_found_returns_false():
    det = HeaderDetectionResult(found=False, columns=[])
    m = ColumnMapper()
    assert m.update_from_detection(det) is False
    assert not m.has_mapping()


def test_update_overrides_previous_mapping():
    """Detección posterior debe sobrescribir el mapping previo."""
    m = ColumnMapper()
    det_v1 = HeaderDetectionResult(
        found=True,
        columns=[_make_col(ColumnConcept.CODIGO, 50, 90, page=1)],
        y_center=100.0,
    )
    m.update_from_detection(det_v1)
    assert m.last_page_with_header == 1

    det_v2 = HeaderDetectionResult(
        found=True,
        columns=[
            _make_col(ColumnConcept.CODIGO, 60, 100, page=5),
            _make_col(ColumnConcept.CANTIDAD, 200, 250, page=5),
        ],
        y_center=150.0,
    )
    m.update_from_detection(det_v2)
    assert m.last_page_with_header == 5
    assert len(m.get_columns()) == 2


def test_get_columns_returns_copy():
    """get_columns no debe permitir mutar el estado interno."""
    cols = [_make_col(ColumnConcept.CODIGO, 50, 90)]
    det = HeaderDetectionResult(found=True, columns=cols, y_center=100.0)
    m = ColumnMapper()
    m.update_from_detection(det)
    snapshot = m.get_columns()
    snapshot.clear()
    assert m.has_mapping()  # estado interno intacto

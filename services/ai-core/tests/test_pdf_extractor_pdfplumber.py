"""Sprint 3 — S3-06: pdfplumber-first layout parser.

Para PDFs nativos con tablas estructuradas (no escaneados), priorizamos
`pdfplumber` para extraer code/description/unit/quantity/chapter SIN tocar
el LLM Vision. El LLM Vision queda como fallback cuando:
- el PDF parece escaneado (`extract_text()` devuelve casi nada).
- no se reconocen columnas (`code`, `description`, `unit`, `quantity`).
- la cobertura heurística cae < 80% de las páginas/items esperados.

Las heurísticas se testean en aislamiento con mocks de pdfplumber para no
depender de PDFs reales en el repo.
"""
from __future__ import annotations

from typing import Any, List, Optional
from unittest.mock import MagicMock, patch

import pytest

from src.budget.application.services.pdf_extractor_service import (
    RestructuredItem,
    _detect_chapter_header,
    _infer_column_mapping,
    _row_to_restructured_item,
    extract_with_pdfplumber_first,
)


# ---------------------------------------------------------------------------
# _infer_column_mapping
# ---------------------------------------------------------------------------


def test_column_mapping_detects_standard_columns():
    header = ["Código", "Descripción", "Ud", "Cantidad", "Precio", "Total"]
    mapping = _infer_column_mapping(header)
    assert mapping is not None
    assert mapping["code"] == 0
    assert mapping["description"] == 1
    assert mapping["unit"] == 2
    assert mapping["quantity"] == 3
    assert mapping["price"] == 4


def test_column_mapping_tolerates_case_and_synonyms():
    header = ["CODIGO", "RESUMEN", "U/M", "CANTIDAD", "PVP"]
    mapping = _infer_column_mapping(header)
    assert mapping is not None
    assert mapping["code"] == 0
    assert mapping["description"] == 1
    assert mapping["unit"] == 2
    assert mapping["quantity"] == 3


def test_column_mapping_returns_none_when_no_match():
    header = ["Foo", "Bar", "Baz"]
    assert _infer_column_mapping(header) is None


def test_column_mapping_returns_none_when_missing_core_columns():
    # Tiene "code" pero no "description" ni "quantity" → no podemos producir
    # un RestructuredItem útil.
    header = ["Código", "Foo", "Bar"]
    assert _infer_column_mapping(header) is None


def test_column_mapping_handles_none_cells():
    header = [None, "Descripción", "Ud", "Cantidad"]
    mapping = _infer_column_mapping(header)
    # Sin código no es viable.
    assert mapping is None


# ---------------------------------------------------------------------------
# _detect_chapter_header
# ---------------------------------------------------------------------------


def test_detects_chapter_header_uppercase_numeric_pattern():
    """Header tipo '1 ACTUACIONES PREVIAS'."""
    page = MagicMock()
    page.extract_text.return_value = (
        "PROYECTO DE REHABILITACION\n"
        "1 ACTUACIONES PREVIAS\n"
        "1.1 m2 Demolicion de tabique\n"
    )
    result = _detect_chapter_header(page)
    assert result is not None
    assert "ACTUACIONES PREVIAS" in result


def test_detects_chapter_header_pat_pattern():
    """Header tipo 'PAT. 2 - FISURAS Y/O GRIETAS EN FORJADOS'."""
    page = MagicMock()
    page.extract_text.return_value = (
        "Continuacion\n"
        "PAT. 2 - FISURAS Y/O GRIETAS EN FORJADOS\n"
        "2.1 m2 Picado\n"
    )
    result = _detect_chapter_header(page)
    assert result is not None
    assert "PAT. 2" in result or "FISURAS" in result


def test_detects_chapter_header_c_prefix_pattern():
    """Header tipo 'C01 TRABAJOS PREVIOS'."""
    page = MagicMock()
    page.extract_text.return_value = (
        "Encabezado de documento de prueba sin chapter visible aqui.\n"
        "C01 TRABAJOS PREVIOS\n"
        "C01.01 Partida m2 Demolicion\n"
    )
    result = _detect_chapter_header(page)
    assert result is not None
    assert "TRABAJOS PREVIOS" in result or "C01" in result


def test_returns_none_when_no_chapter_header():
    page = MagicMock()
    page.extract_text.return_value = (
        "solo descripciones de partidas en minusculas sin headers\n"
        "1.1 m2 demolicion de tabique\n"
    )
    result = _detect_chapter_header(page)
    assert result is None


# ---------------------------------------------------------------------------
# _row_to_restructured_item
# ---------------------------------------------------------------------------


def test_row_to_restructured_item_basic_row():
    col_map = {"code": 0, "description": 1, "unit": 2, "quantity": 3, "price": 4}
    row = ["1.1", "Demolicion de tabique de pladur", "m2", "10,5", "15,20"]
    item = _row_to_restructured_item(row, col_map, "1 ACTUACIONES PREVIAS", 1)
    assert item is not None
    assert item.code == "1.1"
    assert item.description == "Demolicion de tabique de pladur"
    assert item.unit == "m2"
    assert item.quantity == 10.5
    assert item.chapter == "1 ACTUACIONES PREVIAS"


def test_row_to_restructured_item_handles_quantity_with_notes():
    """Cantidad que viene con notas adjuntas tipo
    '5,000\nSótano local. Punto coincidente...'."""
    col_map = {"code": 0, "description": 1, "unit": 2, "quantity": 3}
    row = [
        "1.2.12",
        "Refuerzo de forjado con perfiles HEB",
        "m2",
        "5000,000\nSotano local. Punto coincidente...",
    ]
    item = _row_to_restructured_item(row, col_map, "1 ACTUACIONES PREVIAS", 1)
    assert item is not None
    # Lo importante: que NO se quede en 1.0 (bug del LLM Vision); debe ser 5000.
    assert item.quantity == 5000.0


def test_row_to_restructured_item_normalizes_quantity_with_dot_thousands():
    """'1.000,5' → 1000.5 (formato español con punto miles y coma decimal)."""
    col_map = {"code": 0, "description": 1, "unit": 2, "quantity": 3}
    row = ["X", "test", "m2", "1.000,5"]
    item = _row_to_restructured_item(row, col_map, "Cap", 1)
    assert item is not None
    assert item.quantity == 1000.5


def test_row_to_restructured_item_returns_none_for_blank_rows():
    col_map = {"code": 0, "description": 1, "unit": 2, "quantity": 3}
    row = ["", "", "", ""]
    item = _row_to_restructured_item(row, col_map, "Cap", 1)
    assert item is None


def test_row_to_restructured_item_returns_none_when_code_missing():
    col_map = {"code": 0, "description": 1, "unit": 2, "quantity": 3}
    row = [None, "Description text", "m2", "5"]
    item = _row_to_restructured_item(row, col_map, "Cap", 1)
    assert item is None


def test_row_to_restructured_item_normalizes_unit():
    col_map = {"code": 0, "description": 1, "unit": 2, "quantity": 3}
    row = ["1.1", "Test", "m²", "10"]
    item = _row_to_restructured_item(row, col_map, "Cap", 1)
    assert item is not None
    assert item.unit_normalized == "m2"
    assert item.unit_dimension == "superficie"


def test_row_to_restructured_item_skips_subtotal_rows():
    """Filas como 'TOTAL', 'SUMA', 'IMPORTE' no son partidas válidas."""
    col_map = {"code": 0, "description": 1, "unit": 2, "quantity": 3}
    for keyword in ["TOTAL", "Suma capítulo", "Total partida", "IMPORTE TOTAL"]:
        row = ["", keyword, "", "100,5"]
        item = _row_to_restructured_item(row, col_map, "Cap", 1)
        assert item is None, f"'{keyword}' should be skipped"


# ---------------------------------------------------------------------------
# extract_with_pdfplumber_first — integration with mocked pdfplumber
# ---------------------------------------------------------------------------


def _mock_page(text: str = "", tables: Optional[List[List[List[Any]]]] = None, page_number: int = 1) -> Any:
    page = MagicMock()
    page.extract_text.return_value = text
    page.extract_tables.return_value = tables or []
    page.page_number = page_number
    return page


def _mock_pdf_context(pages):
    """Helper para mockear `pdfplumber.open(...)` con un context manager."""
    pdf_mock = MagicMock()
    pdf_mock.pages = pages
    cm = MagicMock()
    cm.__enter__ = MagicMock(return_value=pdf_mock)
    cm.__exit__ = MagicMock(return_value=False)
    return cm


def test_returns_items_when_pdf_has_tables_with_recognized_columns():
    pages = [
        _mock_page(
            text=(
                "PROYECTO TEST\n"
                "1 ACTUACIONES PREVIAS\n"
                "Codigo Descripcion Ud Cantidad Precio\n"
                "1.1 Demolicion de tabique m2 10,5 15,20\n"
                "1.2 Picado de revestimiento m2 22,5 8,40\n"
            ),
            tables=[
                [
                    ["Codigo", "Descripcion", "Ud", "Cantidad", "Precio"],
                    ["1.1", "Demolicion de tabique de pladur", "m2", "10,5", "15,20"],
                    ["1.2", "Picado de revestimiento ceramico", "m2", "22,5", "8,40"],
                ]
            ],
            page_number=1,
        )
    ]
    raw_items = [{}, {}]  # 2 expected partidas
    with patch("pdfplumber.open", return_value=_mock_pdf_context(pages)):
        result = extract_with_pdfplumber_first(b"fake_pdf", raw_items)
    assert result is not None
    assert len(result) == 2
    by_code = {it.code: it for it in result}
    assert "1.1" in by_code
    assert by_code["1.1"].quantity == 10.5
    assert by_code["1.1"].unit == "m2"
    assert "ACTUACIONES PREVIAS" in (by_code["1.1"].chapter or "")
    # La partida 1.2 con su quantity correcta
    assert by_code["1.2"].quantity == 22.5


def test_returns_none_when_pdf_appears_scanned():
    """Si la primera página tiene menos de 100 chars extraibles → escaneado, None."""
    pages = [_mock_page(text="", tables=[], page_number=1)]
    with patch("pdfplumber.open", return_value=_mock_pdf_context(pages)):
        result = extract_with_pdfplumber_first(b"fake_pdf", raw_items=[{}, {}])
    assert result is None


def test_returns_none_when_columns_unrecognized():
    """PDF nativo pero columnas no estándar → None, fallback al LLM."""
    pages = [
        _mock_page(
            text="PROYECTO TEST\n" + "foo bar baz\n" * 20,
            tables=[
                [
                    ["Foo", "Bar", "Baz"],
                    ["a", "b", "c"],
                    ["d", "e", "f"],
                ]
            ],
            page_number=1,
        )
    ]
    with patch("pdfplumber.open", return_value=_mock_pdf_context(pages)):
        result = extract_with_pdfplumber_first(b"fake_pdf", raw_items=[{}, {}])
    assert result is None


def test_returns_none_when_coverage_below_threshold():
    """Si extraemos 1 partida pero esperamos 10, cobertura 10% << 80% → None."""
    pages = [
        _mock_page(
            text=(
                "PROYECTO TEST\n"
                "1 ACTUACIONES PREVIAS\n"
                "Codigo Descripcion Ud Cantidad\n"
                "1.1 Solo una partida m2 5\n"
            ),
            tables=[
                [
                    ["Codigo", "Descripcion", "Ud", "Cantidad"],
                    ["1.1", "Solo una partida", "m2", "5"],
                ]
            ],
            page_number=1,
        )
    ]
    raw_items = [{}] * 10  # esperamos 10 partidas
    with patch("pdfplumber.open", return_value=_mock_pdf_context(pages)):
        result = extract_with_pdfplumber_first(b"fake_pdf", raw_items)
    # Coverage = 1/10 = 10% < 80% → caer al LLM.
    assert result is None


def test_chapter_carries_between_pages_until_new_chapter_header():
    """Si la página 2 no tiene chapter header, debe heredar el de la página 1."""
    long_filler = (
        "Documento de presupuesto generado por el aparejador con todas las "
        "mediciones y precios unitarios correspondientes a la obra contratada.\n"
    )
    pages = [
        _mock_page(
            text=(
                "PROYECTO DE REFORMA INTEGRAL DEL EDIFICIO\n"
                + long_filler
                + "1 ACTUACIONES PREVIAS\n"
                "Codigo Descripcion Ud Cantidad Precio\n"
                "1.1 partida en cap 1 m2 5 15,20\n"
            ),
            tables=[[
                ["Codigo", "Descripcion", "Ud", "Cantidad"],
                ["1.1", "partida en cap 1", "m2", "5"],
            ]],
            page_number=1,
        ),
        _mock_page(
            text=(
                "continuacion del documento sin header de capitulo nuevo aqui\n"
                + long_filler
                + "Codigo Descripcion Ud Cantidad\n"
                "1.2 partida que sigue m2 7\n"
            ),
            tables=[[
                ["Codigo", "Descripcion", "Ud", "Cantidad"],
                ["1.2", "partida que sigue", "m2", "7"],
            ]],
            page_number=2,
        ),
    ]
    raw_items = [{}, {}]
    with patch("pdfplumber.open", return_value=_mock_pdf_context(pages)):
        result = extract_with_pdfplumber_first(b"fake_pdf", raw_items)
    assert result is not None
    assert len(result) == 2
    by_code = {it.code: it for it in result}
    assert "ACTUACIONES PREVIAS" in (by_code["1.1"].chapter or "")
    # Debe heredar el chapter de la página 1
    assert "ACTUACIONES PREVIAS" in (by_code["1.2"].chapter or "")


def test_chapter_changes_when_new_header_appears():
    """Si la página 2 tiene un nuevo chapter header, lo respeta."""
    long_filler = (
        "Documento de presupuesto generado por el aparejador con todas las "
        "mediciones y precios unitarios correspondientes a la obra contratada.\n"
    )
    pages = [
        _mock_page(
            text=(
                "PROYECTO DE REFORMA INTEGRAL DEL EDIFICIO\n"
                + long_filler
                + "1 ACTUACIONES PREVIAS\n"
                "Codigo Descripcion Ud Cantidad\n"
                "1.1 partida en cap 1 m2 5\n"
            ),
            tables=[[
                ["Codigo", "Descripcion", "Ud", "Cantidad"],
                ["1.1", "partida en cap 1", "m2", "5"],
            ]],
            page_number=1,
        ),
        _mock_page(
            text=(
                "PAT. 2 - FISURAS Y/O GRIETAS EN FORJADOS\n"
                + long_filler
                + "Codigo Descripcion Ud Cantidad\n"
                "2.1 partida en cap 2 m2 7\n"
            ),
            tables=[[
                ["Codigo", "Descripcion", "Ud", "Cantidad"],
                ["2.1", "partida en cap 2", "m2", "7"],
            ]],
            page_number=2,
        ),
    ]
    raw_items = [{}, {}]
    with patch("pdfplumber.open", return_value=_mock_pdf_context(pages)):
        result = extract_with_pdfplumber_first(b"fake_pdf", raw_items)
    assert result is not None
    by_code = {it.code: it for it in result}
    assert "ACTUACIONES PREVIAS" in (by_code["1.1"].chapter or "")
    # Capitulo cambia en la pag 2.
    assert "FISURAS" in (by_code["2.1"].chapter or "") or "PAT" in (by_code["2.1"].chapter or "")


def test_quantity_with_notes_adjacent_extracts_first_number():
    """Caso bug-de-Sprint-2: cantidad 5000 m² confundida con 1 por LLM Vision.

    En heurístico debe quedar 5000 bien.
    """
    long_filler = (
        "Documento de presupuesto generado por el aparejador con todas las "
        "mediciones y precios unitarios correspondientes a la obra contratada.\n"
    )
    pages = [
        _mock_page(
            text=(
                "PROYECTO DE REHABILITACION ENERGETICA\n"
                + long_filler
                + "1 ACTUACIONES PREVIAS\n"
                "Codigo Descripcion Ud Cantidad\n"
                "1.2.12 Aplicacion impermeabilizante m2 5.000,000\n"
            ),
            tables=[[
                ["Codigo", "Descripcion", "Ud", "Cantidad"],
                ["1.2.12", "Aplicacion impermeabilizante", "m2",
                 "5.000,000\nSotano local. Punto coincidente con la sala de calderas."],
            ]],
            page_number=1,
        ),
    ]
    raw_items = [{}]
    with patch("pdfplumber.open", return_value=_mock_pdf_context(pages)):
        result = extract_with_pdfplumber_first(b"fake_pdf", raw_items)
    assert result is not None
    assert len(result) == 1
    # CRÍTICO: 5000 m2, no 1.
    assert result[0].quantity == 5000.0


def test_disabled_via_env_returns_none(monkeypatch):
    """`ENABLE_PDFPLUMBER_FIRST=false` actua como kill-switch."""
    monkeypatch.setenv("ENABLE_PDFPLUMBER_FIRST", "false")
    pages = [
        _mock_page(
            text="x" * 200 + "\nlots of text",
            tables=[[
                ["Codigo", "Descripcion", "Ud", "Cantidad"],
                ["1.1", "partida", "m2", "5"],
            ]],
            page_number=1,
        )
    ]
    with patch("pdfplumber.open", return_value=_mock_pdf_context(pages)):
        result = extract_with_pdfplumber_first(b"fake_pdf", raw_items=[{}])
    assert result is None


def test_returns_none_when_no_pages():
    """PDF vacio (sin paginas) → None."""
    pages: list = []
    with patch("pdfplumber.open", return_value=_mock_pdf_context(pages)):
        result = extract_with_pdfplumber_first(b"fake_pdf", raw_items=[{}])
    assert result is None


def test_returns_none_when_pdfplumber_raises():
    """Si pdfplumber falla (PDF corrupto, etc.) → None, fallback limpio."""
    with patch("pdfplumber.open", side_effect=Exception("boom")):
        result = extract_with_pdfplumber_first(b"fake_pdf", raw_items=[{}])
    assert result is None

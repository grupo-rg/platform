"""Tests de integración con PDFs sintéticos.

Estos tests construyen PDFs PRESTO TABULAR conocidos vía reportlab y
verifican que el parser los procesa correctamente. Son deterministas
(no requieren PDFs cliente sensibles).
"""
from __future__ import annotations

import pytest

try:
    from tests.budget.pdf_tabular_parser.fixtures.synthetic_pdf_builder import (
        REPORTLAB_AVAILABLE,
        build_presto_tabular_pdf,
    )
except Exception:  # pragma: no cover - safeguard
    REPORTLAB_AVAILABLE = False

from src.budget.pdf_tabular_parser.application.tabular_parser import TabularParser

pytestmark = pytest.mark.skipif(
    not REPORTLAB_AVAILABLE, reason="reportlab no instalado; skipping synthetic PDF tests"
)


def test_single_chapter_single_partida():
    """PDF mínimo: 1 capítulo, 1 partida con qty conocida."""
    chapters = [
        ("01", "ACTUACIONES PREVIAS", [
            ("01.01", "m2", "Demolición de tabique cerámico", 10.0),
        ]),
    ]
    pdf_bytes = build_presto_tabular_pdf(chapters)
    parser = TabularParser()
    result = parser.parse(pdf_bytes)

    assert result.pages_with_header >= 1
    assert result.partidas_count == 1
    p = result.partidas[0]
    assert p.code == "01.01"
    assert p.unit == "m2"
    assert "Demolición de tabique" in p.description
    assert p.quantity == pytest.approx(10.0, abs=0.01)
    assert "01" in p.chapter
    assert "ACTUACIONES" in p.chapter


def test_multiple_chapters_distinct():
    """Varios capítulos — cada partida hereda su capítulo correcto."""
    chapters = [
        ("01", "DEMOLICIONES", [
            ("01.01", "m2", "Demolición tabiques", 50.0),
            ("01.02", "m3", "Retirada escombros", 12.5),
        ]),
        ("02", "ALBAÑILERIA", [
            ("02.01", "m2", "Levantar tabique ladrillo", 30.0),
        ]),
    ]
    pdf_bytes = build_presto_tabular_pdf(chapters)
    parser = TabularParser()
    result = parser.parse(pdf_bytes)

    assert result.partidas_count == 3
    # Encontrar partidas por code y validar capítulo.
    by_code = {p.code: p for p in result.partidas}
    assert "01" in by_code["01.01"].chapter
    assert "DEMOLICIONES" in by_code["01.01"].chapter
    assert "01" in by_code["01.02"].chapter
    assert "02" in by_code["02.01"].chapter
    assert "ALBAÑILERIA" in by_code["02.01"].chapter


def test_qty_rate_above_80_percent():
    """Test viabilidad: ≥80% qty extraída."""
    chapters = [
        ("01", "TEST CHAPTER", [
            (f"01.{i:02d}", "m2", f"Partida {i} descripcion", float(i + 1) * 10)
            for i in range(1, 11)
        ]),
    ]
    pdf_bytes = build_presto_tabular_pdf(chapters)
    parser = TabularParser()
    result = parser.parse(pdf_bytes)

    assert result.partidas_count >= 10
    assert result.qty_rate >= 0.80, (
        f"qty_rate solo {result.qty_rate:.2%} < 80%. "
        f"Partidas sin qty: {[p.code for p in result.partidas if p.quantity is None]}"
    )


def test_no_header_aborts_gracefully():
    """PDF sin cabecera tabular → resultado no viable, reason=no_header."""
    # PDF "vacío" sin cabecera ni partidas.
    chapters: list = []
    pdf_bytes = build_presto_tabular_pdf(chapters, include_header_per_page=False)
    parser = TabularParser()
    result = parser.parse(pdf_bytes)
    # Sin partidas + sin cabecera → no viable.
    assert not result.is_viable()
    assert result.partidas_count == 0


def test_result_metrics_populated():
    """result expone partidas_count, qty_rate, chapter_rate, duration."""
    chapters = [
        ("01", "TEST", [
            ("01.01", "m2", "Partida con cantidad conocida", 5.0),
        ]),
    ]
    pdf_bytes = build_presto_tabular_pdf(chapters)
    parser = TabularParser()
    result = parser.parse(pdf_bytes)

    assert result.partidas_count == 1
    assert result.qty_rate == 1.0
    assert result.chapter_rate == 1.0
    assert result.duration_seconds > 0
    assert result.pages_total >= 1
    assert result.pages_with_header >= 1


def test_multi_page_pdf_header_persistent():
    """PDF con varias páginas — todas deben tener cabecera y partidas correctas."""
    # 50 partidas → forzaremos page break a los 30 → 2 páginas.
    chapters = [
        ("01", "MUCHAS PARTIDAS", [
            (f"01.{i:03d}", "m2", f"Partida número {i}", float(i + 1))
            for i in range(50)
        ]),
    ]
    pdf_bytes = build_presto_tabular_pdf(chapters, page_break_every=30)
    parser = TabularParser()
    result = parser.parse(pdf_bytes)

    assert result.pages_total >= 2
    assert result.pages_with_header >= 2  # header en cada página
    assert result.partidas_count == 50
    # qty rate alto.
    assert result.qty_rate >= 0.80


def test_no_false_positives_with_dates_in_content():
    """Test smoke: añadir un capítulo + verificar que no aparecen los
    falsos positivos famosos (`21`, `01.1`, ...) en codes de partidas.

    Como reportlab no permite emitir 'puro número en línea', generamos un
    PDF normal y verificamos que ningún code de partida es solo dígitos.
    """
    chapters = [
        ("21", "PATOLOGÍAS GRAVES", [
            ("21.01", "m2", "Patología tipo A", 5.0),
            ("21.02", "m3", "Patología tipo B", 3.5),
        ]),
    ]
    pdf_bytes = build_presto_tabular_pdf(chapters)
    parser = TabularParser()
    result = parser.parse(pdf_bytes)

    for p in result.partidas:
        # NUNCA debe haber un code de partida que sea sólo `21` o `01.1`.
        assert "." in p.code, f"Code '{p.code}' no tiene punto — FP"
        assert p.code not in {"21", "01.1", "0", "7"}, (
            f"Code '{p.code}' es un falso positivo conocido S3-06"
        )


def test_to_restructured_items_conversion():
    """to_restructured_items convierte a RestructuredItem del pipeline."""
    chapters = [
        ("01", "TEST", [
            ("01.01", "m2", "Partida test", 5.0),
        ]),
    ]
    pdf_bytes = build_presto_tabular_pdf(chapters)
    parser = TabularParser()
    result = parser.parse(pdf_bytes)

    items = result.to_restructured_items()
    assert len(items) == 1
    item = items[0]
    assert item.code == "01.01"
    assert item.unit == "m2"
    assert item.quantity == pytest.approx(5.0)
    assert item.chapter
    # unit_normalized debe estar poblado por el adapter.
    assert item.unit_normalized is not None

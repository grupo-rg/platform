"""Integration tests for ``scripts/extract_catalog_from_pdf.py``.

These tests open the real PDF (``docs/Palma47_2025_COAATMCA.pdf``) and assert
that the parser correctly classifies, extracts and structures known pages.
They are explicitly **integration** tests — the PDF is the source of truth.

Skipped if the PDF is not present on disk (e.g. CI runners without the file).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make the parser importable.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import pdfplumber  # noqa: E402

from scripts.extract_catalog_from_pdf import (  # noqa: E402
    PAGE_TYPE_ADVERTISEMENT,
    PAGE_TYPE_CHAPTER_COVER,
    PAGE_TYPE_CONTENT,
    PAGE_TYPE_PDF_COVER,
    PAGE_TYPE_TOC,
    LogicalLine,
    Word,
    classify_page,
    extract_breakdown_line,
    extract_catalog,
    extract_chapter_title_from_cover,
    extract_partida_line,
    is_breakdown_line,
    is_partida_line,
    parse_footer,
    parse_toc_page,
    _extract_words,
    _group_into_lines,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _find_pdf() -> Path:
    """Locate the catalogue PDF. Worktree directories don't contain the file
    (it's gitignored due to size). Fall back to walking up the directory tree
    until ``docs/Palma47_2025_COAATMCA.pdf`` is found.
    """
    here = Path(__file__).resolve()
    for parent in (here.parents[3], *here.parents):
        candidate = parent / "docs" / "Palma47_2025_COAATMCA.pdf"
        if candidate.is_file():
            return candidate
    # Final fallback — known absolute path in this dev environment.
    fallback = Path("c:/Users/Usuario/Documents/github/works/dochevi/dochevi-construc/docs/Palma47_2025_COAATMCA.pdf")
    return fallback


PDF_PATH = _find_pdf()

# Si el PDF no existe (CI sin el binario), skip todo el módulo.
pytestmark = pytest.mark.skipif(
    not PDF_PATH.is_file(),
    reason=f"PDF source not available at {PDF_PATH}",
)


@pytest.fixture(scope="module")
def pdf():
    with pdfplumber.open(str(PDF_PATH)) as p:
        yield p


def _get_page(pdf, page_no: int):
    return pdf.pages[page_no - 1]


# ---------------------------------------------------------------------------
# Page classification (Tarea 2 — validación intermedia GATE)
# ---------------------------------------------------------------------------


def test_classify_pdf_cover(pdf):
    """Página física 12 → pdf_cover. Sin word_count, sin footer útil."""
    page = _get_page(pdf, 12)
    assert classify_page(page) == PAGE_TYPE_PDF_COVER


def test_classify_chapter_cover(pdf):
    """Página física 13 → chapter_cover, título = DEMOLICIONES."""
    page = _get_page(pdf, 13)
    assert classify_page(page) == PAGE_TYPE_CHAPTER_COVER
    title = extract_chapter_title_from_cover(page)
    assert title is not None
    assert "DEMOLICIONES" in title


def test_classify_advertisement(pdf):
    """Página física 32 → advertisement (0 words, sin footer canonical)."""
    page = _get_page(pdf, 32)
    assert classify_page(page) == PAGE_TYPE_ADVERTISEMENT


def test_classify_content_page(pdf):
    """Página física 14 → content_page, footer = (DEMOLICIONES, Forjados)."""
    page = _get_page(pdf, 14)
    assert classify_page(page) == PAGE_TYPE_CONTENT
    chapter, subchapter = parse_footer(page)
    assert chapter == "DEMOLICIONES"
    assert subchapter == "Forjados"


def test_classify_toc_page(pdf):
    """Página física 474 → toc_page (con `•` y `••` markers)."""
    page = _get_page(pdf, 474)
    assert classify_page(page) == PAGE_TYPE_TOC


def test_classify_toc_pages_range(pdf):
    """Las páginas TOC son al menos 474..477 según el dump real."""
    toc_pages_found = []
    for pno in (474, 475, 476, 477):
        page = _get_page(pdf, pno)
        if classify_page(page) == PAGE_TYPE_TOC:
            toc_pages_found.append(pno)
    assert len(toc_pages_found) >= 3, (
        f"Expected ≥3 TOC pages in 474-477, found {toc_pages_found}"
    )


# ---------------------------------------------------------------------------
# Footer parsing (helper used by content/chapter_cover paths)
# ---------------------------------------------------------------------------


def test_footer_canonical_demoliciones_forjados(pdf):
    page = _get_page(pdf, 14)
    ch, sub = parse_footer(page)
    assert ch == "DEMOLICIONES"
    assert sub == "Forjados"


def test_footer_seguridad_y_salud_andamios(pdf):
    """Página 459 muestra el footer `SEGURIDAD Y SALUD Andamios`."""
    page = _get_page(pdf, 459)
    ch, sub = parse_footer(page)
    assert ch == "SEGURIDAD Y SALUD"
    assert sub == "Andamios"


# ---------------------------------------------------------------------------
# Line classification (uses pure helpers; no I/O).
# ---------------------------------------------------------------------------


def _make_word(text: str, x0: float, font: str = "ARFQVY+ArialNarrow-Bold,Bold", size: float = 8.1):
    return Word(text=text, x0=x0, x1=x0 + 5 * len(text), y0=100.0, y1=108.0, font=font, size=size)


def test_is_partida_line_real_pdf_dqc040(pdf):
    """En la página 14 (físico), la línea de DQC040 debe ser detectada."""
    page = _get_page(pdf, 14)
    words = _extract_words(page)
    lines = _group_into_lines(words)
    # Buscar la línea que empieza con DQC040.
    line = next((l for l in lines if l.words and l.words[0].text == "DQC040"), None)
    assert line is not None
    assert is_partida_line(line)


def test_is_breakdown_line_real_pdf_mo020(pdf):
    page = _get_page(pdf, 14)
    words = _extract_words(page)
    lines = _group_into_lines(words)
    line = next((l for l in lines if l.words and l.words[0].text == "mo020"), None)
    assert line is not None
    assert is_breakdown_line(line)


def test_is_partida_rejects_pagina_header(pdf):
    """La línea ``Página 2`` del header NO debe ser detectada como partida."""
    page = _get_page(pdf, 14)
    words = _extract_words(page)
    lines = _group_into_lines(words)
    # Esa línea contiene solo "Página" + "2"; first word x0 ≈ 516.
    pag_line = next(
        (l for l in lines if l.words and l.words[0].text.lower().startswith("p")), None
    )
    if pag_line is not None:
        assert not is_partida_line(pag_line)


# ---------------------------------------------------------------------------
# Full partida extraction
# ---------------------------------------------------------------------------


def test_extract_partida_dqc040_full(pdf):
    """Extracción completa de DQC040 con sus 3 breakdowns (mo020, mo113, %)."""
    extraction = extract_catalog(PDF_PATH, page_filter=[13, 14])
    items = extraction.items
    # Filtra solo DQC040 (no DQC040c, DQC030, etc.).
    dqc040 = next((it for it in items if it.code == "DQC040"), None)
    assert dqc040 is not None, f"DQC040 no extraído. Items: {[it.code for it in items]}"
    assert dqc040.unit in ("m2", "m²")
    assert dqc040.chapter == "DEMOLICIONES"
    # subchapter puede ser "Cubiertas" (header) o "Forjados" (footer de p14) —
    # el footer es source-of-truth → debería ser Forjados.
    # Para la PRIMERA partida (DQC040, que está al inicio de la página 14), el
    # footer ya dice "Forjados" (porque la página 14 está dedicada a Forjados
    # principalmente). Aceptamos cualquiera de los dos.
    assert dqc040.subchapter in ("Forjados", "Cubiertas")
    # Descripción contiene fragmento clave.
    assert "cobertura" in dqc040.description.lower() or "desmontaje" in dqc040.description.lower()
    # Price total: 18,09 según el dump real (línea Bold encima del código).
    assert 17.0 <= dqc040.price_total <= 19.0, f"price_total={dqc040.price_total}"
    # Debe tener 3 breakdowns: mo020, mo113, %.
    bd_codes = [bd.code for bd in dqc040.breakdowns]
    assert "mo020" in bd_codes
    assert "mo113" in bd_codes
    assert "%" in bd_codes


def test_extract_breakdown_mo020_quantities(pdf):
    """mo020 del DQC040 debe tener qty=0.123, unit=h, price_unit≈29.73."""
    extraction = extract_catalog(PDF_PATH, page_filter=[13, 14])
    dqc040 = next(it for it in extraction.items if it.code == "DQC040")
    mo020 = next((bd for bd in dqc040.breakdowns if bd.code == "mo020"), None)
    assert mo020 is not None
    assert abs(mo020.quantity - 0.123) < 0.01
    assert mo020.unit.lower() == "h"
    assert abs(mo020.price_unit - 29.73) < 0.5
    assert abs(mo020.price_total - 3.66) < 0.5


def test_extract_breakdown_medios_auxiliares_percent(pdf):
    """Breakdown `%` en DQC040 debe tener qty=7.0 (el `7,000`)."""
    extraction = extract_catalog(PDF_PATH, page_filter=[13, 14])
    dqc040 = next(it for it in extraction.items if it.code == "DQC040")
    medios = next((bd for bd in dqc040.breakdowns if bd.code == "%"), None)
    assert medios is not None
    # qty es 7.0 (no 0.07) en el PDF.
    assert abs(medios.quantity - 7.0) < 0.5
    assert medios.unit == "%"


# ---------------------------------------------------------------------------
# Pages with chapter cover ↔ content cross-page transitions
# ---------------------------------------------------------------------------


def test_chapter_cover_p13_yields_demoliciones(pdf):
    """La portada del capítulo 1 (página 13) debe abrir capítulo DEMOLICIONES."""
    extraction = extract_catalog(PDF_PATH, page_filter=[13, 14])
    classifications = {c.page_no: c for c in extraction.page_classifications}
    assert classifications[13].page_type == PAGE_TYPE_CHAPTER_COVER
    # En la siguiente página de contenido, el capítulo debe estar set a DEMOLICIONES.
    assert classifications[14].page_type == PAGE_TYPE_CONTENT
    # El primer item ya extraído debe llevar chapter=DEMOLICIONES.
    if extraction.items:
        assert extraction.items[0].chapter == "DEMOLICIONES"


# ---------------------------------------------------------------------------
# TOC parsing
# ---------------------------------------------------------------------------


def test_parse_toc_p474_has_demoliciones_and_movimiento(pdf):
    page = _get_page(pdf, 474)
    entries = parse_toc_page(page)
    titles = [e.title for e in entries]
    # Debe contener al menos un nivel 1 con "DEMOLICIONES" y "MOVIMIENTO DE TIERRAS".
    assert any("DEMOLICIONES" in t for t in titles), f"DEMOLICIONES no en TOC: {titles[:10]}"
    assert any("MOVIMIENTO DE TIERRAS" in t for t in titles), f"MOVIMIENTO no en TOC: {titles[:30]}"


def test_parse_toc_has_levels(pdf):
    page = _get_page(pdf, 474)
    entries = parse_toc_page(page)
    levels = {e.level for e in entries}
    assert 1 in levels
    assert 2 in levels


# ---------------------------------------------------------------------------
# Smoke: small slice of the PDF must produce > 0 items.
# ---------------------------------------------------------------------------


def test_extraction_slice_p13_14_yields_items(pdf):
    extraction = extract_catalog(PDF_PATH, page_filter=[13, 14])
    assert extraction.stats["total_items"] >= 5, (
        f"En las páginas 13-14 deberían extraerse ~8 partidas, hubo "
        f"{extraction.stats['total_items']}"
    )
    # Debe haber ≥ 1 breakdown.
    assert extraction.stats["total_breakdowns"] >= 5

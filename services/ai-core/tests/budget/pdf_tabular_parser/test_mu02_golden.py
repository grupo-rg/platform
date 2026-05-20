"""Tests golden MU02 — Sprint 4 Fase E.

Verifica que el parser detecta correctamente el layout MU02 sobre el PDF
real `mu02_albanileria.pdf` (25 páginas, Balearchitekt Projekte) y
extrae partidas con qty real (no via fallback).

Y que NO activa MU02_INLINE falsamente en:
- SANITAS (ANNEXED).
- RdLL (ANNEXED).
- private_residence_palma (INLINE).

Si los PDFs golden no están disponibles localmente, los tests se skipean
(marker `golden`).
"""
from __future__ import annotations

import os
import pathlib
import time

import pytest

from src.budget.pdf_tabular_parser.application.tabular_parser import TabularParser

# --- Path resolution ---
_DEFAULT_GOLDEN_DIR = (
    r"c:\Users\Usuario\Documents\github\works\dochevi\dochevi-construc\data\pdf_layouts\golden"
)
GOLDEN_DIR = os.environ.get("SPRINT4_GOLDEN_DIR", _DEFAULT_GOLDEN_DIR)


def _golden_path(name: str) -> str:
    return os.path.join(GOLDEN_DIR, name)


def _golden_exists(name: str) -> bool:
    return os.path.exists(_golden_path(name))


def _load_pdf(name: str) -> bytes:
    return pathlib.Path(_golden_path(name)).read_bytes()


pytestmark = pytest.mark.skipif(
    not os.path.isdir(GOLDEN_DIR),
    reason=f"golden PDFs no disponibles en {GOLDEN_DIR}",
)


@pytest.mark.golden
def test_mu02_albanileria_full_extraction():
    """MU02 ahora extrae con qty real, no via fallback."""
    if not _golden_exists("mu02_albanileria.pdf"):
        pytest.skip("mu02_albanileria.pdf no disponible")

    pdf_bytes = _load_pdf("mu02_albanileria.pdf")
    parser = TabularParser()
    t0 = time.time()
    result = parser.parse(pdf_bytes)
    duration = time.time() - t0

    print(
        f"\n[mu02_albanileria MU02_INLINE] mode={result.mode} "
        f"pages_with_header={result.mu02_pages_with_header}/{result.pages_total} "
        f"partidas={result.partidas_count} "
        f"qty_rate={result.qty_rate:.2%} chapter_rate={result.chapter_rate:.2%} "
        f"duration={duration:.2f}s viable={result.is_viable()} reason={result.reason}"
    )

    assert result.is_viable(), f"MU02 no viable, reason={result.reason}"
    assert result.mode == "MU02_INLINE", f"mode esperado=MU02_INLINE, obtuvo={result.mode}"
    assert result.partidas_count >= 95, (
        f"Esperaba >=95 partidas, obtuve {result.partidas_count}"
    )
    assert result.qty_rate >= 0.95, (
        f"Esperaba qty_rate >=95% (objetivo: era 25.3% antes), obtuve {result.qty_rate:.2%}"
    )
    assert duration < 5.0, f"Duración {duration:.2f}s, esperaba <5s"

    # Controles negativos: códigos puntuales esperados.
    codes = {p.code for p in result.partidas}
    assert "1.1" in codes, "Falta partida 1.1"
    assert "2.1" in codes, "Falta partida 2.1"
    assert "15.1" in codes or "15.2" in codes, "Falta partida del capítulo 15"

    # Capítulos detectados (14 capítulos según inspección previa: 1, 2, 3, ..., 15
    # con 12 también, sin saltos esperados pero permitimos 14+).
    chapters_seen = {p.chapter for p in result.partidas if p.chapter}
    assert len(chapters_seen) >= 14, (
        f"Esperaba >=14 capítulos, obtuve {len(chapters_seen)}: {sorted(chapters_seen)}"
    )


@pytest.mark.golden
def test_sanitas_dental_still_uses_ANNEXED_not_MU02():
    """Regresión: SANITAS sigue usando ANNEXED, NO MU02."""
    if not _golden_exists("sanitas_dental.pdf"):
        pytest.skip("sanitas_dental.pdf no disponible")

    pdf_bytes = _load_pdf("sanitas_dental.pdf")
    parser = TabularParser()
    result = parser.parse(pdf_bytes)

    assert result.mode == "ANNEXED", (
        f"SANITAS debe usar mode=ANNEXED, obtuvo {result.mode}"
    )
    assert result.annexed is True
    assert result.mu02_pages_with_header == 0


@pytest.mark.golden
def test_rdll_still_uses_ANNEXED_not_MU02():
    """Regresión: RdLL sigue usando ANNEXED, NO MU02."""
    if not _golden_exists("presupuesto_grande_rdll.pdf"):
        pytest.skip("presupuesto_grande_rdll.pdf no disponible")

    pdf_bytes = _load_pdf("presupuesto_grande_rdll.pdf")
    parser = TabularParser()
    result = parser.parse(pdf_bytes)

    assert result.mode == "ANNEXED", (
        f"RdLL debe usar mode=ANNEXED, obtuvo {result.mode}"
    )
    assert result.annexed is True
    assert result.mu02_pages_with_header == 0


@pytest.mark.golden
def test_private_residence_palma_still_uses_INLINE_not_MU02():
    """Regresión: private_residence_palma sigue usando INLINE, NO MU02."""
    if not _golden_exists("private_residence_palma.pdf"):
        pytest.skip("private_residence_palma.pdf no disponible")

    pdf_bytes = _load_pdf("private_residence_palma.pdf")
    parser = TabularParser()
    result = parser.parse(pdf_bytes)

    assert result.mode == "INLINE", (
        f"private_residence_palma debe usar mode=INLINE, obtuvo {result.mode}"
    )
    assert result.annexed is False
    assert result.mu02_pages_with_header == 0


@pytest.mark.golden
def test_mu02_events_emitted():
    """Verifica que se emiten los eventos SSE de MU02 sobre el PDF real."""
    if not _golden_exists("mu02_albanileria.pdf"):
        pytest.skip("mu02_albanileria.pdf no disponible")

    pdf_bytes = _load_pdf("mu02_albanileria.pdf")

    events: list[tuple[str, dict]] = []

    def callback(name: str, payload: dict) -> None:
        events.append((name, payload))

    parser = TabularParser()
    parser.parse(pdf_bytes, event_callback=callback)

    event_names = [e[0] for e in events]
    assert "mu02_layout_detected" in event_names, (
        f"Falta evento mu02_layout_detected, eventos={event_names}"
    )
    assert "mu02_extraction_complete" in event_names, (
        f"Falta evento mu02_extraction_complete, eventos={event_names}"
    )

    # Verificar payloads.
    layout_event = next(e for e in events if e[0] == "mu02_layout_detected")
    assert layout_event[1]["pagesWithHeader"] >= 2
    assert layout_event[1]["totalPages"] >= 2

    complete_event = next(e for e in events if e[0] == "mu02_extraction_complete")
    assert complete_event[1]["partidasCount"] >= 95
    assert complete_event[1]["qtyRate"] >= 0.95

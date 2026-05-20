"""Tests para patterns.py — Sprint 4 Fase D.

Verifica que TOTAL_LINE_RE matchea los formatos reales del cliente Grupo RG
(SANITAS, RdLL) y rechaza los sub-totales internos PRESTO (TC-, EL-, FN-).
"""
from __future__ import annotations

import pytest

from src.budget.pdf_tabular_parser.application.patterns import (
    SUBTOTAL_INTERNAL_RE,
    TOTAL_LINE_RE,
)


# --- Casos POSITIVOS: el regex DEBE matchear ---

VALID_TOTAL_LINES = [
    # (line, expected_code, expected_qty_str)
    # SANITAS — prefijo C, 3 números trailing
    ("Total C01.01 236,50 0,00 0,00", "C01.01", "236,50"),
    ("Total C01.02 37,50 0,00 0,00", "C01.02", "37,50"),
    ("Total C01.08 13,72 0,00 0,00", "C01.08", "13,72"),
    # RdLL — código numérico simple
    ("Total 01.01 220,88 0,00", "01.01", "220,88"),
    ("Total 02.01 1.247,30 0,00", "02.01", "1.247,30"),
    # RdLL — código con sufijo PC
    ("Total 90PC07.01 495,00 0,00", "90PC07.01", "495,00"),
    # Edge cases: cantidad entera
    ("Total 01.01 1 0,00", "01.01", "1"),
    ("Total 03.04 100 0,00", "03.04", "100"),
    # Edge cases: 3 niveles (XX.YY.ZZ)
    ("Total 01.01.05 25,00 0,00", "01.01.05", "25,00"),
    # Edge cases: 4 niveles (XX.YY.ZZ.WW)
    ("Total 01.01.05.02 25,00 0,00", "01.01.05.02", "25,00"),
    # Edge case: sin trailing numbers
    ("Total 01.01 220,88", "01.01", "220,88"),
    # SANITAS sin C, debería seguir funcionando
    ("Total 01.01 236,50 0,00 0,00", "01.01", "236,50"),
]


@pytest.mark.parametrize("line,expected_code,expected_qty", VALID_TOTAL_LINES)
def test_total_line_re_matches_valid_lines(line, expected_code, expected_qty):
    """Cada línea válida debe matchear y extraer code+qty correctamente."""
    m = TOTAL_LINE_RE.match(line)
    assert m is not None, f"Línea válida no matcheada: {line!r}"
    assert m.group("code") == expected_code, (
        f"Code esperado={expected_code} obtenido={m.group('code')} en línea {line!r}"
    )
    assert m.group("qty") == expected_qty, (
        f"Qty esperado={expected_qty} obtenido={m.group('qty')} en línea {line!r}"
    )


# --- Casos NEGATIVOS: el regex NO DEBE matchear ---

INVALID_TOTAL_LINES = [
    # Prefijos PRESTO internos — NO son partidas
    "Total TC-1.1.1 1,00",
    "Total TC-1.4 1,00 0,00 0,00",
    "Total EL-1.8 1,00",
    "Total FN-2.3 5,00",
    "Total PS-1.1 2,00",
    "Total CL-3.4.5 10,00",
    "Total S-2.1 4,00",
    "Total VN-1.1 8,00",
    "Total PL-2.3 3,00",
    "Total DC-1.1.1 7,00",
    "Total SN-4.5 9,00",
    # Líneas que no empiezan con "Total"
    "Subtotal 01.01 100,00",
    "SUMA 01.01 100,00",
    "01.01 m2 Demolición 220,88",
    "  Total 01.01 100,00",  # tab/spacing accepted? we want exact start with "Total"
    "Total CAPÍTULO 02 ALBAÑILERÍA 1234,56",
    "",
    "   ",
    # Total seguido de texto, no código numérico válido
    "Total CAPITULO 1234,56",
    "Total ALBAÑILERÍA 100",
    # Total con código simple (sin nivel) — no es partida
    "Total 01 100,00",
    "Total 1 5,00",
]


@pytest.mark.parametrize("line", INVALID_TOTAL_LINES)
def test_total_line_re_rejects_invalid_lines(line):
    """Líneas inválidas o de sub-totales PRESTO no deben matchear."""
    m = TOTAL_LINE_RE.match(line)
    assert m is None, (
        f"Línea inválida fue matcheada: {line!r} → code={m.group('code') if m else None}"
    )


# --- Tests específicos del SUBTOTAL_INTERNAL_RE (diagnóstico, no extracción) ---

SUBTOTAL_INTERNAL_LINES = [
    ("Total TC-1.1.1 1,00", "TC"),
    ("Total EL-1.8 1,00", "EL"),
    ("Total FN-2.3 5,00", "FN"),
    ("Total PS-1.1 2,00", "PS"),
    ("Total CL-3.4.5 10,00", "CL"),
]


@pytest.mark.parametrize("line,expected_prefix", SUBTOTAL_INTERNAL_LINES)
def test_subtotal_internal_re_matches_presto_prefixes(line, expected_prefix):
    """El detector diagnóstico debe identificar los prefijos PRESTO internos."""
    m = SUBTOTAL_INTERNAL_RE.match(line)
    assert m is not None, f"Sub-total interno no detectado: {line!r}"
    assert m.group("prefix") == expected_prefix


def test_subtotal_internal_re_does_not_match_valid_partidas():
    """El detector de sub-totales NO debe matchear líneas de partida real."""
    valid_partidas = [
        "Total 01.01 220,88 0,00",
        "Total C01.01 236,50 0,00 0,00",
        "Total 90PC07.01 495,00 0,00",
    ]
    for line in valid_partidas:
        assert SUBTOTAL_INTERNAL_RE.match(line) is None, (
            f"Partida real fue detectada erróneamente como sub-total interno: {line!r}"
        )


# --- Test extra: leading/trailing whitespace ---

def test_total_line_re_tolerates_trailing_whitespace():
    """Líneas con espacios finales deben matchear."""
    line = "Total 01.01 220,88 0,00   "
    m = TOTAL_LINE_RE.match(line)
    assert m is not None
    assert m.group("code") == "01.01"
    assert m.group("qty") == "220,88"


def test_total_line_re_rejects_lines_with_extra_text_after():
    """Líneas con texto después de los números deben rechazarse."""
    line = "Total 01.01 220,88 0,00 algo más"
    m = TOTAL_LINE_RE.match(line)
    assert m is None

"""Tests para mu02_detector — Sprint 4 Fase E.

Verifica que `detect_mu02_layout` retorna True solo cuando el PDF tiene
la cabecera tabular MU02 repetida en >=2 páginas.
"""
from __future__ import annotations

from typing import List

from src.budget.pdf_tabular_parser.application.mu02_detector import detect_mu02_layout


# --- True positives ---


def test_detects_mu02_layout_with_multiple_pages():
    """3 páginas con cabecera MU02 → True."""
    pages: List[str] = [
        "MU02-\nPol.11-Parc.213\n1 ACTUACIONES PREVIAS\nNº Ud Descripción Cantidad Precio Total\n1.1 Ud Algo\n1,00 Ud",
        "MU02-\n2 ACONDICIONAMIENTO\nNº Ud Descripción Cantidad Precio Total\n2.1 M² Algo más\n100,00 m²",
        "MU02-\n3 CIMENTACIONES\nNº Ud Descripción Cantidad Precio Total\n3.1 M³ Hormigón\n50,00 m³",
    ]
    assert detect_mu02_layout(pages) is True


def test_detects_mu02_with_exactly_2_pages_with_header():
    """Caso límite: 2 páginas con cabecera → True (umbral >=2)."""
    pages: List[str] = [
        "Nº Ud Descripción Cantidad Precio Total\n1.1 Ud Algo",
        "Random texto sin cabecera",
        "Nº Ud Descripción Cantidad Precio Total\n2.1 M² Algo",
    ]
    assert detect_mu02_layout(pages) is True


def test_detects_mu02_with_25_pages_mu02_albanileria_simulated():
    """Simula mu02_albanileria (25pp con cabecera en todas)."""
    page = "MU02-\nPol.11-Parc.213\nN ACTUACIONES\nNº Ud Descripción Cantidad Precio Total\n1.1 Ud Algo\n1,00 Ud"
    pages = [page] * 25
    assert detect_mu02_layout(pages) is True


# --- True negatives ---


def test_does_not_detect_sanitas_42pp():
    """SANITAS (ANNEXED): no tiene cabecera MU02."""
    pages: List[str] = [
        "C01.01 Partida ud Algo\nDescripción técnica",
        "Total C01.01 100,00 0,00 0,00\nTotal C01.02 50,00 0,00 0,00",
    ] * 21
    assert detect_mu02_layout(pages) is False


def test_does_not_detect_rdll_258pp():
    """RdLL (ANNEXED): no tiene cabecera MU02."""
    pages: List[str] = ["01.01 ud Descripción"] * 129
    pages.extend(["Total 01.01 100,00 0,00\nTotal 01.02 50,00 0,00"] * 129)
    assert detect_mu02_layout(pages) is False


def test_does_not_detect_private_residence_palma_14pp():
    """private_residence_palma (INLINE/TABULAR): cabecera CIFRE, no MU02."""
    pages: List[str] = [
        "CÓDIGO RESUMEN UDS LONGITUD ANCHURA ALTURA PARCIALES CANTIDAD\n1.2.6 m2 Eliminación"
    ] * 14
    assert detect_mu02_layout(pages) is False


def test_does_not_detect_single_page_with_header():
    """Si solo 1 página tiene cabecera → False (umbral >=2)."""
    pages: List[str] = [
        "Nº Ud Descripción Cantidad Precio Total\n1.1 Ud Algo",
        "Solo texto, sin cabecera",
        "Otro texto sin cabecera tampoco",
    ]
    assert detect_mu02_layout(pages) is False


def test_does_not_detect_empty_pages():
    """Lista vacía o todas las páginas vacías → False."""
    assert detect_mu02_layout([]) is False
    assert detect_mu02_layout(["", "", ""]) is False

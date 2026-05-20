"""Tests para annexed_detector — Sprint 4 Fase D.

Verifica:
- D2: detect_annexed_transition_page identifica el inicio de la fase ANNEXED.
- D3: extract_totals_from_annexed_pages parsea correctamente los totales.
"""
from __future__ import annotations

from typing import List

import pytest

from src.budget.pdf_tabular_parser.application.annexed_detector import (
    detect_annexed_transition_page,
    extract_totals_from_annexed_pages,
)


# --- D2: detect_annexed_transition_page ---


def test_detect_annexed_transition_basic_rdll_like():
    """Caso RdLL-like: 258 páginas, totales empiezan en p130."""
    # Páginas 1-129: descripciones (sin totales)
    pages: List[str] = ["partida descripción texto\n"] * 129
    # Página 130: arranca con varios totales
    pages.append("Total 01.01 100,00 0,00\nTotal 01.02 50,00 0,00\nTotal 01.03 25,00 0,00\n")
    # Páginas 131-258: más totales
    for i in range(131, 259):
        pages.append(f"Total 02.{i % 10:02d} 10,00 0,00\nTotal 03.{i % 10:02d} 20,00 0,00\n")

    page = detect_annexed_transition_page(pages)
    assert page == 130, f"Esperado 130, obtenido {page}"


def test_detect_annexed_transition_sanitas_like():
    """SANITAS-like: 42 páginas, transition ≈ p22."""
    pages: List[str] = ["partida descripción texto\n"] * 21
    pages.append("Total C01.01 100,00 0,00 0,00\nTotal C01.02 50,00 0,00 0,00\n")
    for i in range(23, 43):
        pages.append(f"Total C01.{i:02d} 10,00 0,00 0,00\n")

    page = detect_annexed_transition_page(pages)
    assert page == 22


def test_detect_annexed_transition_inline_pdf_returns_none():
    """PDF inline (private_residence_palma-like, 14pp): no hay annexed."""
    # 14 páginas, todas con descripciones inline (sin totales aislados)
    pages: List[str] = []
    for i in range(14):
        pages.append(
            f"Página {i+1}\n"
            "1.2.6 m2 Eliminación de yeso\n"
            "Subtotal 10,000\n"
            "10,000 0,00 0,00\n"
        )
    page = detect_annexed_transition_page(pages)
    assert page is None


def test_detect_annexed_transition_mu02_returns_none():
    """MU02 (25pp, inline puro): no debe activar annexed."""
    pages: List[str] = []
    for i in range(25):
        pages.append(
            f"1.{i+1} Ud Acondicionamiento\n"
            "Descripción técnica\n"
            "1,00 0,00 0,00\n"
        )
    page = detect_annexed_transition_page(pages)
    assert page is None


def test_detect_annexed_transition_early_totals_means_unknown():
    """Si los totales aparecen en el primer tercio → UNKNOWN, retorna None.

    Ejemplo: PDF de 30pp con totales en p3 — eso es inline, no annexed.
    """
    pages: List[str] = []
    # p1: descripción
    pages.append("descripción\n")
    # p2-3: descripción
    pages.append("descripción\n")
    # p3: totales (primer tercio en un PDF de 30pp = p1-10)
    pages.append("Total 01.01 100,00 0,00\nTotal 01.02 50,00 0,00\nTotal 01.03 25,00 0,00\n")
    # Resto: descripción mixta sin más totales
    for _ in range(27):
        pages.append("descripción\n")

    page = detect_annexed_transition_page(pages)
    assert page is None, f"Totales tempranos no deben ser annexed; obtenido {page}"


def test_detect_annexed_transition_requires_min_2_totals():
    """Si una sola página tiene solo 1 total aislado, no es transition."""
    pages: List[str] = ["descripción\n"] * 50
    # P51: solo 1 total
    pages.append("Total 01.01 100,00 0,00\n")
    # Resto: vacío
    pages.extend(["descripción\n"] * 50)

    page = detect_annexed_transition_page(pages)
    assert page is None


def test_detect_annexed_transition_empty_input():
    """Lista vacía retorna None sin crashear."""
    page = detect_annexed_transition_page([])
    assert page is None


def test_detect_annexed_transition_ignores_presto_internal_subtotals():
    """Si la página tiene solo sub-totales internos (TC-, EL-, FN-), NO es transition."""
    pages: List[str] = ["descripción\n"] * 50
    # P51-100: solo sub-totales PRESTO internos (no son partidas)
    for _ in range(50):
        pages.append("Total TC-1.1.1 1,00\nTotal EL-1.8 1,00\nTotal FN-2.3 5,00\n")

    page = detect_annexed_transition_page(pages)
    assert page is None


def test_detect_annexed_transition_mixed_totals_and_internal_uses_only_valid():
    """Página con mezcla: cuenta solo los totales válidos (>=2 → transition)."""
    pages: List[str] = ["descripción\n"] * 50
    # P51: 3 sub-totales internos + 2 válidos → cuenta solo 2 válidos
    pages.append("Total TC-1.1.1 1,00\nTotal 01.01 100,00 0,00\nTotal 01.02 50,00 0,00\n")
    pages.extend(["Total 02.01 5,00 0,00\nTotal 02.02 5,00 0,00\n"] * 50)

    page = detect_annexed_transition_page(pages)
    assert page == 51


# --- D3: extract_totals_from_annexed_pages ---


def test_extract_totals_basic_rdll():
    """Extrae correctamente de un bloque típico RdLL."""
    pages: List[str] = ["descripción"] * 129
    pages.append(
        "Total 01.01 220,88 0,00\n"
        "Total 01.02 100,00 0,00\n"
        "Total 02.01 1.247,30 0,00\n"
    )
    pages.append(
        "Total 03.01 50,00 0,00\n"
        "Total 90PC07.01 495,00 0,00\n"
    )

    totals = extract_totals_from_annexed_pages(pages, start_page=130)
    assert totals == {
        "01.01": 220.88,
        "01.02": 100.0,
        "02.01": 1247.30,
        "03.01": 50.0,
        "90PC07.01": 495.0,
    }


def test_extract_totals_ignores_presto_internal_prefix_codes():
    """Sub-totales internos (TC-, EL-, FN-) NO deben aparecer en el output."""
    pages: List[str] = [""] * 20
    pages.append(
        "Total TC-1.1.1 1,00\n"
        "Total EL-1.8 1,00\n"
        "Total FN-2.3 5,00\n"
        "Total 01.01 100,00 0,00\n"
    )
    totals = extract_totals_from_annexed_pages(pages, start_page=21)
    assert totals == {"01.01": 100.0}
    assert "TC-1.1.1" not in totals
    assert "EL-1.8" not in totals


def test_extract_totals_sums_duplicates():
    """Si un código aparece en múltiples líneas, las cantidades se suman."""
    pages: List[str] = [""] * 5
    pages.append(
        "Total 01.01 100,00 0,00\n"
        "Total 01.01 50,00 0,00\n"   # mismo code de nuevo
    )
    totals = extract_totals_from_annexed_pages(pages, start_page=6)
    assert totals == {"01.01": 150.0}


def test_extract_totals_with_c_prefix_sanitas():
    """Códigos con prefijo C (SANITAS) preservan el prefijo."""
    pages: List[str] = [""] * 21
    pages.append(
        "Total C01.01 236,50 0,00 0,00\n"
        "Total C01.02 37,50 0,00 0,00\n"
        "Total C01.08 13,72 0,00 0,00\n"
    )
    totals = extract_totals_from_annexed_pages(pages, start_page=22)
    assert totals == {
        "C01.01": 236.5,
        "C01.02": 37.5,
        "C01.08": 13.72,
    }


def test_extract_totals_empty_pages_returns_empty_dict():
    """Páginas sin totales → dict vacío."""
    pages: List[str] = ["descripción simple"] * 10
    totals = extract_totals_from_annexed_pages(pages, start_page=1)
    assert totals == {}


def test_extract_totals_start_page_out_of_range_returns_empty():
    """start_page > len(pages) no crashea."""
    pages = ["abc"]
    totals = extract_totals_from_annexed_pages(pages, start_page=100)
    assert totals == {}


def test_extract_totals_handles_multiline_text():
    """Pages con varias líneas (cada una con su propio total) — todas se procesan."""
    pages: List[str] = [""] * 5
    long_text = "\n".join(f"Total 01.{i:02d} {i*10},00 0,00" for i in range(1, 11))
    pages.append(long_text)
    totals = extract_totals_from_annexed_pages(pages, start_page=6)
    assert len(totals) == 10
    assert totals["01.05"] == 50.0


def test_extract_totals_skips_invalid_quantities_silently():
    """Si una línea tiene formato roto pero alguna válida, se procesa la válida.

    Ejemplo: matchea regex pero parse_spanish_number falla → skip.
    """
    pages: List[str] = [""] * 5
    pages.append(
        "Total 01.01 220,88 0,00\n"
        "Total 01.02 100,00 0,00\n"
    )
    totals = extract_totals_from_annexed_pages(pages, start_page=6)
    assert totals == {"01.01": 220.88, "01.02": 100.0}

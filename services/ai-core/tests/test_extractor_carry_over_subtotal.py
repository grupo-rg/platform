"""Fase 13.A — Tests del guard contra carry-over de subtotales cross-page.

Bug observado en run-3 del eval (2026-04-27):
  - PDF Presto/CIFRE: el subtotal acumulado de la partida N (ej. 72,80 m de
    viguetas) se repite en la cabecera de la página siguiente como cabecera
    cross-page antes de la partida N+1.
  - Sin guard, ese 72,80 se acumula como `quantity` de la partida N+1 (que
    debería ser 1,00) → total inflado ×72,8.

Fix: heurística determinista en `extract_descriptions_and_quantities`. Si la
PRIMERA línea de quantity de un bloque coincide con el subtotal acumulado de
la partida anterior (±0.01), descartarla.

Las líneas que el regex `QUANTITY_ROW` matchea son SOLO números aislados
(tras strip). Los formatos como '1   1,00' o '18 2,00 36,00' van a description.
Por convención Presto/CIFRE, el subtotal cierra con una línea aislada
(p.ej. `                              72,80`) que sí matchea.
"""

from __future__ import annotations

from src.budget.layout_analyzer.analyzer import extract_descriptions_and_quantities
from src.budget.layout_analyzer.domain import PartidaCandidate


def _make_candidate(code: str, page: int, title: str = "Partida x", unit: str = "Ud") -> PartidaCandidate:
    return PartidaCandidate(
        code=code,
        title=title,
        unit=unit,
        page=page,
        method="regex_inline",
    )


# -------- Test 1 — descartar carry-over -------------------------------------


def test_layout_analyzer_skips_carry_over_subtotal_at_block_start() -> None:
    """01.05 acumula 72,80 m. 01.06 (en página siguiente) tiene un 72,80
    huérfano DENTRO de su bloque (carry-over Presto en la cabecera tabular
    de la página) seguido de la quantity real 1,00. El guard debe descartar
    el carry-over.
    """
    page_text = (
        "01.05 ml Reparación de vigueta\n"
        "Forjado techo Pl 5  18 2,00 36,00\n"
        "Voladizo            7  1,00  7,00\n"
        # subtotal aislado de 01.05 (matchea QUANTITY_ROW al strip)
        "                                  72,80\n"
        "01.06 Ud Demolición de falso techo\n"
        "Demolición de falso techo en caja de escalera. Superficie 9 m2.\n"
        # carry-over Presto en página siguiente (pre-01.06 visualmente, pero
        # post-01.06 en algunas extracciones de pdfplumber)
        "                                  72,80\n"
        # quantity real de 01.06
        "                                   1,00\n"
    )
    candidates = [
        _make_candidate("01.05", page=1, title="Reparación de vigueta", unit="ml"),
        _make_candidate("01.06", page=1, title="Demolición de falso techo", unit="Ud"),
    ]
    enriched = extract_descriptions_and_quantities(candidates, [page_text])
    by_code = {c.code: c for c in enriched}

    # 01.05 acumula su subtotal aislado.
    assert by_code["01.05"].quantity == 72.8
    # 01.06 debe descartar el carry-over 72,80 y reportar SOLO 1,00.
    assert by_code["01.06"].quantity == 1.0


# -------- Test 2 — comportamiento normal preservado --------------------------


def test_layout_analyzer_keeps_real_quantity_when_not_carry_over() -> None:
    """Bloque limpio sin carry-over: la cantidad legítima 1,00 se preserva."""
    page_text = (
        "01.10 u Reparación de tabique\n"
        "Reparación de paramento vertical interior\n"
        "                                   1,00\n"
    )
    candidates = [_make_candidate("01.10", page=1, title="Reparación de tabique", unit="Ud")]
    enriched = extract_descriptions_and_quantities(candidates, [page_text])
    assert enriched[0].quantity == 1.0


# -------- Test 3 — carry-over + parciales legítimos posteriores --------------


def test_layout_analyzer_handles_carry_over_with_legitimate_quantities_after() -> None:
    """01.05 acumula 26,00. 01.06 tiene un 26,00 carry-over al inicio de su
    bloque + 6,00 + 20,00 después. Debe descartar el carry-over y sumar:
    6 + 20 = 26 (NO 26 + 6 + 20 = 52).
    """
    page_text = (
        "01.05 ml Reparación de vigueta\n"
        "Forjado techo Pl 5  3  2,00  6,00\n"
        "Voladizo            5  4,00  20,00\n"
        "                                  26,00\n"
        "01.06 Ud Demolición de falso techo\n"
        # carry-over Presto
        "                                  26,00\n"
        "Demolición de falso techo en caja de escalera.\n"
        # parciales legítimas, una por línea (Presto las imprime así al
        # finalizar el bloque tabular)
        "                                   6,00\n"
        "                                  20,00\n"
    )
    candidates = [
        _make_candidate("01.05", page=1, title="Reparación de vigueta", unit="ml"),
        _make_candidate("01.06", page=1, title="Demolición de falso techo", unit="Ud"),
    ]
    enriched = extract_descriptions_and_quantities(candidates, [page_text])
    by_code = {c.code: c for c in enriched}
    assert by_code["01.05"].quantity == 26.0
    # Sin guard sería: 26 (carry) + 6 + 20 = 52. Con guard: 6 + 20 = 26.
    assert by_code["01.06"].quantity == 26.0

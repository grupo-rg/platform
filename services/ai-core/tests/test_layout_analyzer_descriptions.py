"""Fase 9.2.A — el LayoutAnalyzer extrae descripción y cantidad por partida.

El spike 9.S extraía solo code/title/unit. Para que el extractor de producción
pueda usar las partidas heurísticas como `RestructuredItem` directamente
(saltando el LLM), necesitamos también:
- description: texto descriptivo entre el título y la siguiente partida.
- quantity: total numérico al final de la descripción (filas "1,00 Ud").
"""
from __future__ import annotations

from src.budget.layout_analyzer.analyzer import (
    extract_descriptions_and_quantities,
)
from src.budget.layout_analyzer.domain import PartidaCandidate


def _candidate(code: str, title: str, unit: str = "m2", page: int = 1) -> PartidaCandidate:
    return PartidaCandidate(
        code=code, title=title, unit=unit, page=page, method="regex_inline",
    )


def test_extracts_description_between_title_and_next_partida():
    """SANITAS-style: descripción inline justo debajo del título."""
    text_per_page = [
        "C01 Capítulo TRABAJOS PREVIOS\n"
        "C01.01 Partida m2 DEMOLICIÓN DE FALSO TECHO\n"
        "Demolición de falso techo continuo o de placas registrables, vigas de\n"
        "decoración, dobles falsos techos existentes y su correspondiente\n"
        "estructura y aislamiento, dejando limpia la superfície de soporte.\n"
        "1,0\n"
        "2,5\n"
        "C01.02 Partida m2 DESMONTADO DE TABIQUERÍA\n"
        "Desmontado de tabiquería de pladur de 100 mm.\n"
        "1,0\n"
    ]
    candidates = [
        _candidate("C01.01", "DEMOLICIÓN DE FALSO TECHO", "m2", 1),
        _candidate("C01.02", "DESMONTADO DE TABIQUERÍA", "m2", 1),
    ]
    enriched = extract_descriptions_and_quantities(candidates, text_per_page)
    assert len(enriched) == 2

    desc1 = enriched[0].description or ""
    assert "Demolición de falso techo continuo" in desc1
    assert "limpia la superfície" in desc1
    # No debe colarse texto de C01.02
    assert "tabiquería" not in desc1.lower()


def test_quantity_aggregated_when_multiple_rows():
    """Cantidades múltiples al final se suman (ej. mediciones por habitación)."""
    text_per_page = [
        "C01.01 Partida m2 DEMOLICIÓN\n"
        "Demolición de muro existente.\n"
        "1,0\n"
        "2,5\n"
        "0,5\n"
        "C01.02 Partida m2 OTRA\n"
    ]
    candidates = [_candidate("C01.01", "DEMOLICIÓN", "m2", 1)]
    enriched = extract_descriptions_and_quantities(candidates, text_per_page)
    assert enriched[0].quantity == 4.0


def test_quantity_with_explicit_unit_row():
    """MU02-style: cantidad con unidad explícita ('1,00 Ud')."""
    text_per_page = [
        "1.1 Ud Acondicionamiento del solar.\n"
        "Limpiar superficie, meter grava, compactar.\n"
        "1,00 Ud\n"
        "1.2 M Vallado provisional.\n"
    ]
    candidates = [_candidate("1.1", "Acondicionamiento del solar.", "Ud", 1)]
    enriched = extract_descriptions_and_quantities(candidates, text_per_page)
    assert enriched[0].quantity == 1.0


def test_partida_at_end_of_page_has_short_description():
    """Si la partida está al final de la página y la siguiente NO empieza con
    código → description quedará corta, indicador de cross-page candidate."""
    text_per_page = [
        "C01.01 Partida m2 DEMOLICIÓN ANTERIOR\nDemolición previa completa con detalles técnicos.\n1,0\n"
        "C01.05 Partida m2 DEMOLICIÓN DE MAMPARAS\n",  # ← solo título, sin descripción
        "Demolición de mamparas de vidrio, madera o metálicas con sus estructuras...",
    ]
    candidates = [
        _candidate("C01.01", "DEMOLICIÓN ANTERIOR", "m2", 1),
        _candidate("C01.05", "DEMOLICIÓN DE MAMPARAS", "m2", 1),
    ]
    enriched = extract_descriptions_and_quantities(candidates, text_per_page)
    by_code = {p.code: p for p in enriched}
    # C01.05 should have empty/short description (cross-page candidate territory)
    assert (by_code["C01.05"].description or "") == "" or len(by_code["C01.05"].description or "") < 40


def test_no_partidas_returns_empty_list_safely():
    enriched = extract_descriptions_and_quantities([], ["empty page"])
    assert enriched == []

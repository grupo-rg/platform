"""Fase 9 spike — tests del clasificador de layout.

Usa texto sintético por página (sin tocar PDFs) para validar la decisión.
"""
from __future__ import annotations

from src.budget.layout_analyzer.classifier import classify


def test_unknown_when_text_is_essentially_empty():
    result = classify(["", "  ", ""])
    assert result.type == "UNKNOWN"
    assert result.confidence == 1.0


def test_unknown_when_few_partidas():
    result = classify(["Lorem ipsum dolor sit amet " * 30])
    assert result.type == "UNKNOWN"


def test_inline_classification_for_sanitas_like_pages():
    pages = [
        # Página 1: cabecera + capítulo + 5 partidas con descripción
        "REFORMA DENTAL\nCódigo Nat Ud Resumen Comentario N\n"
        "C01 Capítulo TRABAJOS PREVIOS\n"
        "C01.01 Partida m2 DEMOLICIÓN DE FALSO TECHO\n"
        "Demolición de falso techo continuo, dejando limpia la superficie.\n"
        "C01.02 Partida m2 DESMONTADO DE TABIQUERÍA\n"
        "Desmontado de tabiquería de pladur o similar.\n"
        "C01.03 Partida m3 DESMONTADO DE AMUEBLAMIENTO\n"
        "Desmontado de mobiliario fijo y/o suelto.\n"
        "C01.04 Partida m2 DESMONTADO DE PLACAS DE TERRAZO\n"
        "Picado y desmontado de placas con martillo eléctrico.\n"
        "C01.05 Partida m2 DEMOLICIÓN DE MAMPARAS\n"
        "Demolición de mamparas de vidrio.\n",
        # Página 2: sigue con partidas
        "C02.01 Partida m3 ALBAÑILERÍA EN MUROS\n"
        "Ejecución de muros de albañilería con bloques de hormigón.\n"
        "C02.02 Partida m2 TABIQUE PLADUR\n"
        "Tabique de pladur con doble placa.\n",
    ]
    result = classify(pages)
    assert result.type == "INLINE_WITH_TITLES"
    assert result.confidence >= 0.8
    assert any("partidas detectadas" in e for e in result.evidence)


def test_two_phase_annexed_when_descriptions_front_sumatorios_back():
    """Front pages con descripciones, back pages con quantity rows aisladas."""
    front_partida_block = (
        "C01.01 Partida m2 DEMOLICIÓN\n"
        "Demolición de muro existente con martillo eléctrico.\n"
    )
    pages = (
        # 6 páginas con muchas partidas (front)
        [front_partida_block * 5] * 6
        # 6 páginas con SOLO quantity rows (back)
        + ["1,0\n2,5\n10,8\n5,4\n3,2\n8,7\n12,1\n4,6\n7,9\n6,3 m2\n"] * 6
    )
    result = classify(pages)
    assert result.type == "TWO_PHASE_ANNEXED"
    assert result.confidence >= 0.7


def test_inline_classification_for_mu02_like_pages():
    """Códigos numéricos sin C-prefix (MU02 style)."""
    page = (
        "MU02-Pol\n"
        "1 ACTUACIONES PREVIAS\n"
        "Nº Ud Descripción Cantidad Precio Total\n"
        "1.1 Ud Acondicionamiento del solar para camiones.\n"
        "Incluye limpieza, grava 10cm, compactado.\n"
        "1,00 Ud\n"
        "1.2 M Vallado provisional con vallas de 3,50 metros.\n"
        "1,00 M\n"
        "1.3 Ud Cartel de obra reglamentario.\n"
        "1,00 Ud\n"
    )
    result = classify([page])
    assert result.type == "INLINE_WITH_TITLES"

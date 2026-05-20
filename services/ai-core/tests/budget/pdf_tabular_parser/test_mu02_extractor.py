"""Tests para mu02_extractor — Sprint 4 Fase E.

Tests sintéticos (hardcoded strings) que verifican:
- E3a: extracción simple de partida con total inline directo.
- E3b: extracción de partida con tabla de mediciones zonales (usa el último total).
- E3c: anti-falso-positivo cuando hay decimales sueltos con unidad distinta.
- E3d: detección de capítulos como contexto de cada partida.
- E3e: descripción acumulada de bloque (multilinea).
"""
from __future__ import annotations

from src.budget.pdf_tabular_parser.application.mu02_extractor import (
    extract_mu02_partidas,
)


def test_simple_partida_inline_total():
    text = """1 ACTUACIONES PREVIAS
Nº Ud Descripción Cantidad Precio Total
1.1 Ud Acondicionamiento de la entrada del solar.
Incluye:
- Limpiar superficie
1,00 Ud
"""
    partidas = extract_mu02_partidas([text])
    assert len(partidas) == 1
    assert partidas[0].code == "1.1"
    assert partidas[0].unit == "Ud"
    assert partidas[0].quantity == 1.0
    assert partidas[0].chapter == "1 ACTUACIONES PREVIAS"


def test_partida_with_measurement_table_uses_last_inline_total():
    """Partida con tabla de mediciones: la qty asignada es el último total
    inline (NO los decimales individuales de medición ni el subtotal duplicado).
    """
    text = """2 ACONDICIONAMIENTO DEL TERRENO
Nº Ud Descripción Cantidad Precio Total
2.1 M² Desbroce y limpieza del terreno.
Comprende los trabajos necesarios...
Area Largo Ancho Alto Parcial Subtotal
VIVIENDA [A] 117,9 117,90
CASETA [A] 19,4 19,40
720,00 720,00
720,00 m²
"""
    partidas = extract_mu02_partidas([text])
    assert len(partidas) == 1
    assert partidas[0].code == "2.1"
    assert partidas[0].quantity == 720.0  # NO 117.9 ni 19.4 ni subtotal duplicado
    assert partidas[0].unit == "M²"


def test_unit_mismatch_in_total_is_ignored():
    """Partida con unit=Ud pero el bloque tiene '10,00 m' (otra cosa).
    Solo se acepta como total final si la unidad coincide (case-insensitive)."""
    text = """1 ACTUACIONES PREVIAS
Nº Ud Descripción Cantidad Precio Total
1.2 Ud Algo simple
Texto: largo total 10,00 m
1,00 Ud
"""
    partidas = extract_mu02_partidas([text])
    assert len(partidas) == 1
    assert partidas[0].quantity == 1.0


def test_multiple_partidas_in_same_page():
    """Varias partidas en la misma página: cada una con su total."""
    text = """1 ACTUACIONES PREVIAS
Nº Ud Descripción Cantidad Precio Total
1.1 Ud Primera partida
1,00 Ud
1.2 M Segunda partida
10,00 m
1.3 Ud Tercera partida
2,00 Ud
"""
    partidas = extract_mu02_partidas([text])
    assert len(partidas) == 3
    assert partidas[0].code == "1.1" and partidas[0].quantity == 1.0
    assert partidas[1].code == "1.2" and partidas[1].quantity == 10.0
    assert partidas[2].code == "1.3" and partidas[2].quantity == 2.0


def test_chapter_change_in_middle_of_page():
    """Cambio de capítulo dentro de la misma página: las partidas
    posteriores usan el nuevo capítulo."""
    text = """1 ACTUACIONES PREVIAS
Nº Ud Descripción Cantidad Precio Total
1.1 Ud Primera
1,00 Ud
2 ACONDICIONAMIENTO DEL TERRENO
Nº Ud Descripción Cantidad Precio Total
2.1 M² Segunda
100,00 m²
"""
    partidas = extract_mu02_partidas([text])
    assert len(partidas) == 2
    assert partidas[0].chapter == "1 ACTUACIONES PREVIAS"
    assert partidas[1].chapter == "2 ACONDICIONAMIENTO DEL TERRENO"


def test_partidas_across_pages_preserve_chapter():
    """El capítulo persiste entre páginas (hierarchy is sticky)."""
    page1 = """2 ACONDICIONAMIENTO DEL TERRENO
Nº Ud Descripción Cantidad Precio Total
2.1 M² Desbroce
720,00 m²
"""
    page2 = """MU02-
Pol.11-Parc.213
Nº Ud Descripción Cantidad Precio Total
2.2 M³ Excavación
445,08 m³
"""
    partidas = extract_mu02_partidas([page1, page2])
    assert len(partidas) == 2
    assert partidas[0].chapter == "2 ACONDICIONAMIENTO DEL TERRENO"
    # En page2 no aparece capítulo, pero debe seguir siendo el mismo:
    assert partidas[1].chapter == "2 ACONDICIONAMIENTO DEL TERRENO"
    assert partidas[1].quantity == 445.08


def test_skips_table_header_band():
    """La cabecera tabular se repite en cada página y debe ser ignorada
    completamente — no debe contar como fila, ni siquiera de descripción."""
    text = """1 ACTUACIONES PREVIAS
Nº Ud Descripción Cantidad Precio Total
1.1 Ud Algo
1,00 Ud
"""
    partidas = extract_mu02_partidas([text])
    assert len(partidas) == 1
    # La descripción no contiene la cabecera tabular.
    assert "Cantidad Precio Total" not in (partidas[0].description or "")


def test_last_partida_finalized_at_end():
    """La última partida del PDF también debe finalizar (no se pierde)."""
    text = """15 VARIOS
Nº Ud Descripción Cantidad Precio Total
15.1 H Oficial 1ª estructurista.
10,00 h
15.2 H Peón ordinario.
10,00 h
"""
    partidas = extract_mu02_partidas([text])
    assert len(partidas) == 2
    assert partidas[1].code == "15.2"
    assert partidas[1].quantity == 10.0


def test_partida_without_total_has_none_quantity():
    """Si una partida no tiene total inline al cerrarla, quantity=None."""
    text = """1 ACTUACIONES PREVIAS
Nº Ud Descripción Cantidad Precio Total
1.1 Ud Partida sin total
Descripción sin línea de total final
1.2 Ud Otra partida
1,00 Ud
"""
    partidas = extract_mu02_partidas([text])
    assert len(partidas) == 2
    assert partidas[0].quantity is None
    assert partidas[1].quantity == 1.0


def test_subtotal_duplicado_is_not_taken_as_total():
    """720,00 720,00 (subtotal duplicado) NO debe asignarse como total."""
    text = """2 ACONDICIONAMIENTO DEL TERRENO
Nº Ud Descripción Cantidad Precio Total
2.1 M² Algo
Area Largo Ancho Alto Parcial Subtotal
VIVIENDA [A] 117,9 117,90
720,00 720,00
720,00 m²
"""
    partidas = extract_mu02_partidas([text])
    assert partidas[0].quantity == 720.0  # solo el total con unidad
    assert partidas[0].quantity != 117.9
    assert partidas[0].quantity != 117.90


def test_chapter_alone_does_not_create_partida():
    """'1 ACTUACIONES PREVIAS' por sí solo es capítulo, no partida."""
    text = """1 ACTUACIONES PREVIAS
Nº Ud Descripción Cantidad Precio Total
"""
    partidas = extract_mu02_partidas([text])
    assert len(partidas) == 0


def test_empty_input_returns_empty_list():
    """Lista vacía o páginas vacías → lista vacía."""
    assert extract_mu02_partidas([]) == []
    assert extract_mu02_partidas([""]) == []
    assert extract_mu02_partidas(["", "", ""]) == []


def test_pol_parc_line_is_ignored():
    """'Pol.11-Parc.213' aparece como header docs en cada página, no debe
    interferir con detección de partidas."""
    text = """MU02-
Pol.11-Parc.213
1 ACTUACIONES PREVIAS
Nº Ud Descripción Cantidad Precio Total
1.1 Ud Algo
1,00 Ud
"""
    partidas = extract_mu02_partidas([text])
    assert len(partidas) == 1
    assert partidas[0].code == "1.1"


def test_unit_normalization_m2_matches_m_superscript():
    """Si la cabecera usa 'M²' (mayúscula) y total usa 'm²' (minúscula),
    deben considerarse equivalentes."""
    text = """1 PRUEBAS
Nº Ud Descripción Cantidad Precio Total
1.1 M² Partida con M²
50,00 m²
"""
    partidas = extract_mu02_partidas([text])
    assert len(partidas) == 1
    assert partidas[0].quantity == 50.0

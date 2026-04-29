"""Fase 9 spike — tests de los regex/heurísticas del LayoutAnalyzer.

Calibrados sobre fragments reales sacados del extract_text() de los goldens.
"""
from __future__ import annotations

from src.budget.layout_analyzer.patterns import (
    PARTIDA_MU02,
    PARTIDA_SANITAS,
    QUANTITY_ROW,
    find_chapters_in_text,
    find_partidas_in_text,
    looks_like_work_description,
)


# ---- Pattern SANITAS (C-prefix) ---------------------------------------------


SANITAS_SAMPLE = """\
REFORMA DE LOCAL DESTINADO A CLINICA DENTAL
SITO EN C. BARÓ DE PINOPAR, 9 - 07012 - PALMA DE MALLORCA
Presupuesto
Código Nat Ud Resumen Comentario N
C01 Capítulo TRABAJOS PREVIOS, DERRIBOS Y EXTRACCIONES
C01.01 Partida m2 DEMOLICIÓN DE FALSO TECHO EXISTENTE
Demolición de falso techo continuo o de placas
registrables, vigas de decoración, dobles falsos techos.
1,0
1,0
2,0
C01.05 Partida m2 DEMOLICIÓN DE MAMPARAS
"""


def test_pattern_sanitas_matches_three_partidas():
    """SANITAS ejemplo: solo C01.01 y C01.05 son partidas (C01 es capítulo)."""
    matches = list(PARTIDA_SANITAS.finditer(SANITAS_SAMPLE))
    codes = [m.group("code") for m in matches]
    assert codes == ["C01.01", "C01.05"]


def test_pattern_sanitas_extracts_unit_and_title():
    matches = list(PARTIDA_SANITAS.finditer(SANITAS_SAMPLE))
    first = matches[0]
    assert first.group("unit") == "m2"
    assert first.group("title").startswith("DEMOLICIÓN DE FALSO TECHO")
    assert first.group("type").lower() == "partida"


# ---- Pattern MU02 (numeric, no C-prefix) ------------------------------------


MU02_SAMPLE = """\
MU02-Pol.11-Parc.213
1 ACTUACIONES PREVIAS
Nº Ud Descripción Cantidad Precio Total
1.1 Ud Acondicioanmiento de la entrada del solar para camiones.
Incluye:
- Limpiar superficie
- Meter 10cm de grava, 40-60mm, 50m2
1,00 Ud
1.2 M Vallado provisional de solar compuesto por vallas trasladables.
"""


def test_pattern_mu02_matches_numeric_codes():
    matches = list(PARTIDA_MU02.finditer(MU02_SAMPLE))
    codes = [m.group("code") for m in matches]
    assert "1.1" in codes
    assert "1.2" in codes


def test_pattern_mu02_extracts_unit_M_for_meters():
    """MU02 usa "M" mayúscula para metros lineales."""
    matches = list(PARTIDA_MU02.finditer(MU02_SAMPLE))
    by_code = {m.group("code"): m for m in matches}
    assert by_code["1.2"].group("unit") == "M"


def test_pattern_mu02_does_not_match_chapter_header():
    """'1 ACTUACIONES PREVIAS' es capítulo (sin punto en el código)."""
    matches = list(PARTIDA_MU02.finditer("1 ACTUACIONES PREVIAS\n"))
    assert matches == []


# Fase 13.A — unidades de un solo carácter en minúscula (Presto/CIFRE original).


def test_pattern_mu02_accepts_lowercase_u_for_unidades():
    """01.06 u Demolición de falso techo — `u` lowercase debe ser unidad válida."""
    sample = "01.06 u Demolición de falso techo en caja de escalera.\n"
    matches = list(PARTIDA_MU02.finditer(sample))
    assert len(matches) == 1
    assert matches[0].group("code") == "01.06"
    assert matches[0].group("unit") == "u"


def test_pattern_mu02_accepts_lowercase_m_for_metros():
    """01.05 m Reparación de vigueta — `m` lowercase debe ser unidad válida."""
    sample = "01.05 m Reparación de vigueta o jácena\n"
    matches = list(PARTIDA_MU02.finditer(sample))
    assert len(matches) == 1
    assert matches[0].group("code") == "01.05"
    assert matches[0].group("unit") == "m"


def test_pattern_mu02_still_matches_long_units_correctly():
    """Regresión: añadir `m`/`u` standalone no debe eclipsar `m2`/`m3`/`ml`/`Ud`."""
    sample = (
        "1.1 m2 Partida en metros cuadrados\n"
        "1.2 m3 Partida en metros cúbicos\n"
        "1.3 ml Partida en metros lineales\n"
        "1.4 Ud Partida en unidades\n"
    )
    matches = list(PARTIDA_MU02.finditer(sample))
    units = [m.group("unit") for m in matches]
    assert units == ["m2", "m3", "ml", "Ud"]


def test_pattern_mu02_supports_aparejador_variants():
    """Variantes que distintos aparejadores españoles usan en sus presupuestos.
    El regex acepta todas; `Unit.normalize()` aguas abajo canonicaliza.
    """
    sample = (
        "1.01 m² Superficie con Unicode\n"
        "1.02 M² Superficie en mayúscula\n"
        "1.03 m³ Volumen con Unicode\n"
        "1.04 M2 ASCII en mayúscula\n"
        "1.05 ML Lineales en mayúscula\n"
        "1.06 KG Masa en mayúscula\n"
        "1.07 Kg Masa capitalizada\n"
        "1.08 kgs Masa con plural\n"
        "1.09 Tn Toneladas\n"
        "1.10 tn Toneladas minúscula\n"
        "1.11 UD Unidades en mayúscula\n"
        "1.12 ud Unidades minúscula\n"
        "1.13 uds Unidades plural\n"
        "1.14 hr Horas variante\n"
        "1.15 hrs Horas plural\n"
        "1.16 PA Partida alzada\n"
        "1.17 Pa Partida alzada cap\n"
        "1.18 pa Partida alzada minúscula\n"
        "1.19 % Porcentaje costes indirectos\n"
        "1.20 T Toneladas standalone\n"
    )
    matches = list(PARTIDA_MU02.finditer(sample))
    units = [m.group("unit") for m in matches]
    expected = [
        "m²", "M²", "m³", "M2", "ML", "KG", "Kg", "kgs",
        "Tn", "tn", "UD", "ud", "uds", "hr", "hrs",
        "PA", "Pa", "pa", "%", "T",
    ]
    assert units == expected


# ---- Quantity row -----------------------------------------------------------


def test_quantity_row_extracts_value_and_unit():
    matches = list(QUANTITY_ROW.finditer("\n1,00 Ud\n"))
    assert len(matches) == 1
    assert matches[0].group("qty") == "1,00"
    assert matches[0].group("unit") == "Ud"


def test_quantity_row_does_not_match_inside_text():
    """No debe matchear cantidades dentro de una frase descriptiva."""
    text = "Meter 10cm de grava, 40-60mm, 50m2"
    matches = list(QUANTITY_ROW.finditer(text))
    assert matches == []


# ---- Chapters ---------------------------------------------------------------


def test_chapters_detected_with_C_prefix():
    chapters = list(find_chapters_in_text(SANITAS_SAMPLE))
    codes = [m.group("code") for m in chapters]
    names = [m.group("name").strip() for m in chapters]
    assert "C01" in codes
    assert "TRABAJOS PREVIOS" in names[0]


def test_chapters_detected_numeric_uppercase_only():
    chapters = list(find_chapters_in_text(MU02_SAMPLE))
    codes = [m.group("code") for m in chapters]
    assert "1" in codes


# ---- Work description heuristic --------------------------------------------


def test_work_description_recognizes_verb_starts():
    assert looks_like_work_description(
        "Suministro y colocación de solado de gres porcelánico CIFRE."
    )
    assert looks_like_work_description(
        "Demolición de mamparas de vidrio, madera o metálicas con sus estructuras."
    )
    assert looks_like_work_description(
        "Instalación de equipos sanitarios y grifería de baño."
    )


def test_work_description_rejects_short_or_unrelated():
    assert not looks_like_work_description("1,0")
    assert not looks_like_work_description("Página 5 de 42")
    assert not looks_like_work_description("Total parcial: 1.234,00 €")
    # Línea corta aunque empiece con verbo: descartada por longitud.
    assert not looks_like_work_description("Demolición.")


# ---- Combined dispatcher ----------------------------------------------------


def test_find_partidas_dispatcher_returns_method_label():
    hits = find_partidas_in_text(SANITAS_SAMPLE)
    assert all(label == "regex_inline" for _, label in hits)
    codes = [m.group("code") for m, _ in hits]
    assert "C01.01" in codes

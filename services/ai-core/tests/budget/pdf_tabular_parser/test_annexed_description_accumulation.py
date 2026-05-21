"""Sprint 4 Fase D fix — acumulación de descripción multilínea en modo ANNEXED.

Verifica el bug que hacía que las partidas extraídas en modo ANNEXED quedaran
con `description` igual al `title` corto de la cabecera (ej. "REPLANTEO", 9
chars), perdiendo el bloque técnico largo que viene en las líneas siguientes
del PDF (la descripción real de 200-500 chars).

El fix introduce `TabularParser._build_full_annexed_description(title, lines)`
+ refactor de `_parse_annexed` para acumular líneas no-cabecera/no-jerarquía
entre cabeceras consecutivas y "cerrarlas" en flush.
"""
from __future__ import annotations

import pytest

from src.budget.pdf_tabular_parser.application.tabular_parser import TabularParser


# --- _build_full_annexed_description unit tests --------------------------

class TestBuildFullAnnexedDescription:
    def test_empty_lines_returns_title(self):
        result = TabularParser._build_full_annexed_description("REPLANTEO", [])
        assert result == "REPLANTEO"

    def test_only_metadata_lines_returns_title(self):
        # Identificadores cortos del aparejador: "SPC0010" o "SPC0010 zona".
        lines = ["SPC0010", "SPC0010 Solar", "SPC0010 Replanteo"]
        result = TabularParser._build_full_annexed_description("REPLANTEO", lines)
        assert result == "REPLANTEO"

    def test_title_repeated_is_deduped(self):
        """Caso RdLL: el title aparece como primera línea del bloque."""
        lines = [
            "REPLANTEO",
            "Replanteo de la cimentación de las viviendas.",
        ]
        result = TabularParser._build_full_annexed_description("REPLANTEO", lines)
        # NO debe empezar con "REPLANTEO REPLANTEO Replanteo..."
        assert result.upper().startswith("REPLANTEO")
        assert result.count("REPLANTEO") == 1
        assert "Replanteo de la cimentación" in result

    def test_title_not_repeated_is_prepended(self):
        """Si el bloque NO empieza con el title, se prepondera para no perderlo."""
        lines = [
            "Aplicación manual de dos manos de pintura plástica color blanco.",
        ]
        result = TabularParser._build_full_annexed_description(
            "Pintura plástica color blanco mate", lines,
        )
        assert result.startswith("Pintura plástica color blanco mate")
        assert "Aplicación manual" in result

    def test_metadata_identifier_lines_filtered_out(self):
        """`SPC0010 zona` se filtra; el resto se conserva."""
        lines = [
            "Replanteo de la cimentación.",
            "SPC0010 Solar",  # metadata: filtrar
            "NOTA SUVICAR: SE VALORAN 3 JORNADAS.",  # nota técnica: conservar
            "SPC0010",  # metadata aislado: filtrar
        ]
        result = TabularParser._build_full_annexed_description("REPLANTEO", lines)
        assert "Replanteo de la cimentación" in result
        assert "NOTA SUVICAR" in result
        assert "SPC0010" not in result

    def test_whitespace_is_normalized(self):
        lines = [
            "Línea  con    múltiples   espacios.",
            "Segunda línea.",
        ]
        result = TabularParser._build_full_annexed_description("T", lines)
        assert "  " not in result  # sin dobles espacios
        assert "Línea con múltiples espacios." in result
        assert "Segunda línea." in result

    def test_empty_strings_in_lines_ignored(self):
        lines = ["", "  ", "Línea válida.", "", "Otra línea."]
        result = TabularParser._build_full_annexed_description("T", lines)
        assert "Línea válida." in result
        assert "Otra línea." in result

    def test_metadata_longer_than_60_chars_NOT_filtered(self):
        """Identificadores largos NO son metadata — pueden ser texto real."""
        line = "SPC0010 esto es una línea larga que podría ser descripción real con más de 60 chars."
        result = TabularParser._build_full_annexed_description("T", [line])
        assert line in result

    def test_case_insensitive_title_dedupe(self):
        """Title en MAYUS, primera línea con la misma palabra en mixed case →
        el helper detecta dedupe case-insensitive y NO duplica el title."""
        lines = ["Replanteo de la cimentación."]
        result = TabularParser._build_full_annexed_description("REPLANTEO", lines)
        # El helper detecta que "Replanteo..." empieza con "REPLANTEO" (case-insensitive)
        # y devuelve la línea tal cual (preservando casing original), sin prepender
        # el title duplicado.
        assert result == "Replanteo de la cimentación."
        # NO duplica:
        assert "REPLANTEO Replanteo" not in result

    def test_realistic_rdll_block(self):
        """Caso real del PDF RdLL para 01.01 REPLANTEO."""
        title = "REPLANTEO"
        lines = [
            "REPLANTEO",
            "Replanteo de la cimentación de las viviendas, muros de",
            "conteción y exteirores de jardin, accesos, y todos los",
            "elementos de construcción a realizar, realizado por",
            "topógrafo. Se incluye la colocación de camillas, puntos y",
            "niveles que dictamine la DF con el objeto de hacer las",
            "comprobaciones necesarias.",
            "NOTA SUVICAR: SE VALORAN 3 JORNADAS DE",
            "REPLANTEO, A JUSTIFICAR.",
            "SPC0010 Replanteo",
        ]
        result = TabularParser._build_full_annexed_description(title, lines)
        assert len(result) > 300  # antes era 9 chars
        assert result.upper().startswith("REPLANTEO")
        assert "Replanteo de la cimentación" in result
        assert "NOTA SUVICAR" in result
        assert "SPC0010" not in result  # metadata filtrada
        # Title no duplicado.
        assert result.upper().count("REPLANTEO") <= 3  # 1 inicio + 1 en NOTA + 1 en "REPLANTEO, A JUSTIFICAR"


# --- Golden test on real RdLL PDF ----------------------------------------

import os
from pathlib import Path

_GOLDEN_DIR = Path(
    os.environ.get(
        "SPRINT4_GOLDEN_DIR",
        r"c:\Users\Usuario\Documents\github\works\dochevi\dochevi-construc\data\pdf_layouts\golden",
    )
)


@pytest.mark.golden
@pytest.mark.skipif(
    not (_GOLDEN_DIR / "presupuesto_grande_rdll.pdf").exists(),
    reason="PDF golden RdLL no disponible",
)
def test_rdll_descriptions_are_full_after_fix():
    """RdLL ANNEXED: descripciones de las primeras partidas deben ser >100 chars."""
    pdf_path = _GOLDEN_DIR / "presupuesto_grande_rdll.pdf"
    parser = TabularParser()
    result = parser.parse(pdf_path.read_bytes())

    assert result.mode == "ANNEXED"
    assert result.is_viable()
    assert len(result.partidas) >= 148

    # Primeras 10 partidas: todas deben tener desc >= 100 chars.
    long_desc_count = sum(1 for p in result.partidas[:10] if len(p.description or "") >= 100)
    assert long_desc_count >= 9, (
        f"Solo {long_desc_count}/10 primeras partidas tienen desc >=100 chars. "
        f"Probable regresión del fix."
    )

    # Caso concreto: 01.01 REPLANTEO debe contener "Replanteo de la cimentación".
    by_code = {p.code: p for p in result.partidas}
    assert "01.01" in by_code
    desc_01_01 = by_code["01.01"].description or ""
    assert len(desc_01_01) > 200, f"01.01 desc demasiado corta: {len(desc_01_01)} chars"
    assert "Replanteo de la cimentación" in desc_01_01 or "cimentación" in desc_01_01.lower()

    # SPC0010 NO debe aparecer en la descripción (metadata filtrada).
    spc_pollution = sum(
        1 for p in result.partidas
        if "SPC0010 Replanteo" in (p.description or "") or "SPC0010 Solar" in (p.description or "")
    )
    assert spc_pollution == 0, f"{spc_pollution} partidas con SPC0010 en desc (metadata no filtrada)"

"""Tests para partida_header_annexed.py — Sprint 4 Fase D.

El regex relajado debe matchear cabeceras de partida de PDFs ANNEXED
(SANITAS, RdLL) que no siguen el formato puro INLINE/TABULAR.

Casos válidos:
- "01.01 Partida UD REPLANTEO"            (RdLL — palabra "Partida")
- "01.01 UD REPLANTEO"                     (sin palabra)
- "C01.01 Partida m2 Demolición ..."       (SANITAS — prefijo C)
- "01.01 m² Excavación de zanja"           (sin prefijo, sin "Partida")
- "01.02 Partida m³ Excavación ..."
- "01.01.01 UD Subnivel partida ..."       (3 niveles)
"""
from __future__ import annotations

import pytest

from src.budget.pdf_tabular_parser.application.partida_header_annexed import (
    detect_partida_header_annexed,
)


# --- Casos POSITIVOS: el regex DEBE matchear ---

VALID_ANNEXED_HEADERS = [
    # (line, expected_code, expected_unit, expected_title_contains)
    # RdLL: con palabra "Partida"
    ("01.01 Partida UD REPLANTEO", "01.01", "UD", "REPLANTEO"),
    ("01.02 Partida m² Desbroce y limpieza del terreno", "01.02", "m²", "Desbroce"),
    ("01.02 Partida m2 Desbroce y limpieza del terreno", "01.02", "m2", "Desbroce"),
    ("01.03 Partida m3 Excavación de zanja para cimentación", "01.03", "m3", "Excavación"),
    ("01.04 partida h Mano de obra cualificada", "01.04", "h", "Mano de obra"),
    # Sin palabra "Partida"
    ("01.01 m2 Demolición de tabique cerámico", "01.01", "m2", "Demolición"),
    ("01.01.01 ud Replanteo general de obra", "01.01.01", "ud", "Replanteo"),
    ("1.2.6 m2 Eliminación de revestimiento de yeso", "1.2.6", "m2", "Eliminación"),
    # SANITAS: prefijo C
    ("C01.01 Partida m2 Demolición de tabique cerámico", "C01.01", "m2", "Demolición"),
    ("C01.02 Partida m2 Levantado de pavimento", "C01.02", "m2", "Levantado"),
    # SANITAS sin "Partida"
    ("C01.03 m2 Picado de revestimiento", "C01.03", "m2", "Picado"),
    # Diferentes unidades válidas
    ("01.01 UD Trabajos varios", "01.01", "UD", "Trabajos"),
    ("01.01 kg Acero corrugado B500S", "01.01", "kg", "Acero"),
    ("01.01 PA Partida alzada de SyS", "01.01", "PA", "Partida alzada"),
    # 4 niveles
    ("12.34.56.78 ml Excavación zanja", "12.34.56.78", "ml", "Excavación"),
]


@pytest.mark.parametrize("line,expected_code,expected_unit,title_contains", VALID_ANNEXED_HEADERS)
def test_detect_partida_header_annexed_matches_valid(line, expected_code, expected_unit, title_contains):
    """Cada línea válida debe matchear y extraer code/unit/title correctos."""
    result = detect_partida_header_annexed(line)
    assert result.is_partida, (
        f"Línea válida no detectada: {line!r}; rejection_reason={result.rejection_reason}"
    )
    assert result.code == expected_code
    assert result.unit == expected_unit
    assert title_contains.lower() in result.title.lower()


# --- Casos NEGATIVOS: el regex NO DEBE matchear ---

INVALID_ANNEXED_HEADERS = [
    "",
    "   ",
    "21",
    "01.1",                                  # subcapítulo, no partida
    "01",                                     # solo capítulo
    "25 marzo 2025 1",                        # fecha
    "Total 01.01 220,88 0,00",                # línea de total
    "TC-1.1.1 UD Trabajo interno",            # prefijo PRESTO interno
    "01.01 INVALID_UNIT Demolición",          # unit inválida
    "01.01",                                   # solo code
    "01.01 UD",                                # code+unit pero sin título
    "01.01 UD x",                              # título demasiado corto (<5 chars)
    "CAPÍTULO 01 ACTUACIONES PREVIAS",         # declaración de capítulo
    "Página 5 de 10",                         # numeración
    "SUMA capítulo 02",                       # suma
]


@pytest.mark.parametrize("line", INVALID_ANNEXED_HEADERS)
def test_detect_partida_header_annexed_rejects_invalid(line):
    """Cada línea inválida NO debe ser detectada como partida."""
    result = detect_partida_header_annexed(line)
    assert not result.is_partida, (
        f"Línea inválida detectada como partida: {line!r}; "
        f"code={result.code}, unit={result.unit}, title={result.title!r}"
    )


# --- Tests específicos: rechazo de prefijos PRESTO internos ---

PRESTO_INTERNAL_HEADERS = [
    "TC-1.1.1 UD Trabajo interno",
    "EL-1.8 UD Eléctrico interno",
    "FN-2.3 UD Fontanería",
    "PS-1.1 UD Yeso",
    "CL-3.4.5 UD Climatización",
]


@pytest.mark.parametrize("line", PRESTO_INTERNAL_HEADERS)
def test_detect_partida_header_annexed_rejects_presto_internal_codes(line):
    """Códigos con prefijo PRESTO interno no deben ser partidas."""
    result = detect_partida_header_annexed(line)
    assert not result.is_partida, (
        f"Prefijo PRESTO interno {line!r} fue detectado como partida (S3-06 regression)."
    )

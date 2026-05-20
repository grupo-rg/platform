"""Tests anti-falsos-positivos — lección S3-06.

El bug S3-06 reportó que `extract_with_pdfplumber_first` detectaba strings
como "21", "01.1", "25 marzo 2025 1" como partidas. Estos tests garantizan
que ninguno de esos strings pasa el detector de partida nuevo.
"""
from __future__ import annotations

import pytest

from src.budget.pdf_tabular_parser.application.hierarchy_tracker import (
    detect_hierarchy_in_line,
)
from src.budget.pdf_tabular_parser.application.partida_extractor import (
    detect_partida_header_from_text,
)
from src.budget.pdf_tabular_parser.domain.hierarchy import HierarchyLevel


# --- Falsos positivos críticos (lección S3-06): NO deben ser partidas ---

FALSE_POSITIVES_NOT_PARTIDA = [
    "21",                                     # código capítulo solitario
    "01.1",                                   # subcapítulo, no es partida
    "25 marzo 2025 1",                        # fecha + page number
    "0",                                       # número suelto
    "7",                                       # número suelto
    "TOTAL CAPÍTULO 02 ALBAÑILERÍA 1234,56",  # línea de total
    "SUBCAPÍTULO 04.02 Nombre del subcap",   # declaración de subcap, no partida
    "Total CAPITULO 02 1234,56",              # total sin tilde
    "Suma capítulo 02",                       # suma
    "Asciende el presupuesto a 12345 EUR",   # asciende
    "Página 5 de 10",                         # numeración
    "1 enero 2025",                           # fecha corta
    "25 diciembre 2024",                      # fecha
    "",                                        # vacío
    "   ",                                     # solo whitespace
    "1234,56",                                 # número aislado
    "Página",                                  # solo palabra page
    "CAPÍTULO 01 NOMBRE",                     # declaración explícita de capítulo
    "APARTADO 01.01.01 Nombre del apartado", # declaración de apartado
]


@pytest.mark.parametrize("text", FALSE_POSITIVES_NOT_PARTIDA)
def test_false_positives_are_not_partidas(text: str):
    """Cada uno de estos strings NO debe ser detectado como partida."""
    result = detect_partida_header_from_text(text)
    assert not result.is_partida, (
        f"Falso positivo: '{text}' fue detectado como partida "
        f"(code={result.code}, unit={result.unit}, title={result.title!r}). "
        f"Esto es exactamente el bug S3-06."
    )


# --- Verdaderos positivos: SI deben ser partidas ---

TRUE_POSITIVES_ARE_PARTIDA = [
    ("01.01 m2 Demolición de tabique cerámico de fábrica", "01.01", "m2"),
    ("1.2.6 m2 Eliminación de revestimiento de yeso (techos)", "1.2.6", "m2"),
    ("01.01.01 ud Replanteo general de obra", "01.01.01", "ud"),
    ("01.01 Partida m2 Demolición de muro", "01.01", "m2"),
    ("01.02 Partida UD Replanteo general", "01.02", "UD"),
    ("12.34.56.78 ml Excavación de zanja para cimentación", "12.34.56.78", "ml"),
    ("3.5 m3 Hormigón armado HA-25 para cimentación", "3.5", "m3"),
    ("01.01 ud Trabajos previos generales con todas sus partes", "01.01", "ud"),
    ("01.01 PA Partida alzada de seguridad y salud", "01.01", "PA"),
    ("01.01 kg Acero corrugado B500S en redondos", "01.01", "kg"),
]


@pytest.mark.parametrize("text,expected_code,expected_unit", TRUE_POSITIVES_ARE_PARTIDA)
def test_true_positives_are_partidas(text: str, expected_code: str, expected_unit: str):
    """Cada string válido debe ser detectado correctamente como partida."""
    result = detect_partida_header_from_text(text)
    assert result.is_partida, (
        f"Verdadero negativo: '{text}' NO fue detectado como partida. "
        f"Razón: {result.rejection_reason}"
    )
    assert result.code == expected_code
    assert result.unit == expected_unit


# --- Falsos positivos en hierarchy_tracker: declaraciones que NO son partidas ---

CHAPTER_HEADINGS = [
    ("CAPÍTULO 01 ACTUACIONES PREVIAS", HierarchyLevel.CAPITULO),
    ("CAPÍTULO 21 PATOLOGÍAS GRAVES", HierarchyLevel.CAPITULO),
    ("SUBCAPÍTULO 01.01 Nombre del subcapitulo", HierarchyLevel.SUBCAPITULO),
    ("APARTADO 01.01.01 Replanteo general", HierarchyLevel.APARTADO),
    ("Capítulo 02 NOMBRE EN MAYUSCULAS", HierarchyLevel.CAPITULO),
]


@pytest.mark.parametrize("text,expected_level", CHAPTER_HEADINGS)
def test_chapter_headings_are_detected(text: str, expected_level: HierarchyLevel):
    """Cada declaración de capítulo/subcap/apartado se detecta correctamente."""
    result = detect_hierarchy_in_line(text)
    assert result.level == expected_level, (
        f"'{text}' debería ser {expected_level.name}, fue {result.level}"
    )


NOT_CHAPTER_HEADINGS = [
    "01.01 m2 Demolición de tabique",      # es partida, no capítulo
    "TOTAL CAPÍTULO 02 ALBAÑILERÍA 1234",  # es línea de total
    "Página 5",
    "1234,56",
    "25 marzo 2025 1",                       # fecha
    "",
]


@pytest.mark.parametrize("text", NOT_CHAPTER_HEADINGS)
def test_non_chapter_lines_are_not_detected(text: str):
    """Strings que NO son chapter heading no se detectan como tal."""
    result = detect_hierarchy_in_line(text)
    assert result.level is None, (
        f"'{text}' NO debería ser detectado como heading, fue {result.level}"
    )

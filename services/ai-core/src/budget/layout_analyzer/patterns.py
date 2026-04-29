"""Regex y heurísticas determinísticas para detección de partidas y capítulos.

Calibradas empíricamente sobre los 3 goldens disponibles:
- MU02 (`1.1 Ud TITULO`)
- SANITAS DENTAL (`C01.01 Partida m2 TITULO`)
- NL Reforma Baño (texto plano, sin estructura tabular).
"""
from __future__ import annotations

import re
from typing import Iterator, List, Optional, Tuple

# Unidades canonical que aparecen en presupuestos españoles. Cada aparejador
# usa su propia abreviatura — esta lista cubre las variantes más frecuentes
# observadas en los PDFs reales (Presto, CIFRE, MUSAAT, propias). El downstream
# `Unit.normalize()` ([catalog/domain/unit.py]) canonicaliza al unicode
# correspondiente.
#
# Reglas de orden:
#   1. Variantes con caracteres Unicode (m²/m³) primero — el motor regex no
#      las eclipsa con m2/m3 porque son strings distintos, pero las listamos
#      arriba para claridad de lectura.
#   2. Variantes de 2-3 chars (m2, ml, kg, Ud, hr, Tn, PA, etc.) antes que
#      las de 1 char.
#   3. Variantes de 1 char (m, u, h, t, M, U, H, T) al final — necesarias
#      para PDFs Presto que emiten "01.06 u Demolición" sin sufijo.
#   4. `%` al final — tratado como token de costes indirectos.
_UNITS_GROUP = (
    r"(?:"
    r"m²|M²|m³|M³|"  # superficies/volúmenes con Unicode
    r"m2|M2|m3|M3|ml|ML|"  # superficies/volúmenes ASCII + ml
    r"kg|Kg|KG|kgs|"  # masa
    r"Tn|tn|"  # toneladas variantes
    r"Ud|UD|ud|uds|UDS|"  # unidades
    r"PA|Pa|pa|"  # partida alzada
    r"hr|hrs|"  # horas variantes
    r"h|H|t|T|u|U|m|M|"  # 1-char standalone
    r"%"  # porcentaje (costes indirectos)
    r")"
)

# Pattern A — SANITAS-style: "C04.02 Partida m2 TITULO" (con tipo "Partida"/"Capítulo")
PARTIDA_SANITAS = re.compile(
    r"^(?P<code>C\d+\.\d+(?:\.\d+)?)\s+"
    r"(?P<type>Partida|partida)\s+"
    r"(?P<unit>" + _UNITS_GROUP + r")\s+"
    r"(?P<title>.+?)$",
    re.MULTILINE,
)

# Pattern B — MU02-style: "1.1 Ud TITULO" (códigos numéricos sin C, tipo implícito)
# Acepta también "10.02.04" (3 niveles). El soporte de `M` capital ya está dentro
# de `_UNITS_GROUP` desde Fase 13.A.
PARTIDA_MU02 = re.compile(
    r"^(?P<code>\d+\.\d+(?:\.\d+)?)\s+"
    r"(?P<unit>" + _UNITS_GROUP + r")\s+"
    r"(?P<title>.+?)$",
    re.MULTILINE,
)

# Capítulos con prefijo C: "C01 Capítulo TRABAJOS PREVIOS"
CHAPTER_C_PREFIX = re.compile(
    r"^(?P<code>C\d+)\s+"
    r"Cap[ií]tulo\s+"
    r"(?P<name>[A-ZÁÉÍÓÚÑ][^\n]+)$",
    re.MULTILINE,
)

# Capítulos numéricos: "1 ACTUACIONES PREVIAS" (sin la palabra "Capítulo")
CHAPTER_NUMERIC = re.compile(
    r"^(?P<code>\d+)\s+(?P<name>[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s,Y]+)$",
    re.MULTILINE,
)

# Quantity row aislada en su propia línea. Dos variantes que aparecen en la
# realidad: con unidad ("1,00 Ud", "108,46 m2") o sin ella ("1,0" suelto en
# SANITAS al final de la descripción). Exigimos al menos un decimal para
# descartar números enteros sueltos (page numbers, totales).
QUANTITY_ROW = re.compile(
    r"^(?P<qty>\d+[,.]\d+)(?:\s+(?P<unit>" + _UNITS_GROUP + r"))?\s*$",
    re.MULTILINE,
)


def _to_float(s: str) -> Optional[float]:
    """Convierte '108,46' → 108.46 con tolerancia a coma decimal española."""
    try:
        return float(s.replace(",", "."))
    except (ValueError, AttributeError):
        return None


def find_partidas_in_text(text: str) -> List[Tuple[re.Match, str]]:
    """Devuelve los matches de cualquiera de los patrones, con etiqueta de método.

    El método identifica qué pattern hizo match — útil para telemetría.
    No deduplica: si un mismo trozo matcheara dos patrones devolvería dos hits.
    En la práctica los patrones son disjuntos por construcción (uno exige `C\\d`
    y el otro NO).
    """
    hits: List[Tuple[re.Match, str]] = []
    for m in PARTIDA_SANITAS.finditer(text):
        hits.append((m, "regex_inline"))
    for m in PARTIDA_MU02.finditer(text):
        hits.append((m, "regex_inline"))
    return hits


def find_chapters_in_text(text: str) -> Iterator[re.Match]:
    """Itera sobre matches de capítulos con prefijo C o numéricos."""
    for m in CHAPTER_C_PREFIX.finditer(text):
        yield m
    for m in CHAPTER_NUMERIC.finditer(text):
        yield m


# ---- Heurísticas de "frase descriptiva técnica" ----------------------------

# Verbos de obra que típicamente abren una descripción técnica de partida.
_WORK_VERBS = (
    "Suministro", "Demolición", "Demolicion", "Instalación", "Instalacion",
    "Excavación", "Excavacion", "Colocación", "Colocacion", "Ejecución",
    "Ejecucion", "Desmontaje", "Desmontado", "Acondicionamiento",
    "Construcción", "Construccion", "Hormigón", "Hormigon", "Limpieza",
    "Vallado", "Replanteo", "Picado", "Pintura", "Aplicación", "Aplicacion",
    "Tratamiento", "Refuerzo", "Aislamiento",
)


def looks_like_work_description(line: str) -> bool:
    """Heurística: ¿esta línea arranca con un verbo de obra y tiene cuerpo?

    Útil para detectar bloques descriptivos huérfanos al inicio de página.
    Tolera mayúscula inicial o ALL CAPS (algunos PDFs vienen en mayúsculas).
    """
    stripped = line.strip()
    if len(stripped) < 30:
        return False
    first_word = stripped.split()[0] if stripped else ""
    # Comparación case-insensitive sobre la primera palabra.
    return any(first_word.lower().startswith(v.lower()) for v in _WORK_VERBS)

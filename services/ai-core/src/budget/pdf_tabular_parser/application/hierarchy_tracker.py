"""HierarchyTracker — detecta y mantiene cursor jerárquico CAPÍTULO/SUBCAPÍTULO/APARTADO.

Detecta líneas declarativas de jerarquía organizativa en PDFs PRESTO.
NO detecta partidas (eso es trabajo del partida_extractor).

Patrones soportados (case-insensitive, prefijo BOL):

- `CAPÍTULO XX <NOMBRE>` — nivel 1 (acepta sin tilde).
- `XX <NOMBRE_TODO_MAYUSCULA>` — nivel 1 implícito (sin palabra "CAPÍTULO").
- `SUBCAPÍTULO XX.YY <Nombre>` — nivel 2.
- `APARTADO XX.YY.ZZ <Nombre>` — nivel 3.
- `XX.YY <Nombre>` (en contexto subcapítulo) — nivel 2 implícito.

Strings que NO son chapter heading (anti-FP):
- "TOTAL CAPÍTULO 02 ALBAÑILERÍA"
- "SUMA CAPÍTULO 02"
- "Página 5"
- Líneas que empiezan con dígito pero terminan en "marzo 2025" (fechas).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from src.budget.pdf_tabular_parser.domain.hierarchy import ChapterHierarchy, HierarchyLevel

# --- Regex patterns ---

# CAPÍTULO XX NOMBRE_MAYUS (con o sin tilde, case-insensitive)
_RE_CAPITULO_EXPLICIT = re.compile(
    r"^\s*(?:cap[ií]tulo)\s+(?P<code>\d{1,3})\s+(?P<name>[A-ZÁÉÍÓÚÑ][\w\s,\.\-\(\)/&Y]{1,200})$",
    re.IGNORECASE,
)

# Estilo RdLL ANNEXED: XX Capítulo NOMBRE (número primero, palabra después).
# También cubre estilo SANITAS: CXX Capítulo NOMBRE (prefijo C opcional).
# Ejemplos reales:
# - "01 Capítulo DESBROCE" (RdLL)
# - "02 Capítulo MOVIMIENTO DE TIERRAS" (RdLL)
# - "C01 Capítulo TRABAJOS PREVIOS, DERRIBOS Y EXTRACCIONES" (SANITAS)
_RE_CAPITULO_RDLL_STYLE = re.compile(
    r"^\s*(?P<code>C?\d{1,3})\s+(?:Cap[ií]tulo)\s+(?P<name>[A-ZÁÉÍÓÚÑ][^\n]{1,200})$",
    re.IGNORECASE,
)

# XX NOMBRE_TODO_MAYUSCULA (al menos 4 chars, sin números intermedios)
_RE_CAPITULO_IMPLICIT = re.compile(
    r"^\s*(?P<code>\d{1,3})\s+(?P<name>[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s,\-\(\)/&Y]{3,200})$",
)

# SUBCAPÍTULO XX.YY Nombre
_RE_SUBCAPITULO_EXPLICIT = re.compile(
    r"^\s*(?:subcap[ií]tulo)\s+(?P<code>\d{1,3}\.\d{1,3})\s+(?P<name>.{2,200})$",
    re.IGNORECASE,
)

# APARTADO XX.YY.ZZ Nombre
_RE_APARTADO_EXPLICIT = re.compile(
    r"^\s*(?:apartado)\s+(?P<code>\d{1,3}\.\d{1,3}\.\d{1,3})\s+(?P<name>.{2,200})$",
    re.IGNORECASE,
)

# Anti-FP: TOTAL CAPÍTULO / SUMA CAPÍTULO / ASCIENDE
_RE_TOTAL = re.compile(
    r"^\s*(?:total|suma|asciende|importe)\b",
    re.IGNORECASE,
)

# Anti-FP: Página/Pag X
_RE_PAGE = re.compile(r"^\s*p[aá]g(?:ina)?\s+\d+", re.IGNORECASE)

# Anti-FP: fecha tipo "25 marzo 2025 1" — empieza con día y mes en español
_RE_DATE = re.compile(
    r"^\s*\d{1,2}\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|"
    r"agosto|septiembre|octubre|noviembre|diciembre)\s+\d{4}",
    re.IGNORECASE,
)


@dataclass
class HierarchyDetection:
    """Resultado de analizar una línea: ¿es capítulo/subcap/apartado/nada?"""

    level: Optional[HierarchyLevel]
    code: str = ""
    name: str = ""


def detect_hierarchy_in_line(text: str) -> HierarchyDetection:
    """Analiza una línea y dice si es declaración de capítulo/subcap/apartado.

    Retorna HierarchyDetection con level=None si no es ninguna.

    Orden de precedencia (más específico primero):
    1. SUBCAPÍTULO explícito (con palabra).
    2. APARTADO explícito (con palabra).
    3. CAPÍTULO explícito (con palabra).
    4. CAPÍTULO implícito (XX NOMBRE_MAYUS).
    """
    if not text:
        return HierarchyDetection(level=None)

    clean = text.strip()
    if not clean:
        return HierarchyDetection(level=None)

    # Anti-FPs.
    if _RE_TOTAL.match(clean):
        return HierarchyDetection(level=None)
    if _RE_PAGE.match(clean):
        return HierarchyDetection(level=None)
    if _RE_DATE.match(clean):
        return HierarchyDetection(level=None)

    # Apartado explícito.
    m = _RE_APARTADO_EXPLICIT.match(clean)
    if m:
        return HierarchyDetection(
            level=HierarchyLevel.APARTADO,
            code=m.group("code"),
            name=m.group("name").strip(),
        )

    # Subcapítulo explícito.
    m = _RE_SUBCAPITULO_EXPLICIT.match(clean)
    if m:
        return HierarchyDetection(
            level=HierarchyLevel.SUBCAPITULO,
            code=m.group("code"),
            name=m.group("name").strip(),
        )

    # Capítulo explícito.
    m = _RE_CAPITULO_EXPLICIT.match(clean)
    if m:
        return HierarchyDetection(
            level=HierarchyLevel.CAPITULO,
            code=m.group("code"),
            name=m.group("name").strip(),
        )

    # Estilo RdLL ANNEXED (XX Capítulo NOMBRE).
    m = _RE_CAPITULO_RDLL_STYLE.match(clean)
    if m:
        return HierarchyDetection(
            level=HierarchyLevel.CAPITULO,
            code=m.group("code"),
            name=m.group("name").strip(),
        )

    # Capítulo implícito (XX NOMBRE_MAYUS). Más estricto:
    # - El nombre debe estar al menos 50% en mayúsculas.
    # - No debe contener una unidad reconocible (m², m3, ud, ...) — sería una partida.
    m = _RE_CAPITULO_IMPLICIT.match(clean)
    if m:
        name = m.group("name").strip()
        if _looks_like_chapter_name(name):
            return HierarchyDetection(
                level=HierarchyLevel.CAPITULO,
                code=m.group("code"),
                name=name,
            )

    return HierarchyDetection(level=None)


# Unidades que NO deben aparecer en un nombre de capítulo (señal de que es
# realmente una partida).
_UNIT_BLOCKLIST = {
    "m2", "m3", "ml", "kg", "ud", "uds", "ud.", "pa", "%", "hr", "hrs",
    "m²", "m³", "tn", "t.", "h", "h.",
}


def _looks_like_chapter_name(name: str) -> bool:
    """Heurística para nombre de capítulo válido vs falso positivo.

    Reglas:
    - Mayoría de los chars son letras mayúsculas o espacios.
    - No contiene unidades de medida.
    - Longitud mínima razonable.
    """
    if len(name) < 3:
        return False

    # No debe contener unidades como palabras sueltas al principio.
    first_word = name.split()[0].lower() if name.split() else ""
    if first_word in _UNIT_BLOCKLIST:
        return False

    # Contar letras mayúsculas vs minúsculas (excluyendo espacios/dígitos/símbolos).
    letters = [c for c in name if c.isalpha()]
    if not letters:
        return False
    upper_ratio = sum(1 for c in letters if c.isupper()) / len(letters)
    return upper_ratio >= 0.7


def apply_detection_to_hierarchy(
    hierarchy: ChapterHierarchy,
    detection: HierarchyDetection,
) -> bool:
    """Aplica una detección a la jerarquía (mutación in-place).

    Retorna True si la jerarquía fue modificada.
    """
    if detection.level is None:
        return False

    if detection.level == HierarchyLevel.CAPITULO:
        hierarchy.set_capitulo(detection.code, detection.name)
        return True
    if detection.level == HierarchyLevel.SUBCAPITULO:
        hierarchy.set_subcapitulo(detection.code, detection.name)
        return True
    if detection.level == HierarchyLevel.APARTADO:
        hierarchy.set_apartado(detection.code, detection.name)
        return True
    return False

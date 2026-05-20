"""PartidaHeaderAnnexed — detector relajado para PDFs ANNEXED.

Variante más permisiva de `partida_extractor.detect_partida_header_from_text`
optimizada para PDFs en modo ANNEXED (RdLL, SANITAS):

- Acepta SANITAS-style (`Cxx.yy [Partida] UD TÍTULO`).
- Acepta RdLL-style (`xx.yy Partida UD TÍTULO` con palabra "Partida").
- Acepta línea sin palabra "Partida" (`xx.yy UD TÍTULO`).
- 1-4 niveles jerárquicos en el code (XX.YY[.ZZ[.WW]]).

Anti-falsos-positivos (lección S3-06):
- Rechaza prefijos PRESTO internos (TC-, EL-, FN-, etc.).
- Rechaza fechas (`25 marzo 2025`).
- Rechaza líneas de total (`Total XX.YY ...`).
- Rechaza títulos demasiado cortos (<5 chars).
- Rechaza unidades inválidas.

NOTA: Este detector es **complementario** al `detect_partida_header_from_text`
existente. NO lo reemplaza. El parser TABULAR usa el detector estricto en
modo INLINE; este detector relajado se usa solo en modo ANNEXED, donde el
formato de cabecera es ligeramente distinto.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

# Unidades válidas (replicadas del partida_extractor para mantener el módulo
# independiente). Aceptamos variantes case-insensitive.
_VALID_UNITS = {
    "m", "m2", "m3", "m²", "m³",
    "ml", "kg", "tn", "t",
    "ud", "uds", "u", "unid",
    "h", "hr", "hrs",
    "pa", "p.a.",
    "%",
    "kn", "j",
    "l", "lit", "lts",
}


# Patrón anchor para el code: opcional C, 1-3 dígitos, 1-3 niveles adicionales
# o sufijo PC<num>.<num>[...].
# Ejemplos: 01.01, 1.2.6, C01.01, 12.34.56.78, 90PC07.01
_RE_CODE = re.compile(
    r"^(?P<code>"
    r"C?\d{1,3}"
    r"(?:"
    r"(?:\.\d{1,3}){1,3}"
    r"|"
    r"PC\d+(?:\.\d+){1,3}"
    r")"
    r")$"
)

# Anti-FP: prefijos PRESTO internos (TC-, EL-, FN-, PS-, CL-, S-, VN-, PL-,
# DC-, PC-, SN-) — códigos de detalle interno del aparejador, NO partidas.
_RE_PRESTO_INTERNAL = re.compile(
    r"^(?:TC|EL|FN|PS|CL|S|VN|PL|DC|PC|SN)-\d"
)

# Anti-FP: fecha tipo "25 marzo 2025" o "25 marzo 2025 1".
_RE_DATE_LIKE = re.compile(
    r"^\d{1,2}\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|"
    r"agosto|septiembre|octubre|noviembre|diciembre)\s+\d{4}",
    re.IGNORECASE,
)

# Anti-FP: líneas que empiezan con palabras blocklist.
_RE_BLOCKLIST_START = re.compile(
    r"^(?:total|subtotal|suma|asciende|importe|"
    r"cap[ií]tulo|subcap[ií]tulo|apartado|"
    r"p[aá]g(?:ina)?)\b",
    re.IGNORECASE,
)


@dataclass
class PartidaHeaderResult:
    """Resultado de analizar una línea como posible cabecera de partida ANNEXED."""

    is_partida: bool
    code: str = ""
    unit: str = ""
    title: str = ""
    rejection_reason: Optional[str] = None


def detect_partida_header_annexed(text: str) -> PartidaHeaderResult:
    """Analiza una línea como cabecera de partida ANNEXED.

    Acepta:
    - "01.01 Partida UD REPLANTEO"
    - "01.01 UD REPLANTEO"
    - "C01.01 Partida m2 Demolición..."
    - "C01.01 m2 Demolición..."
    - "01.01.01 ud Replanteo general"
    - "1.2.6 m2 Eliminación de revestimiento"

    Rechaza:
    - Líneas vacías o whitespace
    - Códigos sin punto (capítulos solitarios)
    - Códigos PRESTO internos (TC-, EL-, FN-, ...)
    - Fechas
    - Líneas que empiezan con TOTAL/CAPÍTULO/PÁGINA/etc.
    - Unidades no reconocibles
    - Títulos <5 caracteres
    """
    if not text:
        return PartidaHeaderResult(is_partida=False, rejection_reason="empty_text")

    clean = text.strip()
    if not clean:
        return PartidaHeaderResult(is_partida=False, rejection_reason="empty_text")

    # Rechazo: prefijos PRESTO internos.
    if _RE_PRESTO_INTERNAL.match(clean):
        return PartidaHeaderResult(is_partida=False, rejection_reason="presto_internal_prefix")

    # Rechazo: fechas.
    if _RE_DATE_LIKE.match(clean):
        return PartidaHeaderResult(is_partida=False, rejection_reason="date_like")

    # Rechazo: líneas con palabras blocklist al inicio.
    if _RE_BLOCKLIST_START.match(clean):
        return PartidaHeaderResult(is_partida=False, rejection_reason="blocklist_keyword")

    # Tokenizar.
    tokens = clean.split()
    if len(tokens) < 3:
        return PartidaHeaderResult(is_partida=False, rejection_reason="too_few_tokens")

    # Validar código.
    code_token = tokens[0]
    if _RE_CODE.match(code_token) is None:
        return PartidaHeaderResult(is_partida=False, rejection_reason="invalid_code_format")

    # Verificar que tiene al menos un punto (no es un capítulo solitario).
    if "." not in code_token:
        return PartidaHeaderResult(is_partida=False, rejection_reason="no_hierarchy_separator")

    # Aceptar opcionalmente la palabra "Partida"/"partida" tras el code.
    idx_after_code = 1
    if len(tokens) > 1 and tokens[1].lower() in ("partida", "partida:"):
        idx_after_code = 2

    if idx_after_code >= len(tokens):
        return PartidaHeaderResult(is_partida=False, rejection_reason="no_unit_or_title")

    unit_candidate = tokens[idx_after_code]
    unit_norm = unit_candidate.lower().rstrip(".")
    if unit_norm not in _VALID_UNITS:
        return PartidaHeaderResult(
            is_partida=False,
            rejection_reason=f"invalid_unit:{unit_candidate}",
        )

    title_tokens = tokens[idx_after_code + 1:]
    title = " ".join(title_tokens).strip()
    if len(title) < 5:
        return PartidaHeaderResult(is_partida=False, rejection_reason="title_too_short")

    return PartidaHeaderResult(
        is_partida=True,
        code=code_token,
        unit=unit_candidate,
        title=title,
    )

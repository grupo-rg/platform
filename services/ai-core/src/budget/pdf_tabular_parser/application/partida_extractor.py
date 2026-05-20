"""PartidaExtractor — detecta cabeceras de partida y extrae cantidades.

Una **partida** es la unidad atómica de un presupuesto. En PDFs PRESTO/CIFRE
tabular, una partida típica se compone de:

1. **Cabecera**: `XX.YY[.ZZ[.WW]] <unit> <título>` — código jerárquico,
   unidad reconocida, título descriptivo.
2. **Cuerpo descriptivo** (líneas siguientes): párrafos libres.
3. **Filas de medición** (opcionales): `<descripción zona> UDS LONG ANCH ALT CANT`.
4. **Fila summary**: `<CANT> <PRECIO> <IMPORTE>` con 3 decimales aislados.

Este módulo SOLO se encarga de:
- Identificar si una fila es cabecera de partida.
- Aplicar las reglas anti-falsos-positivos.
- Extraer cantidad de la fila summary o de la columna CANTIDAD.

NO maneja jerarquía (eso es hierarchy_tracker) ni I/O (eso es el orquestador).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional

from src.budget.pdf_tabular_parser.application.spanish_number import parse_spanish_number
from src.budget.pdf_tabular_parser.domain.column import ColumnConcept
from src.budget.pdf_tabular_parser.domain.row import TabularRow

# --- Code patterns ---

# Códigos válidos de partida: 2-4 niveles separados por punto.
# Ej: "01.01", "01.01.01", "1.2.6", "01.01.01.01".
# NO: "01" (sería capítulo), "0" (suelto), "C04.02" (es SANITAS — otro layout).
_RE_PARTIDA_CODE = re.compile(r"^\d{1,3}(?:\.\d{1,3}){1,3}$")

# Códigos de capítulo NO válidos como partida: "01", "21", "7".
_RE_CHAPTER_ONLY_CODE = re.compile(r"^\d{1,3}$")

# Fecha tipo "25" o "marzo 2025" o "25 marzo 2025 1".
_RE_DATE_LIKE = re.compile(
    r"^\d{1,2}\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|"
    r"agosto|septiembre|octubre|noviembre|diciembre)\s+\d{4}",
    re.IGNORECASE,
)

# Unidades válidas (sufijo de la cabecera). Aceptamos variantes case-insensitive.
_VALID_UNITS = {
    "m", "m2", "m3", "m²", "m³",
    "ml", "kg", "tn", "t",
    "ud", "uds", "u", "unid",
    "h", "hr", "hrs",
    "pa", "p.a.",
    "%",
    "kn", "j",
    "l", "lit", "lts",  # litros
}

# Keywords que descalifican una fila como partida (anti-FP).
_BLOCKLIST_KEYWORDS = {
    "total", "subtotal", "suma", "asciende", "importe",
    "capitulo", "capítulo", "subcapitulo", "subcapítulo", "apartado",
    "pagina", "página",
}


@dataclass
class PartidaHeader:
    """Resultado de analizar una fila como posible cabecera de partida."""

    is_partida: bool
    code: str = ""
    unit: str = ""
    title: str = ""
    rejection_reason: Optional[str] = None  # debugging — por qué se rechazó


def detect_partida_header_from_text(text: str) -> PartidaHeader:
    """Analiza una línea como string y dice si es cabecera de partida.

    Aplica TODAS las reglas anti-falsos-positivos del spec:
    1. Tiene `code` con punto: `XX.YY` mínimo (descarta `21`, `0`, `7`).
    2. `code` NO matchea regex de fecha.
    3. Tiene `description` (título) no vacío y >5 caracteres.
    4. Tiene `unit` reconocible (m², m³, ml, ud, ...).
    5. NO contiene keywords TOTAL/SUBTOTAL/CAPÍTULO en code/title.
    """
    if not text:
        return PartidaHeader(is_partida=False, rejection_reason="empty_text")

    clean = text.strip()

    # Rechazo rápido: línea con sólo un número (capítulo solitario o page number).
    if _RE_CHAPTER_ONLY_CODE.match(clean):
        return PartidaHeader(is_partida=False, rejection_reason="chapter_only_code")

    # Rechazo rápido: fecha.
    if _RE_DATE_LIKE.match(clean):
        return PartidaHeader(is_partida=False, rejection_reason="date_like")

    # Tokenizar y buscar code + unit + title.
    tokens = clean.split()
    if len(tokens) < 3:
        return PartidaHeader(is_partida=False, rejection_reason="too_few_tokens")

    code_token = tokens[0]
    if not _RE_PARTIDA_CODE.match(code_token):
        return PartidaHeader(is_partida=False, rejection_reason="invalid_code_format")

    # Aceptar opcionalmente la palabra "Partida"/"partida" tras el code.
    idx_after_code = 1
    if len(tokens) > 1 and tokens[1].lower() in ("partida", "partida:"):
        idx_after_code = 2

    if idx_after_code >= len(tokens):
        return PartidaHeader(is_partida=False, rejection_reason="no_unit_or_title")

    unit_candidate = tokens[idx_after_code]
    unit_norm = unit_candidate.lower().rstrip(".")
    if unit_norm not in _VALID_UNITS:
        return PartidaHeader(is_partida=False, rejection_reason=f"invalid_unit:{unit_candidate}")

    title_tokens = tokens[idx_after_code + 1:]
    title = " ".join(title_tokens).strip()
    if len(title) < 5:
        return PartidaHeader(is_partida=False, rejection_reason="title_too_short")

    # Anti-FP: no debe haber keywords blocklist en el title.
    lower_combined = (code_token + " " + title).lower()
    for kw in _BLOCKLIST_KEYWORDS:
        # match palabra completa, no substring.
        if re.search(rf"\b{re.escape(kw)}\b", lower_combined):
            return PartidaHeader(is_partida=False, rejection_reason=f"blocklist_keyword:{kw}")

    return PartidaHeader(
        is_partida=True,
        code=code_token,
        unit=unit_candidate,
        title=title,
    )


def detect_partida_header_from_row(row: TabularRow) -> PartidaHeader:
    """Versión orientada a TabularRow. Construye texto de la fila completa y delega."""
    text = row.get_full_text()
    return detect_partida_header_from_text(text)


@dataclass
class SummaryRow:
    """Fila de summary `<CANT> <PRECIO> <IMPORTE>`.

    En PDFs PRESTO típicos, esta fila tiene 3 números decimales aislados y
    aparece justo antes de la siguiente partida. Sirve para extraer la
    cantidad final, aunque el código se omite (asume "última partida vista").
    """

    is_summary: bool
    quantity: Optional[float] = None
    price: Optional[float] = None
    amount: Optional[float] = None


# Patrón para fila summary: 3 decimales separados por espacio. Tolera "0,00" e "0.00".
_RE_SUMMARY_3DEC = re.compile(
    r"^\s*"
    r"(?P<qty>-?\d+(?:[.,]\d+)?)\s+"
    r"(?P<price>-?\d+(?:[.,]\d+)?)\s+"
    r"(?P<amount>-?\d+(?:[.,]\d+)?)\s*$"
)


def detect_summary_row(text: str) -> SummaryRow:
    """Detecta fila summary `CANT PRECIO IMPORTE` (3 decimales aislados)."""
    if not text:
        return SummaryRow(is_summary=False)

    m = _RE_SUMMARY_3DEC.match(text.strip())
    if not m:
        return SummaryRow(is_summary=False)

    qty = parse_spanish_number(m.group("qty"))
    price = parse_spanish_number(m.group("price"))
    amount = parse_spanish_number(m.group("amount"))

    # Si alguno no es número válido, no es summary.
    if qty is None or price is None or amount is None:
        return SummaryRow(is_summary=False)

    return SummaryRow(is_summary=True, quantity=qty, price=price, amount=amount)


def extract_quantity_from_row(row: TabularRow) -> Optional[float]:
    """Intenta extraer la cantidad de una fila tabular.

    Estrategia (en orden):
    1. Si tiene celda CANTIDAD: parsear como spanish_number.
    2. Si la fila completa matchea un summary row: usar qty.
    3. Sino: None.
    """
    if row.has_cell(ColumnConcept.CANTIDAD):
        qty = parse_spanish_number(row.get_cell(ColumnConcept.CANTIDAD))
        if qty is not None:
            return qty

    # Intentar parsear como summary row.
    summary = detect_summary_row(row.get_full_text())
    if summary.is_summary:
        return summary.quantity

    return None

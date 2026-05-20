"""Parsing de números españoles (coma decimal, opcional miles con punto).

Casos soportados:
- "10,000" → 10.0 (coma decimal; 10 unidades, no 10000)
- "1.234,56" → 1234.56 (punto miles, coma decimal)
- "10" → 10.0 (entero)
- "0,00" → 0.0
- "" → None
- "abc" → None

Reglas:
1. Si tiene COMA: tratar como decimal español. Quitar puntos como separador miles.
2. Si tiene solo PUNTOS y un único punto al final con 2-3 decimales:
   tratamos como decimal anglo (raro en presupuestos pero defensivo).
3. Si tiene solo dígitos: entero positivo.
"""
from __future__ import annotations

import re
from typing import Optional

_RE_NUMERIC = re.compile(r"^-?\d+([.,]\d+)*$")


def parse_spanish_number(s: str) -> Optional[float]:
    """Parsea un string como número español.

    Retorna None si el string no es parseable. Tolera espacios al inicio/fin.
    """
    if s is None:
        return None
    txt = str(s).strip()
    if not txt:
        return None

    # Quitar espacios internos (algunos números vienen como "1 234,56").
    txt_compact = txt.replace(" ", "")

    if not _RE_NUMERIC.match(txt_compact):
        return None

    has_comma = "," in txt_compact
    has_dot = "." in txt_compact

    try:
        if has_comma:
            # Español: punto como separador de miles, coma como decimal.
            cleaned = txt_compact.replace(".", "").replace(",", ".")
            return float(cleaned)
        if has_dot:
            # Sin coma. Si hay un solo punto seguido de 2-3 dígitos al final,
            # asumimos decimal anglo. En otro caso, puntos como separador miles.
            parts = txt_compact.split(".")
            last = parts[-1]
            if len(parts) == 2 and len(last) in (1, 2, 3) and last.isdigit():
                return float(txt_compact)
            # Resto: punto como separador miles.
            return float(txt_compact.replace(".", ""))
        # Solo dígitos.
        return float(txt_compact)
    except (ValueError, TypeError):
        return None

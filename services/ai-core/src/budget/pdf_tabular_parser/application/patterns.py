"""Patrones regex deterministas para layout PRESTO ANNEXED (Sprint 4 Fase D).

Layout ANNEXED:
- Descripciones en primer tercio del PDF.
- Mediciones y totales en últimas páginas.

Línea total típica (extracto real de los goldens del cliente):

    Total C01.01 236,50 0,00 0,00       (SANITAS, prefijo C)
    Total 01.01 220,88 0,00              (RdLL, código numérico)
    Total 90PC07.01 495,00 0,00          (RdLL, sufijo PC)
    Total 02.01 1.247,30 0,00            (RdLL, miles con punto)

Códigos con prefijo PRESTO interno (NO son partidas, se ignoran):

    Total TC-1.1.1 1,00                  (Trabajos Construcción)
    Total EL-1.8 1,00                    (Eléctrico)
    Total FN-2.3 5,00                    (Fontanería)

Estos sub-totales internos del aparejador NO deben extraerse como partidas
(lección S3-06 ampliada).
"""
from __future__ import annotations

import re

# Total con código de partida válido (numérico XX.YY[.ZZ[.WW]] o con prefijo C).
#
# REJECTS códigos con prefijo PRESTO interno (TC-, EL-, FN-, PS-, CL-, S-, VN-,
# PL-, DC-, PC-, SN-) porque son detalle interno del aparejador, no partidas.
#
# Acepta:
#   "Total 01.01 220,88 0,00"            → code=01.01, qty=220,88
#   "Total C01.01 236,50 0,00 0,00"      → code=C01.01, qty=236,50
#   "Total 90PC07.01 495,00 0,00"        → code=90PC07.01, qty=495,00
#   "Total 02.01 1.247,30 0,00"          → code=02.01, qty=1.247,30
#
# Rechaza:
#   "Total TC-1.1.1 1,00"
#   "Total EL-1.8 1,00"
#   "Total FN-2.3 5,00"
#
# Notas:
# - Prefijo C opcional (SANITAS) — \bC?\b.
# - Sufijo PC<num>[.num] opcional (90PC07.01).
# - Cantidad: 1, 1,5, 1.247,30, 220,88, etc. (formato español).
# - Después de qty puede haber 1-3 números más (precio, importe, retención) que
#   ignoramos — usualmente "0,00".
TOTAL_LINE_RE = re.compile(
    r"^Total\s+"
    r"(?P<code>"
    r"C?\d{1,3}"                       # prefijo opcional C + 1-3 dígitos
    r"(?:"
    r"(?:\.\d{1,3}){1,3}"              # caso A: 1-3 niveles adicionales: .YY[.ZZ[.WW]]
    r"|"
    r"PC\d+(?:\.\d+){1,3}"             # caso B: sufijo PC<num>.<num>[.num[.num]] (ej. 90PC07.01)
    r")"
    r")"
    r"\s+(?P<qty>\d[\d.,]*\d|\d)"       # cantidad: 1, 1,5, 1.247,30, 220,88, etc.
    r"(?:\s+\d[\d.,]*){0,3}\s*$",       # opcionalmente 0-3 números trailing (precio/importe)
)


# (Opcional, no usar para extracción — solo telemetría diagnóstica.)
# Sub-totales internos con prefijo PRESTO. NO son partidas — esto permite
# emitir métricas sobre cuántos sub-totales internos contiene un PDF.
SUBTOTAL_INTERNAL_RE = re.compile(
    r"^Total\s+(?P<prefix>[A-Z]{1,4})-\d+(?:\.\d+){1,3}\s+\d[\d.,]*"
)

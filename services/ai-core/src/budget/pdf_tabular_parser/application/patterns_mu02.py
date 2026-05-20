"""Patrones regex deterministas para layout MU02 (Sprint 4 Fase E).

Layout MU02 (Balearchitekt Projekte, estado de mediciones):
- Cabecera tabular `Nº Ud Descripción Cantidad Precio Total` que se repite
  como header band en cada página.
- Partidas inline con código jerárquico, unidad y título largo multilínea.
- Cuerpo de la partida (descripción + opcional tabla de mediciones zonales).
- Total final inline al cierre de cada partida: `<qty> <unidad>` aislado en
  una línea (ej. `720,00 m²`, `1,00 Ud`).

Ejemplo de partida MU02 completa:

    2.1 M² Desbroce y limpieza del terreno, con medios mecánicos.
    Comprende los trabajos necesarios para retirar las zonas previstas...
    Incluye: Replanteo en el terreno...
    Area Largo Ancho Alto Parcial Subtotal      ← cabecera de mediciones (opcional)
    VIVIENDA [A]       117,9          117,90    ← filas detalladas (opcional)
    CASETA [A]         19,4           19,40
    ...
    720,00 720,00                               ← subtotal duplicado (a descartar)
    720,00 m²                                   ← TOTAL FINAL (qty + unidad)

Y partida simple sin tabla de mediciones:

    1.1 Ud Acondicionamiento de la entrada del solar...
    Incluye:
    - Limpiar superficie
    - Meter 10cm de grava...
    1,00 Ud                                     ← total final directo

Anti-falsos-positivos críticos:
- `720,00 720,00` (subtotal duplicado, NO total final).
- `VIVIENDA [A] 117,9 117,90` (fila de medición zonal).
- `0.80 cm Eje excavación` (medición con código 0.X y unidad inválida).
- `Pol.11-Parc.213` (header documental, no capítulo).
"""
from __future__ import annotations

import re

# Cabecera tabular MU02. Se repite en cada página (header band).
# Tolerante: case-insensitive + whitespace flexible.
# 'Nº' usa U+00BA (masculine ordinal). Aceptamos también '°' (U+00B0, degree)
# y 'o' (letra ASCII) por si hay otras variantes de exportación PDF.
MU02_TABLE_HEADER_RE = re.compile(
    r"^\s*N[°ºo]?\s+Ud\s+Descripci[óo]n\s+Cantidad\s+Precio\s+Total\s*$",
    re.IGNORECASE,
)

# Cabecera de partida MU02: <code> <unit> <title>.
# Mismas unidades que el resto del parser (m², m³, ml, Ud, m, h, kg, t, %, PA).
# Code: 2-3 niveles (XX.YY, XX.YY.ZZ). Primer dígito >0 para evitar match con
# filas de medición tipo "0.80 cm Eje excavación".
#
# Notas sobre unidades:
# - `m`/`M` son válidas (caso real: "1.2 M Vallado provisional...").
# - `m²` (U+00B2), `m³` (U+00B3) son válidas.
# - `cm`, `mm`, `km` NO son válidas (medidas geométricas en cabecera son raras y
#   típicamente vienen de filas de medición mal interpretadas).
MU02_PARTIDA_HEADER_RE = re.compile(
    r"^(?P<code>[1-9]\d{0,2}(?:\.\d{1,3}){1,2})"
    r"\s+(?P<unit>Ud|UD|ud|M²|m²|M2|m2|M³|m³|M3|m3|ml|ML|Ml|m|M|kg|Kg|KG|t|T|h|H|%|PA|Pa|pa)"
    r"\s+(?P<title>[A-ZÁÉÍÓÚÑa-záéíóúñ].+?)$"
)

# Cabecera de capítulo MU02: <num> <NOMBRE_MAYUS>.
# El nombre puede tener espacios, comas, 'Y', acentos mayúsculos. Min 4 chars.
MU02_CHAPTER_RE = re.compile(
    r"^(?P<code>\d{1,3})\s+(?P<name>[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s,YÁÉÍÓÚÑ]{3,80})$"
)

# Total final inline: '720,00 m²' o '1,00 Ud'.
# IMPORTANTE: tiene que ser una línea COMPLETA — no parte de subtotal duplicado.
# Patrón: número decimal + espacio + unidad conocida, NADA más en la línea.
MU02_TOTAL_INLINE_RE = re.compile(
    r"^(?P<qty>\d+(?:[.,]\d+)?)"
    r"\s+(?P<unit>Ud|UD|ud|M²|m²|M2|m2|M³|m³|M3|m3|ml|ML|Ml|m|M|kg|Kg|KG|t|T|h|H|%|PA|Pa|pa)\s*$"
)

# Cabecera de mediciones tabular (opcional, sirve para skip):
# 'Area Largo Ancho Alto Parcial Subtotal' o variantes.
MU02_MEASUREMENT_HEADER_RE = re.compile(
    r"^\s*(?:Area|Largo)\s+(?:Largo|Prof|Ancho)\s+(?:Ancho|Prof|Alto)\s+(?:Alto|Parcial)\s+(?:Parcial|Subtotal)\s*(?:Subtotal)?\s*$",
    re.IGNORECASE,
)

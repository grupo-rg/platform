"""Sprint 4 Fase F — extracción de metadata del documento.

Los PDFs de estado de mediciones suelen tener en las primeras líneas de la
página 1 información de identificación del proyecto:

- Título del proyecto (ej. "REFORMA DE LOCAL DESTINADO A CLINICA DENTAL").
- Dirección, parcela, código interno del aparejador.

Estos datos NO viven en las cabeceras de partida ni en los capítulos; viven
ANTES de toda la estructura tabular y son críticos para:
- Identificar el proyecto en el Budget downstream.
- Mostrar contexto al operador en la UI admin.
- Generar el título del Budget final para el cliente.

Ejemplos reales medidos:

PDF: presupuesto_grande_rdll.pdf
  title:    "Roger de lluria_OBRA CIVIL"
  address:  None (o repetición del title)

PDF: sanitas_dental.pdf
  title:    "REFORMA DE LOCAL DESTINADO A CLINICA DENTAL"
  address:  "SITO EN C. BARÓ DE PINOPAR, 9 - 07012 PALMA DE MALLORCA"

PDF: mu02_albanileria.pdf
  title:    "MU02-"
  address:  "Pol.11-Parc.213"

PDF: private_residence_palma.pdf
  title:    "PRESUPUESTO Y MEDICIONES" (header literal del documento)
  address:  "MEDICIONES INFORME IEE ALEXANDRE ROSSELLO 23"

Diseño: heurística pura sobre las primeras 30 líneas no-vacías de la página 1.
Rechaza líneas que son cabeceras tabulares conocidas, capítulos, partidas o
metadata del aparejador.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional, Tuple

# Líneas que NO son metadata del documento (skip).
# Cabeceras tabulares.
_SKIP_TABULAR_HEADER_RE = [
    re.compile(r"C[óo]digo\s+(?:Nat\s+)?Ud\s+", re.IGNORECASE),
    re.compile(r"N[°ºo]\s+Ud\s+Descripci[óo]n", re.IGNORECASE),
    re.compile(r"UDS\s+LONGITUD\s+ANCHURA", re.IGNORECASE),
    re.compile(r"C[óo]digo\s+RESUMEN\s+UDS", re.IGNORECASE),
]
# Cabecera de partida (codigo unidad título).
_SKIP_PARTIDA_HEADER_RE = re.compile(
    r"^\s*C?\d{1,3}(\.\d{1,3}){1,3}\s+(?:Partida|partida|UD|Ud|ud|M[²2³3]|m[²2³3]|ml|m|kg|h|t|u|%|PA)",
    re.IGNORECASE,
)
# Cabecera de capítulo (XX NOMBRE_MAYUS, XX Capítulo NOMBRE, CXX Capítulo NOMBRE).
_SKIP_CHAPTER_RE = re.compile(
    r"^\s*C?\d{1,3}\s+(?:Cap[íi]tulo\s+)?[A-ZÁÉÍÓÚÑ]{3,}",
    re.IGNORECASE,
)
# Paginación: "Página 5", "Pag. 3", "Pag 12", "pag.5", etc.
_SKIP_PAGINATION_RE = re.compile(r"^\s*P[áa]g(?:ina)?\.?\s*\d", re.IGNORECASE)
# Identificadores internos (`SPC0010 zona`).
_SKIP_METADATA_ID_RE = re.compile(r"^\s*[A-Z]{2,4}\d{3,6}(\s+\S{1,40})?\s*$")
# "Presupuesto", "PRESUPUESTO" sola — esa es etiqueta del documento, NO título.
_SKIP_DOC_LABEL_RE = re.compile(
    r"^\s*(?:presupuesto|presupuesto y mediciones|mediciones|estado de mediciones)\s*$",
    re.IGNORECASE,
)


def _is_skippable_line(line: str) -> bool:
    """True si la línea NO es metadata útil del documento."""
    if not line.strip():
        return True
    for pattern in _SKIP_TABULAR_HEADER_RE:
        if pattern.search(line):
            return True
    if _SKIP_PARTIDA_HEADER_RE.match(line):
        return True
    if _SKIP_CHAPTER_RE.match(line):
        return True
    if _SKIP_PAGINATION_RE.match(line):
        return True
    if _SKIP_METADATA_ID_RE.match(line):
        return True
    if _SKIP_DOC_LABEL_RE.match(line):
        return True
    return False


def _looks_like_address(line: str) -> bool:
    """Heurística para detectar líneas que parecen dirección/parcela.

    Patrones típicos (estrictos — solo direcciones físicas verificables):
    - "SITO EN C. ...", "Calle ...", "C/ ..."
    - Códigos postales españoles (5 dígitos).
    - "Pol.NN-Parc.NNN" (parcela rústica).

    NOTA: "MEDICIONES INFORME IEE <Nombre>" NO se considera address — es el
    nombre del informe técnico (encaja mejor como título).
    """
    line_clean = line.strip()
    if not line_clean or len(line_clean) < 5:
        return False
    address_patterns = [
        re.compile(r"\bSITO\s+EN\b", re.IGNORECASE),
        re.compile(r"\b(?:Calle|Avd|Avenida|Carrer|Plaza)\b", re.IGNORECASE),
        re.compile(r"\bC\.?\s*/"),  # "C/" o "C./" — sin \b final porque "/" no es \w
        re.compile(r"\bPol\.?\s*\d+", re.IGNORECASE),  # Polígono
        re.compile(r"\b\d{5}\b"),  # CP español
    ]
    return any(p.search(line_clean) for p in address_patterns)


def _looks_like_partida_title_only(line: str) -> bool:
    """Detecta líneas que son SOLO el título de una partida repetido (sin código).

    En PDFs PRESTO/CIFRE el título de la partida puede aparecer como línea
    suelta en mayúsculas después de la cabecera tabular (ej. "REPLANTEO"
    aislada en RdLL). NO debe considerarse metadata del documento.

    Heurística: 1-3 palabras, todas en mayúsculas, sin dígitos, sin
    caracteres especiales de dirección (sin ".", "/", "Pol", "C.").
    """
    line_clean = line.strip()
    if not line_clean or len(line_clean) < 3 or len(line_clean) > 50:
        return False
    if any(c.isdigit() for c in line_clean):
        return False
    if any(ch in line_clean for ch in [".", "/", ","]):
        return False
    words = line_clean.split()
    if len(words) > 3:
        return False
    # Todas las palabras deben ser >=80% mayúsculas.
    letters = [c for c in line_clean if c.isalpha()]
    if not letters:
        return False
    upper_ratio = sum(1 for c in letters if c.isupper()) / len(letters)
    return upper_ratio >= 0.8


@dataclass
class DocumentMetadata:
    """Metadata extraída de la primera página del PDF."""

    title: Optional[str] = None
    address: Optional[str] = None
    raw_first_lines: List[str] = None  # debugging: primeras N líneas no-skippeables

    def __post_init__(self):
        if self.raw_first_lines is None:
            self.raw_first_lines = []


def extract_document_metadata(text_per_page: List[str]) -> DocumentMetadata:
    """Extrae title + address de la primera página del PDF.

    Heurística:
    1. Toma las primeras 30 líneas no-vacías de la página 1.
    2. Filtra líneas skippeables (cabeceras tabulares, partidas, etiquetas
       del documento, paginación, IDs del aparejador).
    3. Las primeras 2-3 líneas válidas son candidatas a title + address.
    4. Si una línea matchea patrón de dirección → es `address`. La
       inmediatamente anterior es `title` candidato.
    5. Si no se detecta address explícita: la primera línea válida es title
       y la segunda (si la hay) es address.

    Si no hay líneas válidas, retorna DocumentMetadata vacío.
    """
    if not text_per_page:
        return DocumentMetadata()

    first_page = text_per_page[0] or ""
    if not first_page.strip():
        return DocumentMetadata()

    valid_lines: List[str] = []
    for line in first_page.splitlines():
        stripped = line.strip()
        if _is_skippable_line(stripped):
            continue
        # Skip títulos de partida repetidos (palabras sueltas en mayúsculas).
        if _looks_like_partida_title_only(stripped):
            continue
        valid_lines.append(stripped)
        if len(valid_lines) >= 8:  # cap: solo necesitamos las primeras pocas
            break

    if not valid_lines:
        return DocumentMetadata(raw_first_lines=[])

    title: Optional[str] = None
    address: Optional[str] = None

    # Primer pase: identificar la primera línea que sea ADDRESS y tomar la
    # inmediata anterior como TITLE.
    for i, line in enumerate(valid_lines):
        if _looks_like_address(line):
            address = line
            if i > 0:
                title = valid_lines[i - 1]
            else:
                # Address en línea 1 sin title anterior: dejamos title=None.
                title = None
            break

    # Si NO se encontró address explícita: usar primera línea como title.
    # NO asignar segunda línea como address por defecto — mejor None que
    # basura (líneas que pueden ser descripciones de partida o ruido).
    if title is None and address is None:
        title = valid_lines[0]
        # Segunda línea solo si parece una address VERIFICABLE (patrón estricto).
        # Si no, dejar address=None.
        if len(valid_lines) > 1 and _looks_like_address(valid_lines[1]):
            address = valid_lines[1]

    # Truncate (defensivo: PDF mal formado podría tener líneas de 1000+ chars).
    if title and len(title) > 300:
        title = title[:300].rstrip() + "..."
    if address and len(address) > 300:
        address = address[:300].rstrip() + "..."

    return DocumentMetadata(
        title=title,
        address=address,
        raw_first_lines=valid_lines[:5],
    )

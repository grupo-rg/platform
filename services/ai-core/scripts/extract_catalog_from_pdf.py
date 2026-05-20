"""Sprint 3.B Fase A — extract the COAATMCA catalogue from the original PDF.

Implements the parser described by ``data/catalog_source/LAYOUT_SPEC.md``
on top of ``pdfplumber``. The goal is to produce a JSON containing every
partida, every breakdown, and the chapter/subchapter hierarchy of
``docs/Palma47_2025_COAATMCA.pdf`` so it can be cross-checked against
``prices/coaatmca_2025_price_book.json`` and Firestore.

The script is **pure-extraction**: it does NOT alter the JSON / Firestore
data, only produces a parallel snapshot. Reads from the physical PDF
numbering throughout (the printed page numbers are ignored — they have
a variable offset due to interspersed advertisements).

Public API (importable from tests):

  - ``classify_page(page) -> str``
  - ``extract_chapter_title_from_cover(page) -> str | None``
  - ``parse_footer(page) -> tuple[str | None, str | None]``
  - ``page_logical_lines(page) -> list[LogicalLine]``
  - ``is_partida_line(line, x_columns) -> bool``
  - ``is_breakdown_line(line, x_columns) -> bool``
  - ``extract_partida_line(line) -> Partida``
  - ``extract_breakdown_line(line) -> Breakdown``
  - ``parse_toc_page(page) -> list[TocEntry]``
  - ``extract_catalog(pdf_path) -> CatalogExtraction``

CLI:

  python services/ai-core/scripts/extract_catalog_from_pdf.py \
      --pdf docs/Palma47_2025_COAATMCA.pdf \
      --output data/catalog_source/pdf_extracted_catalog.json
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

try:
    import pdfplumber
except ImportError:  # pragma: no cover
    print(
        "[ERROR] pdfplumber no instalado. Ejecuta con services/ai-core/venv/Scripts/python.exe",
        file=sys.stderr,
    )
    sys.exit(2)


logger = logging.getLogger("extract_catalog_from_pdf")


# ---------------------------------------------------------------------------
# Page classification — PASO 1 del pipeline (LAYOUT_SPEC §1.B).
# ---------------------------------------------------------------------------

PAGE_TYPE_PDF_COVER = "pdf_cover"
PAGE_TYPE_CHAPTER_COVER = "chapter_cover"
PAGE_TYPE_ADVERTISEMENT = "advertisement"
PAGE_TYPE_CONTENT = "content_page"
PAGE_TYPE_TOC = "toc_page"


# Regex del footer canonical: MAYUSCULAS + " " + Mixto.
# Acepta tildes, "Y", apostrofes y guiones en el chapter; cualquier cosa en el
# subchapter. Anclado a inicio y a final.
#
# Edge case observado: nombres de capítulo demasiado largos para el ancho
# imprimible se truncan con `…` (U+2026), p.ej.
# ``ELECTRICIDAD Y TELECOMUNICACI… Cuadros y derivación individual`` o
# ``ACRISTALAMIENTOS Vidrios dobles bajo emisivos y control s…`` (donde la
# elipsis cae en el subchapter). Por eso el char `…` se permite en ambas
# clases del regex y los nombres se desambiguan a posteriori por longest-prefix
# match contra el conjunto de capítulos conocidos.
_FOOTER_CANONICAL_RE = re.compile(
    r"^([A-ZÁÉÍÓÚÑÜÇ][A-ZÁÉÍÓÚÑÜÇ,\s'YÍÓ\-/…]{2,40})\s+"
    r"([A-Za-záéíóúñÁÉÍÓÚÑüçÜÇ][A-Za-záéíóúñÁÉÍÓÚÑüçÜÇ0-9\s/\(\),.\-…]{2,80})$"
)

# Set de capítulos canónicos (descubiertos por TOC + chapter covers). Cuando
# el footer tiene un nombre truncado con `…`, se mapea al canónico que más
# prefijo comparta. Se inicializa lazy desde el primer paso del extractor.
_CANONICAL_CHAPTERS: List[str] = []


# Item code regex (LAYOUT_SPEC §3.1) — permisivo, validado por contexto.
# Ejemplos reales:
#   DQC040, DQC040c, 0XA110b, YMM010, YMM011, DRS070, LVC010, DQC030b,
#   ICE040ba, LCL060bj, FFQ010e1, UPG010bA, UXH010c…, AV5.-0, 615aa,
#   990328007, 3009.0010, D3001.0120, UIB_*, 13.11.01_UIB.
# Reglas:
#   - Char inicial: letra MAYÚSCULA o dígito (incluye `0XA*`).
#   - Cuerpo: alfanum + `_` + `.` + `-`.
#   - Sufijo: opcional `[a-z][a-zA-Z0-9]?` para variantes ("ba", "e1", "bA").
_ITEM_CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9_.\-]{1,13}(?:[a-z][a-zA-Z0-9]?)?$")

# Breakdown code regex (LAYOUT_SPEC §3.2) — muy permisivo, validado por contexto.
_BREAKDOWN_CODE_RE = re.compile(r"^[a-zA-Z0-9_.%][\w._%]{0,29}$")

# Unidades canónicas (corto, alineadas con catalog/domain/unit.py).
# La regex incluye también `m²` (U+00B2) y `m³` (U+00B3) — pdfplumber suele
# emitir los superíndices Unicode directamente. Incluye también `m` (metros
# lineales), aunque su uso es raro en partidas (`ml` es lo habitual); aparece
# por ej. en CPI020b (pilote de cimentación: `m` para metro lineal de pilote).
_UNIT_RE = re.compile(
    r"^(m²|m³|m2|m3|ml|kg|t|h|l|ud|u|pa|%|m)$",
    re.IGNORECASE,
)

# Número en formato español: "1,000" "12,50" "0,209" "1.234,56".
_SPANISH_NUMBER_RE = re.compile(r"^\d{1,3}(?:\.\d{3})*,\d{1,3}$|^\d+,\d{1,3}$|^\d+$")

# Bullet de TOC: nivel 1 = `•`, nivel 2 = `••`. El caracter exacto en este PDF
# es `•` (Unicode bullet).
_TOC_LEVEL1_PREFIX = "•"
_TOC_LEVEL2_PREFIX = "••"

# Texto que aparece literalmente en la portada del PDF (página física 12).
_PDF_COVER_KEYWORDS = ("CUADRO DE PRECIOS DESCOMPUESTOS",)

# Y-thresholds relativos (fracción de la altura de página A4 ~ 842pt).
_FOOTER_Y_THRESHOLD = 0.92  # cualquier word con top > 0.92*h es footer.
_PAGINA_HEADER_PATTERN = re.compile(r"^P[áa]gina\s+\d+$", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------


@dataclass
class Word:
    """Representación ligera de una palabra de pdfplumber + región semántica."""
    text: str
    x0: float
    x1: float
    y0: float
    y1: float
    font: str
    size: float

    def is_bold(self) -> bool:
        return "Bold" in self.font or "bold" in self.font

    def x_center(self) -> float:
        return (self.x0 + self.x1) / 2.0


@dataclass
class LogicalLine:
    """Línea lógica de la página: words que pertenecen a la misma "fila" del
    catálogo. Se construye agrupando words por y aproximada y luego ordenando
    por x. El texto puede contener tokens que pdfplumber colocó en dos y-coords
    ligeramente distintas (≤ 1.5pt de diferencia) pero que pertenecen
    semánticamente a la misma línea (ej: la unidad `m²` en CourierNew-Bold se
    sitúa 0.7pt más abajo que el código y la descripción en ArialNarrow-Bold).
    """
    y_anchor: float
    words: List[Word] = field(default_factory=list)

    def text(self, sep: str = " ") -> str:
        return sep.join(w.text for w in self.words)

    def x_min(self) -> float:
        return min(w.x0 for w in self.words) if self.words else 0.0

    def x_max(self) -> float:
        return max(w.x1 for w in self.words) if self.words else 0.0

    def fonts(self) -> List[str]:
        return [w.font for w in self.words]

    def has_bold(self) -> bool:
        return any(w.is_bold() for w in self.words)


@dataclass
class Breakdown:
    code: str
    quantity: float
    unit: str
    description: str
    price_unit: float
    price_total: float

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Partida:
    code: str
    unit: str
    description: str
    price_total: float
    chapter: Optional[str]
    subchapter: Optional[str]
    page_physical: int
    breakdowns: List[Breakdown] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        # Preserva el orden insertado (asdict ya lo hace porque dataclass orders).
        return d


@dataclass
class TocEntry:
    level: int
    title: str
    page_imprinted: Optional[int]  # número impreso (no físico).

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class PageClassification:
    page_no: int
    page_type: str
    word_count: int
    footer_text: Optional[str]
    horizontal_lines: int


@dataclass
class CatalogExtraction:
    source_pdf: str
    extracted_at: str
    stats: Dict[str, Any]
    items: List[Partida]
    toc: List[TocEntry]
    page_classifications: List[PageClassification]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source_pdf": self.source_pdf,
            "extracted_at": self.extracted_at,
            "stats": self.stats,
            "items": [it.to_dict() for it in self.items],
            "toc": [t.to_dict() for t in self.toc],
            "page_classifications": [asdict(p) for p in self.page_classifications],
        }


# ---------------------------------------------------------------------------
# Word extraction helpers
# ---------------------------------------------------------------------------


def _extract_words(page) -> List[Word]:
    raw = page.extract_words(
        x_tolerance=2,
        y_tolerance=3,
        keep_blank_chars=False,
        use_text_flow=False,
        extra_attrs=["fontname", "size"],
    )
    out: List[Word] = []
    for w in raw:
        out.append(Word(
            text=w["text"],
            x0=float(w["x0"]),
            x1=float(w["x1"]),
            y0=float(w["top"]),
            y1=float(w["bottom"]),
            font=str(w.get("fontname", "")),
            size=float(w.get("size", 0.0)),
        ))
    return out


def _group_into_lines(words: List[Word], y_tol: float = 1.0) -> List[LogicalLine]:
    """Agrupa words por y con tolerancia tight. Luego mezcla líneas vecinas si
    sus rangos de x son no-overlapping (es decir, son fragmentos lateralmente
    contiguos de la misma fila lógica).

    Caso típico: en una fila de partida el código (ArialNarrow-Bold size=8.1,
    top≈97.5, x≈60-86), la descripción (ArialMT size=8.1, top≈97.6, x≈113-505)
    y la unidad (CourierNew-Bold size=8.0, top≈98.3, x≈95-105) pertenecen a
    la MISMA fila lógica aunque sus y difieran hasta 0.8pt. Pero la línea Bold
    del precio total (top≈96.0, x≈524-545) está visualmente ENCIMA del código
    y debe permanecer separada.

    Estrategia en 2 pasos:
      1. Cluster con ``y_tol=1.0`` (tight): cada cluster es un "y-row" inicial.
      2. Para cada par de y-rows consecutivos, si sus rangos x NO se solapan
         Y el Δy es ≤ ``y_merge_tol`` (1.5pt) → mergear.
    """
    if not words:
        return []
    sorted_w = sorted(words, key=lambda w: (w.y0, w.x0))
    # Paso 1 — clusters tight por y.
    clusters: List[LogicalLine] = []
    for w in sorted_w:
        if clusters and abs(w.y0 - clusters[-1].y_anchor) <= y_tol:
            clusters[-1].words.append(w)
            clusters[-1].y_anchor = min(clusters[-1].y_anchor, w.y0)
        else:
            clusters.append(LogicalLine(y_anchor=w.y0, words=[w]))

    # Sort cada cluster por x.
    for c in clusters:
        c.words.sort(key=lambda w: w.x0)

    # Paso 2 — merge clusters consecutivos con x-rangos disjuntos.
    merged: List[LogicalLine] = []
    y_merge_tol = 1.5
    for c in clusters:
        if not merged:
            merged.append(c)
            continue
        prev = merged[-1]
        if abs(c.y_anchor - prev.y_anchor) > y_merge_tol:
            merged.append(c)
            continue
        # Test de overlap: si los rangos x de c y prev NO se solapan, mergear.
        prev_xmin, prev_xmax = prev.x_min(), prev.x_max()
        c_xmin, c_xmax = c.x_min(), c.x_max()
        overlap = not (c_xmax < prev_xmin or prev_xmax < c_xmin)
        if not overlap:
            prev.words.extend(c.words)
            prev.words.sort(key=lambda w: w.x0)
            prev.y_anchor = min(prev.y_anchor, c.y_anchor)
        else:
            merged.append(c)
    return merged


def _separate_regions(
    lines: List[LogicalLine],
    page_height: float,
) -> Tuple[List[LogicalLine], List[LogicalLine]]:
    """Devuelve (body_lines, footer_lines). El header (con `Página N`) se filtra
    aparte. body incluye cualquier línea cuyo y_anchor sea menor que el
    footer threshold. Se exceptúa la línea de cabecera `Página N` (alineada
    a la derecha, x0 > 500, y0 < 0.10*h)."""
    footer_threshold = _FOOTER_Y_THRESHOLD * page_height
    body: List[LogicalLine] = []
    footer: List[LogicalLine] = []
    for line in lines:
        if line.y_anchor > footer_threshold:
            footer.append(line)
            continue
        # Filtrar la línea "Página N" del header (la página impresa).
        if (
            line.y_anchor < 0.10 * page_height
            and len(line.words) <= 3
            and _PAGINA_HEADER_PATTERN.match(line.text())
        ):
            continue
        body.append(line)
    return body, footer


# ---------------------------------------------------------------------------
# Footer parsing (LAYOUT_SPEC §3.4)
# ---------------------------------------------------------------------------


def _resolve_truncated_chapter(name: str, known: List[str]) -> str:
    """Si ``name`` termina en ``…`` y existe un canónico en ``known`` cuya
    prefijo sin la elipsis coincida, devuelve el canónico. Si no, devuelve el
    name tal cual.
    """
    if not name or "…" not in name:
        return name
    prefix = name.rstrip("… ").strip()
    if not prefix:
        return name
    matches = [k for k in known if k.startswith(prefix)]
    if len(matches) == 1:
        return matches[0]
    # Si hay múltiples, devuelve el más largo (más específico).
    if matches:
        return max(matches, key=len)
    return name


def parse_footer(page) -> Tuple[Optional[str], Optional[str]]:
    """Parsea el footer canonical → (chapter, subchapter).

    Devuelve ``(None, None)`` si el footer no matchea el formato canónico
    (típicamente páginas de publicidad, contraportada, portada del PDF).

    Si el chapter está truncado con `…` y conocemos el conjunto canónico de
    capítulos vía ``_CANONICAL_CHAPTERS``, se resuelve al canónico que más
    prefijo comparta.
    """
    words = _extract_words(page)
    if not words:
        return (None, None)
    lines = _group_into_lines(words)
    _, footer_lines = _separate_regions(lines, page.height)
    for fl in footer_lines:
        text = fl.text().strip()
        m = _FOOTER_CANONICAL_RE.match(text)
        if m:
            chapter = m.group(1).strip()
            subchapter = m.group(2).strip()
            # Resolve truncations.
            chapter = _resolve_truncated_chapter(chapter, _CANONICAL_CHAPTERS)
            return (chapter, subchapter)
    return (None, None)


# ---------------------------------------------------------------------------
# Chapter cover detection (LAYOUT_SPEC §1.B + §3.4)
# ---------------------------------------------------------------------------


def extract_chapter_title_from_cover(page) -> Optional[str]:
    """Lee el patrón ``• CHAPTER •`` centrado entre líneas horizontales.

    Devuelve el chapter title en MAYÚSCULAS o ``None`` si no se detecta.
    """
    words = _extract_words(page)
    if not words or len(words) > 60:
        return None
    lines = _group_into_lines(words)
    # Recorrer las líneas en el body buscando una con bullets y >=1 token mayúsculas.
    for line in lines:
        if not line.words:
            continue
        text = line.text().strip()
        # El bullet `•` aparece dos veces y entre ellos hay tokens en mayúsculas.
        if text.count(_TOC_LEVEL1_PREFIX) >= 2:
            # Strip bullets y posibles espacios.
            inner = text.replace(_TOC_LEVEL1_PREFIX, " ").strip()
            inner = re.sub(r"\s+", " ", inner)
            if not inner:
                continue
            # Validar que todo esté en MAYÚSCULAS (sin contar dígitos / espacios).
            letters_only = re.sub(r"[^A-Za-zÁÉÍÓÚÑÜÇáéíóúñüç]", "", inner)
            if letters_only and letters_only == letters_only.upper():
                return inner
    return None


# ---------------------------------------------------------------------------
# Page classification (LAYOUT_SPEC §1.B)
# ---------------------------------------------------------------------------


def _detect_horizontal_lines(page) -> int:
    try:
        lines = page.lines
    except Exception:  # pragma: no cover
        return 0
    count = 0
    for l in lines:
        if abs(l.get("bottom", 0) - l.get("top", 0)) < 1.0 and (l.get("x1", 0) - l.get("x0", 0)) > 100:
            count += 1
    return count


def _looks_like_toc(body_lines: List[LogicalLine]) -> bool:
    """Una página TOC tiene muchas líneas con bullet `•` y dot leaders."""
    bullet_lines = 0
    for line in body_lines:
        text = line.text()
        if _TOC_LEVEL1_PREFIX in text and text.count(".") >= 10:
            bullet_lines += 1
    return bullet_lines >= 5


def classify_page(page) -> str:
    """Clasifica una página en uno de los 5 tipos (LAYOUT_SPEC §1.B).

    Returns one of: ``pdf_cover``, ``chapter_cover``, ``advertisement``,
    ``content_page``, ``toc_page``.

    Diferenciador crítico ``pdf_cover`` vs ``advertisement``:

    Ambas pueden ser wordless o tener muy pocas words. Pero el catálogo
    Palma47 reserva ``pdf_cover`` SOLO para la(s) página(s) ≤ 12 (portada
    con `CUADRO DE PRECIOS DESCOMPUESTOS`) y la(s) última(s) 2 (contraportada).
    Cualquier página wordless intermedia es siempre una publicidad insertada.
    """
    words = _extract_words(page)
    word_count = len(words)
    lines = _group_into_lines(words)
    body_lines, footer_lines = _separate_regions(lines, page.height)

    has_canonical_footer = any(
        _FOOTER_CANONICAL_RE.match(fl.text().strip()) for fl in footer_lines
    )

    # Acceder al page number físico via page.page_number (1-based) y al total
    # via el PDF si es posible.
    page_no = getattr(page, "page_number", 0)
    total = 0
    try:
        total = len(page.pdf.pages)
    except Exception:
        total = 0

    is_near_start = page_no > 0 and page_no <= 12
    is_near_end = total > 0 and page_no >= total - 1

    # 1. PDF cover — muy pocas words, sin footer, sin nada útil, AND posición
    #    al inicio o final del documento.
    if word_count < 10 and not has_canonical_footer:
        if is_near_start or is_near_end:
            return PAGE_TYPE_PDF_COVER
        # Wordless en medio del documento → publicidad insertada.
        return PAGE_TYPE_ADVERTISEMENT

    # 2. Chapter cover — pocas words PERO con footer canónico y patrón
    #    `• MAYUS •` centrado.
    if (
        5 <= word_count <= 60
        and has_canonical_footer
        and extract_chapter_title_from_cover(page) is not None
    ):
        return PAGE_TYPE_CHAPTER_COVER

    # 3. TOC — múltiples líneas con bullet + dot leaders.
    if _looks_like_toc(body_lines):
        return PAGE_TYPE_TOC

    # 4. Advertisement — sin footer canónico, NO matchea TOC ni chapter cover.
    if not has_canonical_footer:
        return PAGE_TYPE_ADVERTISEMENT

    # 5. Default — página de contenido.
    return PAGE_TYPE_CONTENT


# ---------------------------------------------------------------------------
# Line classification: partida vs breakdown vs subchapter (LAYOUT_SPEC §3)
# ---------------------------------------------------------------------------


# Bandas de x observadas en el catálogo Palma47 (en pt, para A4 ~595pt wide).
#
#   Partida code      : x0 ≈ 60      (left margin)
#   Partida unit      : x0 ≈ 95
#   Partida desc      : x0 ≈ 113-120
#   Partida price_tot : x0 ≈ 519-545 (right-aligned, BOLD)
#   Breakdown code    : x0 ≈ 94      (indented relative to partida)
#   Breakdown qty     : x0 ≈ 142
#   Breakdown unit    : x0 ≈ 158-165
#   Breakdown desc    : x0 ≈ 170-180
#   Breakdown p_unit  : x0 ≈ 440-500 (right-aligned)
#   Breakdown p_tot   : x0 ≈ 510-545 (right-aligned)
#
# Las bandas se usan SOLO como heurística suave; la validación dura es por
# patrón (regex + presencia de unidad + precio).

PARTIDA_CODE_X_MIN = 50.0
PARTIDA_CODE_X_MAX = 90.0
BREAKDOWN_CODE_X_MIN = 85.0
BREAKDOWN_CODE_X_MAX = 145.0
PARTIDA_PRICE_X_MIN = 500.0


def _looks_like_number(tok: str) -> bool:
    return bool(_SPANISH_NUMBER_RE.match(tok))


def _parse_spanish_float(tok: str) -> Optional[float]:
    """``"1.234,56"`` o ``"0,209"`` o ``"7"`` → float."""
    if tok is None:
        return None
    s = tok.strip()
    if not s:
        return None
    # Quitar separador de miles + cambiar coma decimal por punto.
    s2 = s.replace(".", "").replace(",", ".")
    try:
        return float(s2)
    except ValueError:
        return None


def _is_unit_token(tok: str) -> bool:
    return bool(_UNIT_RE.match(tok))


# Unidades de longitud (`m`, `ml`) son las únicas que tienen 1-2 chars y pueden
# coincidir con palabras frecuentes de la descripción. Para una validación más
# estricta (sólo en `is_partida_line`/`is_breakdown_line`) requerimos que la
# unidad esté en la posición canónica X (CourierNew font o x ∈ [95, 175]).
def _is_unit_word(word: Word) -> bool:
    """Igual que ``_is_unit_token`` pero exige posición canónica para tokens
    cortos ambiguos (`m`, `l`, `t`, `h`, `u`) que pueden aparecer en la
    descripción.
    """
    if not _UNIT_RE.match(word.text):
        return False
    short_ambiguous = {"m", "l", "t", "h", "u"}
    if word.text.lower() in short_ambiguous:
        # Posición canónica: o bien font CourierNew (la fuente dedicada al
        # unit-glyph) o bien x ∈ [90, 180] (la banda del unit en la partida o
        # del unit del breakdown).
        font_ok = "Courier" in word.font
        x_ok = 90.0 <= word.x0 <= 180.0
        return font_ok or x_ok
    return True


def is_partida_line(line: LogicalLine) -> bool:
    """Detecta una línea que comienza una partida (LAYOUT_SPEC §3.1).

    Reglas (las 3 deben cumplirse):
    1. El primer token está en x ≈ [50, 90] (banda de código de partida).
    2. El primer token matchea ``_ITEM_CODE_RE`` y está en font Bold.
    3. La línea contiene una unidad canónica (m², m2, ud, ...).
    """
    if not line.words:
        return False
    first = line.words[0]
    if not (PARTIDA_CODE_X_MIN <= first.x0 <= PARTIDA_CODE_X_MAX):
        return False
    if not _ITEM_CODE_RE.match(first.text):
        return False
    if not first.is_bold():
        return False
    # Buscar unidad en posición canónica entre los tokens restantes.
    has_unit = any(_is_unit_word(w) for w in line.words[1:])
    if not has_unit:
        return False
    return True


def is_breakdown_line(line: LogicalLine) -> bool:
    """Detecta una línea de breakdown (LAYOUT_SPEC §3.2).

    Reglas (todas deben cumplirse):
    1. El primer token (excluyendo descripciones inline) está en x ≈ [85, 145]
       (indentado respecto a partidas).
    2. El primer token matchea ``_BREAKDOWN_CODE_RE``.
    3. La línea contiene al menos una cantidad numérica (formato español).
    4. La línea contiene una unidad canónica.
    5. La línea termina con ≥ 2 números separados (precio_unit + precio_total).
    """
    if not line.words:
        return False
    first = line.words[0]
    if not (BREAKDOWN_CODE_X_MIN <= first.x0 <= BREAKDOWN_CODE_X_MAX):
        return False
    if not _BREAKDOWN_CODE_RE.match(first.text):
        return False
    # NO debe ser un código de partida (font Bold + matches ITEM_CODE) en banda de
    # partida — eso se filtró antes por la banda de x, pero por seguridad...
    # (el código `%` tiene 1 caracter; está OK porque BREAKDOWN_CODE_RE acepta `%`).
    texts = [w.text for w in line.words[1:]]
    has_unit = any(_is_unit_word(w) for w in line.words[1:])
    if not has_unit:
        return False
    numbers = [t for t in texts if _looks_like_number(t)]
    if len(numbers) < 2:
        # A veces los 3 números están concatenados como "1,000 7,000 16,91 1,18"
        # — son al menos 2 → ya cumple.
        return False
    return True


def is_subchapter_bold(line: LogicalLine, avg_size: float) -> bool:
    """Detecta una línea de sub-capítulo en negrita en el body.

    Heurística:
    - Single token de tamaño ≥ ~10pt en font Bold (los subcaps observados son
      Arial-BoldMT size=12.0 mientras los códigos de partida son size≈8.1).
    - No matchea regex de partida ni de breakdown.
    """
    if not line.words:
        return False
    if not line.has_bold():
        return False
    # El tamaño promedio del body de partidas es 7-8pt; los sub-capítulos son 12pt.
    biggest = max(w.size for w in line.words)
    if biggest < max(10.0, avg_size * 1.3):
        return False
    text = line.text().strip()
    # No debe ser un código de partida ni un código de breakdown.
    if _ITEM_CODE_RE.match(text.split()[0] if text else ""):
        return False
    if _BREAKDOWN_CODE_RE.match(text.split()[0] if text else "") and any(
        _is_unit_token(w.text) for w in line.words
    ):
        return False
    return True


# ---------------------------------------------------------------------------
# Line extractors (LAYOUT_SPEC §3.1 / §3.2)
# ---------------------------------------------------------------------------


def extract_partida_line(line: LogicalLine) -> Optional[Dict[str, Any]]:
    """Extrae (code, unit, description_inline, price_total) de una línea
    `is_partida_line(line) == True`.

    Nota: el precio total puede estar en la línea anterior (pdfplumber lo
    extrae típicamente en otra y), o puede estar al final de esta. El parser
    principal completa ``price_total`` desde la línea Bold inmediatamente
    superior si no aparece aquí.
    """
    if not line.words:
        return None
    code = line.words[0].text
    unit: Optional[str] = None
    description_tokens: List[str] = []
    price_total: Optional[float] = None
    for w in line.words[1:]:
        if unit is None and _is_unit_word(w):
            unit = w.text
            continue
        if (
            w.is_bold()
            and w.x0 >= PARTIDA_PRICE_X_MIN
            and _looks_like_number(w.text)
        ):
            price_total = _parse_spanish_float(w.text)
            continue
        description_tokens.append(w.text)
    return {
        "code": code,
        "unit": unit or "",
        "description": " ".join(description_tokens).strip(),
        "price_total": price_total,
    }


def extract_breakdown_line(line: LogicalLine) -> Optional[Breakdown]:
    """Extrae un breakdown completo desde una línea `is_breakdown_line == True`.

    Layout observado:
        ``CODE qty unit description... price_unit price_total``
    Las descripciones pueden contener números y comas. Detectamos los precios
    como los 2 últimos números en x >= 400. La cantidad es el primer número
    después del código. La unidad es el primer unit-token después de la qty.
    """
    if not line.words:
        return None
    code = line.words[0].text
    # Tokens tras el código.
    rest = line.words[1:]
    if not rest:
        return None
    # Cantidad = primer número numérico.
    qty: Optional[float] = None
    qty_idx: Optional[int] = None
    for i, w in enumerate(rest):
        if _looks_like_number(w.text):
            qty = _parse_spanish_float(w.text)
            qty_idx = i
            break
    if qty is None:
        return None
    # Unidad = primer token unit después de qty.
    unit: Optional[str] = None
    unit_idx: Optional[int] = None
    for i in range(qty_idx + 1, len(rest)):
        if _is_unit_word(rest[i]):
            unit = rest[i].text
            unit_idx = i
            break
    if unit_idx is None:
        # Algunos breakdowns tienen el unit antes que la qty (ej: `% % Medios...`).
        # Caso especial: la línea empieza con `%`, segundo token también `%`.
        if code == "%" and rest[0].text in ("%", "%CI"):
            unit = "%"
            unit_idx = 0
    if unit is None:
        return None
    # Encontrar los 2 últimos números right-aligned (x >= 400 ideal, pero algunos
    # casos especiales bajan). Tomamos los 2 últimos `_looks_like_number` tokens.
    numbers_with_idx: List[Tuple[int, Word]] = [
        (i, w) for i, w in enumerate(rest) if _looks_like_number(w.text)
    ]
    if len(numbers_with_idx) < 3:
        # Solo qty + 1 precio → un poco raro pero acepta.
        if len(numbers_with_idx) == 2:
            price_unit = _parse_spanish_float(numbers_with_idx[-1][1].text)
            price_total = price_unit
        else:
            return None
    else:
        price_unit = _parse_spanish_float(numbers_with_idx[-2][1].text)
        price_total = _parse_spanish_float(numbers_with_idx[-1][1].text)
    # Descripción = tokens entre la unidad y los últimos 2 números.
    # NO incluye qty, unit ni los 2 precios.
    excluded_idx = {qty_idx, unit_idx}
    if len(numbers_with_idx) >= 2:
        excluded_idx.add(numbers_with_idx[-1][0])
        excluded_idx.add(numbers_with_idx[-2][0])
    desc_tokens = [w.text for i, w in enumerate(rest) if i not in excluded_idx]
    description = " ".join(desc_tokens).strip()

    return Breakdown(
        code=code,
        quantity=qty if qty is not None else 0.0,
        unit=unit,
        description=description,
        price_unit=price_unit if price_unit is not None else 0.0,
        price_total=price_total if price_total is not None else 0.0,
    )


# ---------------------------------------------------------------------------
# Bold price detection (la línea sola con el precio total de la partida)
# ---------------------------------------------------------------------------


def _is_bold_price_only_line(line: LogicalLine) -> Optional[float]:
    """Una línea con un único número en Bold, right-aligned, indica el precio
    total de la PRÓXIMA partida (el catálogo coloca el precio justo encima del
    código). Devuelve el float o ``None``.
    """
    if not line.words:
        return None
    # Filtrar tokens útiles (≥1 número, todos bold, x>=500).
    non_trivial = [w for w in line.words if w.text.strip()]
    if len(non_trivial) != 1:
        return None
    w = non_trivial[0]
    if not w.is_bold():
        return None
    if w.x0 < PARTIDA_PRICE_X_MIN:
        return None
    if not _looks_like_number(w.text):
        return None
    return _parse_spanish_float(w.text)


# ---------------------------------------------------------------------------
# TOC parsing (LAYOUT_SPEC §3.5)
# ---------------------------------------------------------------------------


def parse_toc_page(page) -> List[TocEntry]:
    """Parsea una página TOC produciendo entradas (level, title, page_imprinted).

    Reglas:
    - Línea empieza con `••` → nivel 2.
    - Línea empieza con `•`  → nivel 1.
    - El número impreso, si está, se extrae como último token numérico de la
      línea (puede no estar y entonces queda ``None``).
    """
    entries: List[TocEntry] = []
    words = _extract_words(page)
    if not words:
        return entries
    lines = _group_into_lines(words)
    body_lines, _footer = _separate_regions(lines, page.height)
    for line in body_lines:
        text = line.text().strip()
        if not text:
            continue
        # Detectar nivel.
        level: Optional[int] = None
        title_start = 0
        # Probar nivel 2 primero (••).
        if text.startswith(_TOC_LEVEL2_PREFIX):
            level = 2
            title_start = len(_TOC_LEVEL2_PREFIX)
        elif text.startswith(_TOC_LEVEL1_PREFIX):
            level = 1
            title_start = len(_TOC_LEVEL1_PREFIX)
        else:
            continue
        # Strip dot leaders y página impresa.
        body = text[title_start:].strip()
        # Última palabra puede ser número impreso.
        last_word = line.words[-1].text if line.words else ""
        page_imprinted: Optional[int] = None
        if last_word.isdigit():
            try:
                page_imprinted = int(last_word)
                # Removerlo del body si está al final.
                body = body[: body.rfind(last_word)].rstrip()
            except ValueError:
                page_imprinted = None
        # Strip dot leaders (`....` o `..`).
        body = re.sub(r"\s*\.{2,}\s*", " ", body).strip()
        if not body:
            continue
        entries.append(TocEntry(level=level, title=body, page_imprinted=page_imprinted))
    return entries


# ---------------------------------------------------------------------------
# Main extraction pipeline
# ---------------------------------------------------------------------------


def _avg_size(words: List[Word]) -> float:
    sizes = [w.size for w in words if w.size > 0]
    return sum(sizes) / max(1, len(sizes))


def _strip_unicode_super(unit: str) -> str:
    """Normaliza ``m²`` → ``m2`` y ``m³`` → ``m3`` para comparar con el JSON."""
    return unit.replace("²", "2").replace("³", "3")


def extract_catalog(pdf_path: Path, page_filter: Optional[Iterable[int]] = None) -> CatalogExtraction:
    """Extrae el catálogo completo del PDF.

    Args:
        pdf_path: Path al PDF.
        page_filter: Opcional, si se pasa solo procesa esas páginas físicas
            (1-based). Útil para tests / debug.
    """
    items: List[Partida] = []
    toc: List[TocEntry] = []
    classifications: List[PageClassification] = []

    current_chapter: Optional[str] = None
    current_subchapter: Optional[str] = None
    current_item: Optional[Partida] = None
    pending_price_total: Optional[float] = None

    start = time.time()

    with pdfplumber.open(str(pdf_path)) as pdf:
        total_pages = len(pdf.pages)

        # PASS 0 — recopilar capítulos canónicos desde chapter covers + TOC.
        # Esto permite resolver footers truncados (`…`) a posteriori.
        global _CANONICAL_CHAPTERS
        canonical: List[str] = []
        # Heurística rápida: las chapter_cover tienen muy pocas words. Recorre
        # solo las páginas con conteo bajo para limitar el coste.
        for page_no in range(1, total_pages + 1):
            if page_filter is not None and page_no not in set(page_filter):
                continue
            page = pdf.pages[page_no - 1]
            if classify_page(page) != PAGE_TYPE_CHAPTER_COVER:
                continue
            title = extract_chapter_title_from_cover(page)
            if title and title not in canonical:
                canonical.append(title)
        _CANONICAL_CHAPTERS = canonical

        for page_no in range(1, total_pages + 1):
            if page_filter is not None and page_no not in set(page_filter):
                continue
            page = pdf.pages[page_no - 1]
            words = _extract_words(page)
            page_type = classify_page(page)
            ch_footer, sub_footer = parse_footer(page)
            classifications.append(PageClassification(
                page_no=page_no,
                page_type=page_type,
                word_count=len(words),
                footer_text=f"{ch_footer} {sub_footer}" if ch_footer else None,
                horizontal_lines=_detect_horizontal_lines(page),
            ))

            if page_type in (PAGE_TYPE_PDF_COVER, PAGE_TYPE_ADVERTISEMENT):
                continue

            if page_type == PAGE_TYPE_TOC:
                # Cerrar item pendiente.
                if current_item is not None:
                    items.append(current_item)
                    current_item = None
                    pending_price_total = None
                toc.extend(parse_toc_page(page))
                continue

            if page_type == PAGE_TYPE_CHAPTER_COVER:
                # Cerrar item pendiente.
                if current_item is not None:
                    items.append(current_item)
                    current_item = None
                    pending_price_total = None
                title = extract_chapter_title_from_cover(page)
                if title:
                    current_chapter = title
                # El footer en chapter_cover ya muestra el primer subcap del nuevo capítulo.
                if sub_footer:
                    current_subchapter = sub_footer
                continue

            # Content page.
            # Actualizar chapter/subchapter desde el footer (source-of-truth por página).
            if ch_footer:
                current_chapter = ch_footer
            if sub_footer:
                current_subchapter = sub_footer

            lines = _group_into_lines(words)
            body_lines, _footer_lines = _separate_regions(lines, page.height)
            avg_sz = _avg_size(words)

            for line in body_lines:
                # 1. Línea con solo un precio en bold right-aligned → precio_total
                #    de la próxima partida.
                price_only = _is_bold_price_only_line(line)
                if price_only is not None:
                    pending_price_total = price_only
                    continue

                # 2. Sub-capítulo bold.
                if is_subchapter_bold(line, avg_sz):
                    if current_item is not None:
                        items.append(current_item)
                        current_item = None
                        pending_price_total = None
                    current_subchapter = line.text().strip()
                    continue

                # 3. Partida.
                if is_partida_line(line):
                    if current_item is not None:
                        items.append(current_item)
                    parts = extract_partida_line(line)
                    if parts is None:
                        continue
                    # El precio total preferido es el `pending_price_total` (línea
                    # solo-bold encima del código), porque normalmente el código está
                    # en una y diferente del precio total.
                    price_total = pending_price_total
                    if price_total is None:
                        price_total = parts.get("price_total")
                    current_item = Partida(
                        code=parts["code"],
                        unit=_strip_unicode_super(parts["unit"]),
                        description=parts["description"],
                        price_total=price_total if price_total is not None else 0.0,
                        chapter=current_chapter,
                        subchapter=current_subchapter,
                        page_physical=page_no,
                    )
                    pending_price_total = None
                    continue

                # 4. Breakdown.
                if is_breakdown_line(line) and current_item is not None:
                    bd = extract_breakdown_line(line)
                    if bd is not None:
                        bd.unit = _strip_unicode_super(bd.unit)
                        current_item.breakdowns.append(bd)
                    continue

                # 5. Continuación de descripción (no partida, no breakdown, ni bold-solo).
                if current_item is not None:
                    extra = line.text().strip()
                    if extra and len(extra) > 1 and not _PAGINA_HEADER_PATTERN.match(extra):
                        current_item.description = (current_item.description + " " + extra).strip()

    # Cerrar último item.
    if current_item is not None:
        items.append(current_item)

    elapsed = time.time() - start
    chapters = sorted({it.chapter for it in items if it.chapter})
    subchapters = sorted({(it.chapter, it.subchapter) for it in items if it.subchapter})

    extraction = CatalogExtraction(
        source_pdf=str(pdf_path),
        extracted_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        stats={
            "total_pages": total_pages,
            "total_items": len(items),
            "total_breakdowns": sum(len(it.breakdowns) for it in items),
            "chapters_count": len(chapters),
            "subchapters_count": len(subchapters),
            "toc_entries": len(toc),
            "elapsed_seconds": round(elapsed, 2),
            "page_type_counts": _page_type_counts(classifications),
        },
        items=items,
        toc=toc,
        page_classifications=classifications,
    )
    return extraction


def _page_type_counts(classifications: List[PageClassification]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for c in classifications:
        counts[c.page_type] = counts.get(c.page_type, 0) + 1
    return counts


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract COAATMCA catalogue from the PDF, per LAYOUT_SPEC.md.",
    )
    parser.add_argument(
        "--pdf",
        default="docs/Palma47_2025_COAATMCA.pdf",
        help="Path al PDF del catálogo (relativo al repo root o absoluto).",
    )
    parser.add_argument(
        "--output",
        default="data/catalog_source/pdf_extracted_catalog.json",
        help="Path JSON output.",
    )
    parser.add_argument(
        "--pages",
        default=None,
        help="Opcional, coma-separadas, páginas físicas a procesar (1-based).",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Verbose logging.",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
    )

    # Resolver paths.
    repo_root = Path(__file__).resolve().parents[3]
    pdf_path = Path(args.pdf)
    if not pdf_path.is_absolute():
        pdf_path = (repo_root / pdf_path).resolve()
    if not pdf_path.exists():
        logger.error(f"PDF no encontrado: {pdf_path}")
        return 1
    out_path = Path(args.output)
    if not out_path.is_absolute():
        out_path = (repo_root / out_path).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    page_filter: Optional[List[int]] = None
    if args.pages:
        page_filter = [int(p.strip()) for p in args.pages.split(",") if p.strip()]

    logger.info(f"Extrayendo catálogo de {pdf_path} ...")
    extraction = extract_catalog(pdf_path, page_filter=page_filter)
    out_path.write_text(
        json.dumps(extraction.to_dict(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    stats = extraction.stats
    logger.info(f"Output: {out_path}")
    logger.info(f"  total_items_extracted       = {stats['total_items']}")
    logger.info(f"  total_breakdowns_extracted  = {stats['total_breakdowns']}")
    logger.info(f"  chapters_count              = {stats['chapters_count']}")
    logger.info(f"  subchapters_count           = {stats['subchapters_count']}")
    logger.info(f"  toc_entries                 = {stats['toc_entries']}")
    logger.info(f"  elapsed                     = {stats['elapsed_seconds']}s")
    logger.info(f"  page_type_counts            = {stats['page_type_counts']}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())

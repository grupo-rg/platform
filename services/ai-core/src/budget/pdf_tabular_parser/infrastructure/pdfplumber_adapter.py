"""pdfplumber adapter — extrae palabras con coordenadas desde un PDF.

Encapsula el I/O con pdfplumber para que la aplicación trabaje sobre
dominio puro (TabularWord) sin acoplarse a la lib.
"""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import Iterator, List, Tuple

import pdfplumber

from src.budget.pdf_tabular_parser.domain.row import TabularWord

# Parametros de extract_words. Empíricamente para PDFs PRESTO:
# - x_tolerance=3: palabras separadas por <3pt se fusionan.
# - y_tolerance=3: palabras separadas verticalmente por <3pt se consideran
#   misma línea.
# - keep_blank_chars=False: descarta whitespace puro.
# - use_text_flow=False: orden estricto por posición, no por flujo lectura.
_EXTRACT_WORDS_OPTS = {
    "x_tolerance": 3,
    "y_tolerance": 3,
    "keep_blank_chars": False,
    "use_text_flow": False,
    "horizontal_ltr": True,
    "vertical_ttb": True,
    "extra_attrs": [],
}


@dataclass
class PageData:
    """Bundle de datos de una página."""

    page_number: int  # 1-indexed
    width: float
    height: float
    words: List[TabularWord]
    raw_text: str = ""


def iter_pages(pdf_bytes: bytes) -> Iterator[PageData]:
    """Itera por las páginas del PDF emitiendo PageData con palabras+coords.

    Usa BytesIO para no escribir a disco. pdfplumber cierra el doc al exit
    del context manager.
    """
    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        for idx, page in enumerate(pdf.pages, start=1):
            raw_words = page.extract_words(**_EXTRACT_WORDS_OPTS) or []
            tabular_words = [
                TabularWord(
                    text=str(w.get("text", "")),
                    x0=float(w.get("x0", 0.0)),
                    x1=float(w.get("x1", 0.0)),
                    top=float(w.get("top", 0.0)),
                    bottom=float(w.get("bottom", 0.0)),
                    page_number=idx,
                )
                for w in raw_words
                if w.get("text")
            ]
            raw_text = page.extract_text() or ""
            yield PageData(
                page_number=idx,
                width=float(page.width or 0.0),
                height=float(page.height or 0.0),
                words=tabular_words,
                raw_text=raw_text,
            )


def page_count(pdf_bytes: bytes) -> int:
    """Cuenta páginas sin extraer texto (cheap)."""
    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        return len(pdf.pages)

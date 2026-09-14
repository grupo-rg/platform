"""Detector de PÁGINAS DE PRECIOS de un libro COAATMCA (preview rápido para la UI).

Un libro de precios PDF trae, entre las páginas de precios, portadas, publicidad,
índices y separadores de capítulo que NO deben ingestarse. Este detector clasifica
cada página por DENSIDAD (importes + códigos + imágenes) — señal determinista, sin
LLM y agnóstica al formato: una página de precios es una tabla densa de importes y
códigos; una promo/portada tiene importes = 0. Sirve para el paso "confirmar
páginas" de la UI: la máquina propone los rangos, el humano los ajusta.

Es RÁPIDO (PyMuPDF/fitz, solo texto) para no bloquear el request del preview. La
extracción real (Fase posterior) usa el clasificador de layout preciso
(`classify_page`, pdfplumber) sobre las páginas ya confirmadas.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Tuple

# Importes: 1.234,56 / 12,34 (formato es-ES con coma decimal).
_PRICE_RE = re.compile(r"\d{1,3}(?:\.\d{3})*,\d{2}")
# Códigos de partida/recurso COAATMCA: 2 letras + 2 dígitos + resto (mt01ard, mo008, mq04…).
_CODE_RE = re.compile(r"\b[a-zA-Z]{2}\d{2}[a-zA-Z0-9]*\b")

# Umbrales de la señal de densidad. Permisivos pero PROMO-SAFE: las promos/portadas
# traen 0 importes y 0 códigos, así que exigir ≥ unos pocos las excluye por completo,
# a la vez que caza páginas de precios escasas (finales de capítulo, descripciones largas).
_MIN_PRICES = 4
_MIN_CODES = 3


@dataclass
class PageSignal:
    page: int          # 1-based
    prices: int
    codes: int
    images: int
    is_price: bool


@dataclass
class PageDetection:
    total_pages: int
    price_page_count: int
    ranges: List[Tuple[int, int]]           # rangos contiguos [inicio, fin] 1-based
    pages: List[PageSignal] = field(default_factory=list)
    signal: str = "density-v1(prices>=%d,codes>=%d)" % (_MIN_PRICES, _MIN_CODES)

    def to_dict(self) -> dict:
        return {
            "total_pages": self.total_pages,
            "price_page_count": self.price_page_count,
            "ranges": [[a, b] for a, b in self.ranges],
            "pages": [
                {"page": p.page, "prices": p.prices, "codes": p.codes,
                 "images": p.images, "is_price": p.is_price}
                for p in self.pages
            ],
            "signal": self.signal,
        }


def _contiguous_ranges(nums: List[int]) -> List[Tuple[int, int]]:
    """Comprime una lista ordenada de páginas en rangos contiguos."""
    if not nums:
        return []
    ranges: List[Tuple[int, int]] = []
    start = prev = nums[0]
    for n in nums[1:]:
        if n == prev + 1:
            prev = n
        else:
            ranges.append((start, prev))
            start = prev = n
    ranges.append((start, prev))
    return ranges


def detect_price_pages(pdf_bytes: bytes) -> PageDetection:
    """Clasifica cada página del PDF como de precios o no, por densidad.

    Devuelve `PageDetection` con los rangos de páginas de precios (para el
    filmstrip de la UI) + la señal por página. No escribe nada.
    """
    import fitz  # PyMuPDF — import diferido (pesado en cold start si no se usa).

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        pages: List[PageSignal] = []
        price_nums: List[int] = []
        for i in range(doc.page_count):
            page = doc.load_page(i)
            text = page.get_text() or ""
            n_prices = len(_PRICE_RE.findall(text))
            n_codes = len(_CODE_RE.findall(text))
            n_images = len(page.get_images())
            is_price = n_prices >= _MIN_PRICES and n_codes >= _MIN_CODES
            pages.append(PageSignal(i + 1, n_prices, n_codes, n_images, is_price))
            if is_price:
                price_nums.append(i + 1)
        return PageDetection(
            total_pages=doc.page_count,
            price_page_count=len(price_nums),
            ranges=_contiguous_ranges(price_nums),
            pages=pages,
        )
    finally:
        doc.close()

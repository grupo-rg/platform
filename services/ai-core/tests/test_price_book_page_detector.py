"""Detector de páginas de precios (preview del asistente de actualización del libro).

La señal de densidad (importes + códigos) separa página de precios de promo/portada:
las promos traen 0 importes y 0 códigos. Reune las páginas de precios en rangos
contiguos para el filmstrip de la UI (compuerta 1: confirmar páginas).
"""
from __future__ import annotations

from src.budget.catalog.price_book_page_detector import (
    detect_price_pages,
    _contiguous_ranges,
)


def _make_pdf(pages_text: list[str]) -> bytes:
    import fitz
    doc = fitz.open()
    for txt in pages_text:
        page = doc.new_page()
        page.insert_text((72, 72), txt)
    data = doc.tobytes()
    doc.close()
    return data


# ---- rangos contiguos ------------------------------------------------------

def test_contiguous_ranges():
    assert _contiguous_ranges([1, 2, 3, 5, 6, 9]) == [(1, 3), (5, 6), (9, 9)]
    assert _contiguous_ranges([7]) == [(7, 7)]
    assert _contiguous_ranges([]) == []


# ---- detección precio vs promo ---------------------------------------------

_PRICE_PAGE = "DEH020 71,66 mq05mai030 4,70 mo001 31,11 mo021 25,99 mt01ard 12,34"
_PROMO_PAGE = "OFERTA ESPECIAL — visita nuestra web — publicidad del fabricante"


def test_detects_price_and_promo_pages():
    pdf = _make_pdf([_PROMO_PAGE, _PRICE_PAGE, _PRICE_PAGE, _PROMO_PAGE])
    d = detect_price_pages(pdf)

    assert d.total_pages == 4
    flags = [p.is_price for p in d.pages]
    assert flags == [False, True, True, False]
    assert d.price_page_count == 2
    assert d.ranges == [(2, 3)]


def test_promo_page_has_zero_signal():
    pdf = _make_pdf([_PROMO_PAGE])
    d = detect_price_pages(pdf)
    p = d.pages[0]
    assert p.prices == 0 and p.codes == 0
    assert p.is_price is False
    assert d.price_page_count == 0


def test_price_page_meets_thresholds():
    pdf = _make_pdf([_PRICE_PAGE])
    p = detect_price_pages(pdf).pages[0]
    assert p.prices >= 4        # 5 importes
    assert p.codes >= 3         # mq05mai030, mo001, mo021, mt01ard
    assert p.is_price is True


def test_to_dict_shape():
    d = detect_price_pages(_make_pdf([_PRICE_PAGE]))
    out = d.to_dict()
    assert set(out) == {"total_pages", "price_page_count", "ranges", "pages", "signal"}
    assert out["ranges"] == [[1, 1]]
    assert out["pages"][0]["is_price"] is True

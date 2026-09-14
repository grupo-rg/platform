"""Tests de la ingesta del libro (Fase 4c) — foco en el mapeo extracción→transformer."""

from __future__ import annotations

from types import SimpleNamespace

from src.budget.catalog.application.services.catalog_transformer import CatalogTransformer
from src.budget.catalog.application.use_cases.ingest_price_book_job_uc import (
    _extraction_to_source_chapters,
    staging_collection_for,
)


def _bk(code, desc, unit, qty, pu, pt):
    return SimpleNamespace(
        code=code, description=desc, unit=unit, quantity=qty, price_unit=pu, price_total=pt
    )


def _item(code, unit, desc, pt, chapter, subchapter, page, bks):
    return SimpleNamespace(
        code=code, unit=unit, description=desc, price_total=pt,
        chapter=chapter, subchapter=subchapter, page_physical=page, breakdowns=bks,
    )


def _extraction(items):
    return SimpleNamespace(items=items)


def test_staging_collection_name():
    assert staging_collection_for(2026) == "price_book_2026_staging"


def test_mapping_groups_by_chapter_and_maps_fields():
    ex = _extraction([
        _item("EHV010", "m3", "Viga", 854.8, "ESTRUCTURAS", "Hormigón", 61,
              [_bk("mo001", "Oficial 1ª", "h", 2.0, 31.11, 62.22)]),
        _item("EHV005", "m3", "Otra viga", 872.77, "ESTRUCTURAS", "Hormigón", 61, []),
        _item("FFZ020", "m2", "Fábrica", 43.6, "FACHADAS", "Bloque", 80, []),
    ])
    chapters = _extraction_to_source_chapters(ex)
    # dos capítulos, en orden de aparición
    assert [c["chapter"] for c in chapters] == ["ESTRUCTURAS", "FACHADAS"]
    estructuras = chapters[0]
    assert len(estructuras["items"]) == 2
    it0 = estructuras["items"][0]
    assert it0["code"] == "EHV010"
    assert it0["priceTotal"] == 854.8      # price_total -> priceTotal
    assert it0["section"] == "Hormigón"     # subchapter -> section
    assert it0["page"] == 61                # page_physical -> page
    bk0 = it0["breakdown"][0]
    assert bk0["code"] == "mo001"
    assert bk0["price"] == 62.22            # price_total -> price
    assert bk0["price_unit"] == 31.11


def test_mapping_output_feeds_real_transformer():
    """El contrato clave: el mapeo produce dicts que CatalogTransformer acepta
    sin descartar items ni breakdowns."""
    ex = _extraction([
        _item("EHV010", "m3", "Viga descolgada", 854.8, "ESTRUCTURAS", "Hormigón", 61,
              [_bk("mo001", "Oficial 1ª", "h", 2.0, 31.11, 62.22),
               _bk("mt01", "Hormigón", "m3", 1.05, 90.0, 94.5)]),
    ])
    chapters = _extraction_to_source_chapters(ex)
    items, breakdowns = CatalogTransformer.transform(chapters)
    assert len(items) == 1
    assert items[0].code == "EHV010"
    assert items[0].chapter == "ESTRUCTURAS"
    assert items[0].priceTotal == 854.8
    assert len(breakdowns) == 2
    assert {b.code for b in breakdowns} == {"mo001", "mt01"}
    # el padre referencia a sus hijos por doc_id compound
    assert items[0].breakdown_ids == ["EHV010#01", "EHV010#02"]


def test_missing_chapter_defaults():
    ex = _extraction([_item("X01", "u", "d", 1.0, None, None, 5, [])])
    chapters = _extraction_to_source_chapters(ex)
    assert chapters[0]["chapter"] == "SIN CAPÍTULO"
    assert chapters[0]["items"][0]["section"] == ""

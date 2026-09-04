"""CODE-FIRST matching para BC3 con códigos de libro base (CYPE/COAATMCA).

Cuando una partida trae un código del libro (p.ej. un BC3 de Arquímedes/Presto),
casamos 1:1 a esa entrada del catálogo por CÓDIGO — exacto o por raíz base CYPE
(`CAV010M2`→`CAV010`) — en vez de dejar que caiga a from_scratch (que sobre-precia
estructura 2-6×). Los códigos propios del autor (`04.03`, `ZTPB`) no matchean →
el pipeline usa búsqueda semántica como siempre.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from src.budget.application.ports.ports import IVectorSearch
from src.budget.catalog.application.services.hybrid_catalog_search import (
    HybridCatalogSearch,
    cype_base_code,
)
from src.budget.catalog.domain.price_book_entry import PriceBookItemEntry
from src.budget.application.services.swarm_pricing_service import _descriptions_similar


def _item(code: str, desc: str, price: float = 100.0) -> PriceBookItemEntry:
    return PriceBookItemEntry(
        code=code, chapter="02 ESTRUCTURA", section="", description=desc,
        unit_raw="m³", unit_normalized="m3", unit_dimension="volume",
        priceTotal=price, breakdown_ids=[],
    )


class _NoopVectorSearch(IVectorSearch):
    def search_similar_items(self, query_vector, query_text="", limit=3,
                             score_threshold=0.5, chapter_filters=None,
                             partida_unit_dimension=None) -> List[Dict[str, Any]]:
        return []


def _search() -> HybridCatalogSearch:
    items = [
        _item("CAV010", "Viga de atado de hormigón armado HA-25", 368.03),
        _item("EHS010", "Pilar de sección rectangular de hormigón armado", 934.50),
        _item("ADL010", "Desbroce y limpieza del terreno con arbustos", 2.74),
        _item("UJA050", "Aporte de tierra vegetal cribada, suministrada a granel", 58.33),
    ]
    return HybridCatalogSearch(items, _NoopVectorSearch())


# ---- cype_base_code ------------------------------------------------------

def test_base_code_recorta_a_raiz_LLL_NNN():
    assert cype_base_code("CAV010M2") == "CAV010"
    assert cype_base_code("EHM010M3") == "EHM010"
    assert cype_base_code("EHS01044") == "EHS010"   # dígitos extra → raíz de 3
    assert cype_base_code("ADL010") == "ADL010"

def test_base_code_none_para_codigos_propios():
    assert cype_base_code("04.03") is None
    assert cype_base_code("ZTPB") is None
    assert cype_base_code("") is None
    assert cype_base_code(None) is None


# ---- lookup_by_code ------------------------------------------------------

def test_lookup_exacto():
    r = _search().lookup_by_code("ADL010")
    assert r is not None
    assert r["catalog_code"] == "ADL010" and r["match_kind_code"] == "exact"
    assert r["priceTotal"] == 2.74

def test_lookup_case_insensitive():
    assert _search().lookup_by_code("adl010")["catalog_code"] == "ADL010"

def test_lookup_por_base_cype():
    # CAV010M2 (variante) → CAV010 (raíz en catálogo).
    r = _search().lookup_by_code("CAV010M2")
    assert r is not None
    assert r["catalog_code"] == "CAV010" and r["match_kind_code"] == "base"
    assert r["priceTotal"] == 368.03

def test_lookup_digitos_extra_por_base():
    # EHS01044 (Pilar P4) → EHS010 (pilar genérico) por raíz.
    r = _search().lookup_by_code("EHS01044")
    assert r is not None and r["catalog_code"] == "EHS010" and r["match_kind_code"] == "base"

def test_lookup_codigo_propio_no_matchea():
    assert _search().lookup_by_code("04.03") is None
    assert _search().lookup_by_code("ZTPB") is None
    assert _search().lookup_by_code(None) is None


# ---- gate de divergencia de descripción ----------------------------------

def test_descripciones_iguales_no_divergen():
    assert _descriptions_similar(
        "Desbroce y limpieza del terreno con arbustos y tocones",
        "Desbroce y limpieza del terreno con arbustos, con medios mecánicos",
    ) is True

def test_descripciones_de_material_distinto_divergen():
    # UJA050 reutilizado: BC3 dice 'grava', catálogo dice 'tierra vegetal'.
    assert _descriptions_similar(
        "Aporte de grava lavada y extendido",
        "Aporte de tierra vegetal cribada, suministrada a granel y extendida",
    ) is False

def test_similitud_vacia_es_falsa():
    assert _descriptions_similar("", "algo") is False
    assert _descriptions_similar(None, None) is False

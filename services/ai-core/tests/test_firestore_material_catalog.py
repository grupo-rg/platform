"""Tests del adapter `FirestoreMaterialCatalogAdapter` (vector search materiales).

Mockeamos Firestore: la query `find_nearest` devuelve docs con embedding y el
adapter debe (a) calcular el coseno, (b) aplicar boost léxico, (c) ordenar por
matchScore desc, (d) nunca lanzar.
"""
from __future__ import annotations

from src.budget.catalog.infrastructure.adapters.firestore_material_catalog import (
    FirestoreMaterialCatalogAdapter,
)


class _FakeDoc:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data

    def to_dict(self):
        return dict(self._data)


class _FakeVectorQuery:
    def __init__(self, docs):
        self._docs = docs

    def get(self):
        return self._docs


class _FakeCollection:
    def __init__(self, docs):
        self._docs = docs
        self.last_category = None

    def where(self, filter=None):  # noqa: A002 - firma Firestore
        # Guardamos que se pidió filtro por categoría (comprobable en tests).
        self.last_category = getattr(filter, "value", None)
        return self

    def find_nearest(self, vector_field, query_vector, distance_measure, limit):
        return _FakeVectorQuery(self._docs[:limit])


class _FakeDB:
    def __init__(self, docs):
        self._coll = _FakeCollection(docs)

    def collection(self, name):
        return self._coll


def _material(doc_id, name, emb, price=10.0, category="X", unit="ud", desc=""):
    return _FakeDoc(doc_id, {
        "sku": doc_id, "name": name, "description": desc, "unit": unit,
        "price": price, "category": category, "embedding": emb,
    })


class TestSearchMaterials:
    def test_ranks_by_cosine(self):
        # doc A idéntico a la query (coseno 1); doc B ortogonal (coseno 0).
        q = [1.0, 0.0, 0.0]
        docs = [
            _material("B-ortho", "Material ortogonal", [0.0, 1.0, 0.0]),
            _material("A-exact", "Material exacto", [1.0, 0.0, 0.0]),
        ]
        adapter = FirestoreMaterialCatalogAdapter(db=_FakeDB(docs))
        res = adapter.search_materials(query_vector=q, limit=2)
        assert res[0]["sku"] == "A-exact"
        assert res[0]["matchScore"] > res[1]["matchScore"]
        assert "embedding" not in res[0]  # no se filtra el embedding al pricing

    def test_lexical_boost_applies(self):
        q = [1.0, 0.0, 0.0]
        docs = [
            _material("A", "grava caliza 40mm", [1.0, 0.0, 0.0], desc="árido"),
        ]
        adapter = FirestoreMaterialCatalogAdapter(db=_FakeDB(docs))
        base = adapter.search_materials(query_vector=q, limit=1)[0]["matchScore"]
        boosted = adapter.search_materials(query_vector=q, query_text="grava caliza", limit=1)[0]["matchScore"]
        assert boosted > base  # keywords presentes → score mayor

    def test_returns_expected_fields(self):
        q = [1.0, 0.0, 0.0]
        docs = [_material("SKU1", "Cemento", [1.0, 0.0, 0.0], price=6.26, unit="saco", category="CEMENTOS")]
        adapter = FirestoreMaterialCatalogAdapter(db=_FakeDB(docs))
        r = adapter.search_materials(query_vector=q, limit=1)[0]
        assert r["sku"] == "SKU1" and r["price"] == 6.26 and r["unit"] == "saco"
        assert r["category"] == "CEMENTOS" and "matchScore" in r

    def test_never_raises_returns_empty_on_error(self):
        class _BoomDB:
            def collection(self, name):
                raise RuntimeError("boom")
        adapter = FirestoreMaterialCatalogAdapter(db=_BoomDB())
        assert adapter.search_materials(query_vector=[1.0], limit=3) == []

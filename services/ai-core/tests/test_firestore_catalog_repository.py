"""Fase 1.4 — tests del port `ICatalogRepository` y su adapter Firestore.

Estrategia:
  1. Tests del CONTRATO del port via un fake in-memory (`InMemoryCatalogRepository`)
     que también vive en el repo y sirve para otros tests (service, etc.).
  2. Tests del ADAPTER `FirestoreCatalogRepository` con el cliente de Firestore
     mockeado — no tocamos producción en CI.

Métodos del port:
  - `async get_labor_rate_by_id(id)` → LaborRate | None
  - `async find_labor_rates(query, trade?, limit)` → List[LaborRate] (fuzzy)
  - `async save_labor_rate(lr)` → None
  - `async save_labor_rates_batch(lrs)` → None
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest

from src.budget.catalog.application.ports.catalog_repository import ICatalogRepository
from src.budget.catalog.domain.entities import LaborRate
from src.budget.catalog.infrastructure.adapters.firestore_catalog_repository import (
    FirestoreCatalogRepository,
)
from src.budget.catalog.infrastructure.adapters.in_memory_catalog_repository import (
    InMemoryCatalogRepository,
)


def _make_rate(
    id: str = "labor-oficial-1a-albanil",
    category: str = "oficial_1a",
    trade: str | None = "albañileria",
    rate: float = 28.50,
    aliases: list[str] | None = None,
) -> LaborRate:
    return LaborRate(
        id=id,
        category=category,  # type: ignore[arg-type]
        trade=trade,
        label_es=f"Test {category} {trade or ''}".strip(),
        rate_eur_hour=rate,
        source_book="COAATMCA_2025",
        source_page=7,
        aliases=aliases or [],
    )


# -------- Contrato del port (vía fake in-memory) --------------------------------------


class TestInMemoryCatalogRepositoryContract:
    """El fake debe cumplir el contrato del port. Sirve como referencia viva."""

    def test_implements_port_interface(self) -> None:
        assert isinstance(InMemoryCatalogRepository(), ICatalogRepository)

    def test_save_and_get_by_id(self) -> None:
        repo = InMemoryCatalogRepository()
        lr = _make_rate()
        asyncio.run(repo.save_labor_rate(lr))
        got = asyncio.run(repo.get_labor_rate_by_id(lr.id))
        assert got == lr

    def test_get_by_id_returns_none_when_missing(self) -> None:
        repo = InMemoryCatalogRepository()
        assert asyncio.run(repo.get_labor_rate_by_id("non-existent")) is None

    def test_batch_save_is_atomic(self) -> None:
        repo = InMemoryCatalogRepository()
        rates = [
            _make_rate(id="labor-peon-ordinario", category="peon_ordinario", trade=None),
            _make_rate(id="labor-oficial-1a-fontanero", category="oficial_1a", trade="fontaneria"),
        ]
        asyncio.run(repo.save_labor_rates_batch(rates))
        for lr in rates:
            got = asyncio.run(repo.get_labor_rate_by_id(lr.id))
            assert got == lr

    def test_find_by_category_exact(self) -> None:
        repo = InMemoryCatalogRepository()
        asyncio.run(repo.save_labor_rates_batch([
            _make_rate(id="r1", category="oficial_1a", trade="albañileria"),
            _make_rate(id="r2", category="peon_ordinario", trade=None),
        ]))
        results = asyncio.run(repo.find_labor_rates(query="oficial_1a"))
        assert any(r.id == "r1" for r in results)

    def test_find_by_alias(self) -> None:
        repo = InMemoryCatalogRepository()
        asyncio.run(repo.save_labor_rate(
            _make_rate(id="r1", aliases=["oficial 1", "oficial primera"])
        ))
        results = asyncio.run(repo.find_labor_rates(query="oficial primera"))
        assert len(results) >= 1
        assert results[0].id == "r1"

    def test_find_filters_by_trade_when_specified(self) -> None:
        repo = InMemoryCatalogRepository()
        asyncio.run(repo.save_labor_rates_batch([
            _make_rate(id="r1", category="oficial_1a", trade="albañileria"),
            _make_rate(id="r2", category="oficial_1a", trade="fontaneria"),
        ]))
        results = asyncio.run(repo.find_labor_rates(query="oficial_1a", trade="fontaneria"))
        ids = {r.id for r in results}
        assert "r2" in ids
        assert "r1" not in ids

    def test_find_respects_limit(self) -> None:
        repo = InMemoryCatalogRepository()
        for i in range(10):
            asyncio.run(repo.save_labor_rate(
                _make_rate(id=f"r{i}", category="peon_ordinario", trade=None)
            ))
        results = asyncio.run(repo.find_labor_rates(query="peon", limit=3))
        assert len(results) <= 3

    def test_find_returns_empty_when_no_match(self) -> None:
        repo = InMemoryCatalogRepository()
        asyncio.run(repo.save_labor_rate(_make_rate(id="r1")))
        results = asyncio.run(repo.find_labor_rates(query="jefe supremo"))
        assert results == []


# -------- Firestore adapter (con cliente mockeado) ------------------------------------


class _FakeDocSnapshot:
    def __init__(self, data: dict | None, exists: bool = True):
        self._data = data
        self.exists = exists

    def to_dict(self):
        return self._data


class _FakeDocRef:
    def __init__(self, data: dict | None):
        self._data = data
        self.set_calls: list[dict] = []

    def get(self):
        return _FakeDocSnapshot(self._data, exists=self._data is not None)

    def set(self, data):
        self.set_calls.append(data)
        self._data = data


class _FakeBatch:
    def __init__(self):
        self.ops: list[tuple[_FakeDocRef, dict]] = []

    def set(self, ref, data):
        self.ops.append((ref, data))

    def commit(self):
        for ref, data in self.ops:
            ref.set(data)


class _FakeCollection:
    """Colección Firestore mínima para probar el adapter sin red."""

    def __init__(self):
        self.docs: dict[str, _FakeDocRef] = {}

    def document(self, doc_id: str) -> _FakeDocRef:
        return self.docs.setdefault(doc_id, _FakeDocRef(None))

    def stream(self):
        for doc_id, ref in self.docs.items():
            if ref._data is not None:
                snap = _FakeDocSnapshot(ref._data)
                snap.id = doc_id  # type: ignore[attr-defined]
                yield snap


class _FakeFirestoreClient:
    def __init__(self):
        self._collections: dict[str, _FakeCollection] = {}

    def collection(self, name: str) -> _FakeCollection:
        return self._collections.setdefault(name, _FakeCollection())

    def batch(self) -> _FakeBatch:
        return _FakeBatch()


class TestFirestoreCatalogRepositoryAdapter:
    """El adapter escribe/lee en la colección `labor_rates_2025`."""

    def test_save_writes_document_with_entity_id(self) -> None:
        fake_db = _FakeFirestoreClient()
        repo = FirestoreCatalogRepository(db=fake_db)
        lr = _make_rate(id="labor-peon-ordinario", category="peon_ordinario", trade=None)
        asyncio.run(repo.save_labor_rate(lr))

        col = fake_db._collections["labor_rates_2025"]
        doc = col.docs["labor-peon-ordinario"]
        assert doc._data is not None
        assert doc._data["category"] == "peon_ordinario"

    def test_get_by_id_deserializes_into_entity(self) -> None:
        fake_db = _FakeFirestoreClient()
        repo = FirestoreCatalogRepository(db=fake_db)
        lr = _make_rate()
        asyncio.run(repo.save_labor_rate(lr))
        got = asyncio.run(repo.get_labor_rate_by_id(lr.id))
        assert got is not None
        assert got.id == lr.id
        assert got.rate_eur_hour == pytest.approx(lr.rate_eur_hour)

    def test_get_by_id_returns_none_when_not_found(self) -> None:
        fake_db = _FakeFirestoreClient()
        repo = FirestoreCatalogRepository(db=fake_db)
        got = asyncio.run(repo.get_labor_rate_by_id("missing"))
        assert got is None

    def test_batch_save_commits_all_docs(self) -> None:
        fake_db = _FakeFirestoreClient()
        repo = FirestoreCatalogRepository(db=fake_db)
        rates = [
            _make_rate(id="r1", category="oficial_1a", trade="albañileria"),
            _make_rate(id="r2", category="peon_ordinario", trade=None),
        ]
        asyncio.run(repo.save_labor_rates_batch(rates))
        col = fake_db._collections["labor_rates_2025"]
        assert "r1" in col.docs
        assert "r2" in col.docs

    def test_find_filters_by_trade_and_query(self) -> None:
        fake_db = _FakeFirestoreClient()
        repo = FirestoreCatalogRepository(db=fake_db)
        asyncio.run(repo.save_labor_rates_batch([
            _make_rate(id="r1", category="oficial_1a", trade="albañileria",
                       aliases=["oficial 1"]),
            _make_rate(id="r2", category="oficial_1a", trade="fontaneria",
                       aliases=["oficial 1"]),
        ]))
        results = asyncio.run(repo.find_labor_rates(query="oficial", trade="fontaneria"))
        assert {r.id for r in results} == {"r2"}

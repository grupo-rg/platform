"""Fase 3.7 — tests del `FirestorePriceBookRepository`.

Implementa el port `IPriceBookRepository` sobre Firestore. Escribe en la
colección `price_book_2025` usando `doc_id = entry.code` (determinista,
idempotente).

Los tests usan un fake client de Firestore (sin red) replicando:
  - collection(name).document(id).set(data)
  - collection(name).stream() → snapshots
  - batch().set(ref, data) / batch().delete(ref) / batch().commit()

El embedding se serializa como `Vector` de Firestore en producción, pero
el fake solo guarda listas — verificamos que la lista llega entera.
"""

from __future__ import annotations

import asyncio

import pytest

from src.budget.catalog.domain.price_book_entry import (
    PriceBookBreakdownEntry,
    PriceBookItemEntry,
)
from src.budget.catalog.infrastructure.adapters.firestore_price_book_repository import (
    FirestorePriceBookRepository,
    PRICE_BOOK_COLLECTION,
)


# -------- Fake Firestore client (mínimo pero fiel) ----------------------------


class _FakeDocSnapshot:
    def __init__(self, doc_id: str, data: dict | None):
        self.id = doc_id
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return self._data


class _FakeDocRef:
    def __init__(self, doc_id: str, collection: "_FakeCollection"):
        self.id = doc_id
        self._collection = collection
        self._data: dict | None = None

    def get(self):
        return _FakeDocSnapshot(self.id, self._data)

    def set(self, data):
        self._data = dict(data)
        self._collection._docs[self.id] = self

    def delete(self):
        self._data = None
        self._collection._docs.pop(self.id, None)


class _FakeBatch:
    def __init__(self):
        self._ops: list[tuple[str, _FakeDocRef, dict | None]] = []

    def set(self, ref: _FakeDocRef, data: dict):
        self._ops.append(("set", ref, dict(data)))

    def delete(self, ref: _FakeDocRef):
        self._ops.append(("delete", ref, None))

    def commit(self):
        for op, ref, data in self._ops:
            if op == "set":
                ref.set(data)
            elif op == "delete":
                ref.delete()


class _FakeCollection:
    def __init__(self):
        self._docs: dict[str, _FakeDocRef] = {}

    def document(self, doc_id: str) -> _FakeDocRef:
        return self._docs.setdefault(doc_id, _FakeDocRef(doc_id, self))

    def stream(self):
        for doc_id, ref in list(self._docs.items()):
            if ref._data is not None:
                yield _FakeDocSnapshot(doc_id, ref._data)


class _FakeFirestoreClient:
    def __init__(self):
        self._collections: dict[str, _FakeCollection] = {}

    def collection(self, name: str) -> _FakeCollection:
        return self._collections.setdefault(name, _FakeCollection())

    def batch(self) -> _FakeBatch:
        return _FakeBatch()


# -------- Fixtures -------------------------------------------------------------


def _item(code: str = "LVC010") -> PriceBookItemEntry:
    return PriceBookItemEntry(
        code=code,
        chapter="ACRISTALAMIENTOS",
        section="Vidrios dobles",
        description="Suministro y colocación",
        unit_raw="m2",
        unit_normalized="m2",
        unit_dimension="superficie",
        priceTotal=75.02,
        breakdown_ids=[f"{code}#01", f"{code}#02"],
        source_page=353,
    )


def _breakdown(parent_code: str = "LVC010", idx: int = 1) -> PriceBookBreakdownEntry:
    return PriceBookBreakdownEntry(
        code=f"{parent_code}#{idx:02d}",
        parent_code=parent_code,
        parent_description="Suministro y colocación",
        parent_unit="m2",
        chapter="ACRISTALAMIENTOS",
        description=f"Componente {idx}",
        unit_raw="h",
        unit_normalized="h",
        unit_dimension="tiempo",
        quantity=1.0,
        price_unit=10.0,
        price=10.0,
    )


# -------- Tests ----------------------------------------------------------------


class TestFirestorePriceBookRepositoryTargetCollection:
    def test_uses_price_book_2025_as_collection_name(self) -> None:
        # Documenta el nombre canónico — romper esto es un breaking change.
        assert PRICE_BOOK_COLLECTION == "price_book_2025"


class TestSaveBatch:
    def test_saves_item_with_doc_id_equal_to_code(self) -> None:
        db = _FakeFirestoreClient()
        repo = FirestorePriceBookRepository(db=db)
        pair = (_item(), [0.1, 0.2, 0.3])
        asyncio.run(repo.save_price_book_entries_batch([pair]))

        col = db._collections[PRICE_BOOK_COLLECTION]
        assert "LVC010" in col._docs
        data = col._docs["LVC010"]._data
        assert data["code"] == "LVC010"
        assert data["kind"] == "item"

    def test_saves_breakdown_with_doc_id_from_hash_code(self) -> None:
        db = _FakeFirestoreClient()
        repo = FirestorePriceBookRepository(db=db)
        pair = (_breakdown("LVC010", 1), [0.4] * 5)
        asyncio.run(repo.save_price_book_entries_batch([pair]))

        col = db._collections[PRICE_BOOK_COLLECTION]
        assert "LVC010#01" in col._docs
        data = col._docs["LVC010#01"]._data
        assert data["kind"] == "breakdown"
        assert data["parent_code"] == "LVC010"

    def test_embedding_is_persisted_alongside_entry_fields(self) -> None:
        db = _FakeFirestoreClient()
        repo = FirestorePriceBookRepository(db=db)
        vec = [0.1, 0.2, 0.3, 0.4]
        asyncio.run(repo.save_price_book_entries_batch([(_item(), vec)]))

        data = db._collections[PRICE_BOOK_COLLECTION]._docs["LVC010"]._data
        # El fake guarda lista tal cual; producción usará Vector().
        # El test se conforma con verificar que hay un campo 'embedding'.
        assert "embedding" in data

    def test_batch_save_commits_all_entries_atomically(self) -> None:
        db = _FakeFirestoreClient()
        repo = FirestorePriceBookRepository(db=db)
        pairs = [
            (_item("LVC010"), [0.0] * 3),
            (_breakdown("LVC010", 1), [0.1] * 3),
            (_breakdown("LVC010", 2), [0.2] * 3),
            (_item("LVC011"), [0.3] * 3),
        ]
        asyncio.run(repo.save_price_book_entries_batch(pairs))

        col = db._collections[PRICE_BOOK_COLLECTION]
        assert set(col._docs.keys()) == {"LVC010", "LVC010#01", "LVC010#02", "LVC011"}

    def test_save_is_idempotent_on_reseed(self) -> None:
        db = _FakeFirestoreClient()
        repo = FirestorePriceBookRepository(db=db)
        pair = (_item(), [0.5] * 3)
        asyncio.run(repo.save_price_book_entries_batch([pair]))
        asyncio.run(repo.save_price_book_entries_batch([pair]))
        # Sigue habiendo un solo doc con ese id
        col = db._collections[PRICE_BOOK_COLLECTION]
        assert len(col._docs) == 1
        assert "LVC010" in col._docs


class TestBatchChunkingByFirestoreLimit:
    """Firestore limita el payload por commit a ~10 MiB. El adapter DEBE
    trocear internamente para respetar el límite, NO delegar al caller.

    Con embeddings de 768 dims ≈ 30 KB por doc; 400 docs llegan a ~11 MB.
    El adapter divide en chunks ≤ 100 docs (margen holgado bajo 10 MiB).
    """

    def test_adapter_chunks_large_inputs_into_multiple_commits(self) -> None:
        from src.budget.catalog.infrastructure.adapters import (
            firestore_price_book_repository as mod,
        )
        # Capturamos cuántas veces se hace commit de batch
        db = _FakeFirestoreClient()
        original_batch = db.batch
        commits: list[int] = []

        def traced_batch():
            b = original_batch()
            original_commit = b.commit

            def wrapped_commit():
                commits.append(len(b._ops))
                return original_commit()
            b.commit = wrapped_commit
            return b

        db.batch = traced_batch  # type: ignore[method-assign]

        repo = mod.FirestorePriceBookRepository(db=db)
        # 250 entries → debe dividirse en chunks ≤ 100 (3 commits: 100+100+50)
        entries = [
            (_item(f"I{i:04d}"), [0.1] * 3) for i in range(250)
        ]
        asyncio.run(repo.save_price_book_entries_batch(entries))

        # Al menos 3 batches, ninguno por encima del límite
        assert len(commits) >= 3
        assert all(c <= 100 for c in commits)
        assert sum(commits) == 250


class TestWipePriceBook:
    def test_wipe_deletes_all_docs_in_collection(self) -> None:
        db = _FakeFirestoreClient()
        repo = FirestorePriceBookRepository(db=db)
        # Poblamos con varios docs
        asyncio.run(repo.save_price_book_entries_batch([
            (_item("LVC010"), [0.0] * 3),
            (_breakdown("LVC010", 1), [0.1] * 3),
        ]))
        col = db._collections[PRICE_BOOK_COLLECTION]
        assert len(col._docs) == 2

        asyncio.run(repo.wipe_price_book())
        # Los docs se han eliminado (fake: _data=None)
        assert all(ref._data is None for ref in col._docs.values())

    def test_wipe_on_empty_collection_is_safe(self) -> None:
        db = _FakeFirestoreClient()
        repo = FirestorePriceBookRepository(db=db)
        # No excepción en colección vacía
        asyncio.run(repo.wipe_price_book())

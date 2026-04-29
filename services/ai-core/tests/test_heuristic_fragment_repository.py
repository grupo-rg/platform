"""Fase 6.A — tests del port `IHeuristicFragmentRepository` y sus adapters.

Estrategia (espejo de `test_firestore_catalog_repository.py`):
  1. Tests del CONTRATO del port via un fake in-memory
     (`InMemoryHeuristicFragmentRepository`) que sirve de referencia viva +
     backend de tests del service en fases posteriores (6.C).
  2. Tests del ADAPTER `FirestoreHeuristicFragmentRepository` con un cliente
     Firestore mockeado.

Contrato del port:
  - `async save(fragment)` — upsert por `fragment.id`.
  - `async find_by_id(id)` → Fragment | None.
  - `async find_relevant(chapter, description, similarity_threshold=0.70,
    min_count=2, max_age_months=12)` → List[Fragment]:
      * Solo `status='golden'`.
      * Filtra por tag `chapter:{chapter}`.
      * Filtra por edad máxima (`timestamp >= now - max_age_months`).
      * Similitud fuzzy (difflib) entre `description` y
        `context.originalDescription` ≥ similarity_threshold.
      * Si el total de matches < min_count, devuelve [] (no hay evidencia).
      * Orden descendente por similitud.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional

import pytest

from src.budget.domain.entities import (
    HeuristicAIInferenceTrace,
    HeuristicContext,
    HeuristicFragment,
    HeuristicHumanCorrection,
)
from src.budget.learning.application.ports.heuristic_fragment_repository import (
    IHeuristicFragmentRepository,
)
from src.budget.learning.infrastructure.adapters.firestore_heuristic_fragment_repository import (
    FirestoreHeuristicFragmentRepository,
)
from src.budget.learning.infrastructure.adapters.in_memory_heuristic_fragment_repository import (
    InMemoryHeuristicFragmentRepository,
)


# -------- Factory helpers ------------------------------------------------------------


def _make_fragment(
    fragment_id: str = "frag-001",
    chapter: str = "DEMOLICIONES",
    description: str = "Demolición de alicatado en paredes de baño",
    status: str = "golden",
    ai_price: float = 25.0,
    human_price: float = 22.0,
    heuristic_rule: str = "descuento proveedor",
    timestamp: Optional[datetime] = None,
    extra_tags: Optional[list[str]] = None,
) -> HeuristicFragment:
    tags = [f"chapter:{chapter}"]
    if extra_tags:
        tags.extend(extra_tags)
    return HeuristicFragment(
        id=fragment_id,
        sourceType="internal_admin",
        status=status,  # type: ignore[arg-type]
        context=HeuristicContext(
            budgetId="budget-123",
            originalDescription=description,
            originalQuantity=10.0,
            originalUnit="m2",
        ),
        aiInferenceTrace=HeuristicAIInferenceTrace(
            proposedUnitPrice=ai_price,
            aiReasoning="Base price from COAATMCA",
        ),
        humanCorrection=HeuristicHumanCorrection(
            correctedUnitPrice=human_price,
            heuristicRule=heuristic_rule,
        ),
        tags=tags,
        timestamp=timestamp or datetime.now(timezone.utc),
    )


# -------- Contrato del port (vía fake in-memory) --------------------------------------


class TestInMemoryHeuristicFragmentRepositoryContract:
    """El fake debe cumplir el contrato del port."""

    def test_implements_port_interface(self) -> None:
        assert isinstance(
            InMemoryHeuristicFragmentRepository(), IHeuristicFragmentRepository
        )

    def test_save_and_find_by_id(self) -> None:
        repo = InMemoryHeuristicFragmentRepository()
        frag = _make_fragment()
        asyncio.run(repo.save(frag))
        got = asyncio.run(repo.find_by_id(frag.id))
        assert got is not None
        assert got.id == frag.id
        assert got.humanCorrection.correctedUnitPrice == pytest.approx(22.0)

    def test_find_by_id_returns_none_when_missing(self) -> None:
        repo = InMemoryHeuristicFragmentRepository()
        assert asyncio.run(repo.find_by_id("missing")) is None

    def test_save_is_idempotent_upsert(self) -> None:
        repo = InMemoryHeuristicFragmentRepository()
        frag_v1 = _make_fragment(human_price=22.0)
        frag_v2 = _make_fragment(human_price=19.5)
        asyncio.run(repo.save(frag_v1))
        asyncio.run(repo.save(frag_v2))
        got = asyncio.run(repo.find_by_id(frag_v1.id))
        assert got is not None
        assert got.humanCorrection.correctedUnitPrice == pytest.approx(19.5)

    def test_find_relevant_returns_empty_when_no_fragments(self) -> None:
        repo = InMemoryHeuristicFragmentRepository()
        results = asyncio.run(
            repo.find_relevant(
                chapter="DEMOLICIONES",
                description="Demolición de alicatado",
            )
        )
        assert results == []

    def test_find_relevant_ignores_non_golden_fragments(self) -> None:
        repo = InMemoryHeuristicFragmentRepository()
        # Dos pending + uno golden → solo uno golden, por debajo de min_count=2
        # → devuelve [].
        frag_a = _make_fragment(
            fragment_id="f-a",
            description="Demolición de alicatado en baño",
            status="pending_review",
        )
        frag_b = _make_fragment(
            fragment_id="f-b",
            description="Demolición de alicatado en baño",
            status="rejected",
        )
        frag_c = _make_fragment(
            fragment_id="f-c",
            description="Demolición de alicatado en baño",
            status="golden",
        )
        for f in (frag_a, frag_b, frag_c):
            asyncio.run(repo.save(f))
        results = asyncio.run(
            repo.find_relevant(
                chapter="DEMOLICIONES",
                description="Demolición de alicatado en baño de 5 m2",
            )
        )
        assert results == []

    def test_find_relevant_filters_by_chapter_tag(self) -> None:
        repo = InMemoryHeuristicFragmentRepository()
        frag_same_chapter_1 = _make_fragment(
            fragment_id="f1",
            chapter="DEMOLICIONES",
            description="Demolición de alicatado paredes baño",
        )
        frag_same_chapter_2 = _make_fragment(
            fragment_id="f2",
            chapter="DEMOLICIONES",
            description="Demolición de alicatado paredes baño reforma",
        )
        frag_other_chapter = _make_fragment(
            fragment_id="f3",
            chapter="FONTANERIA Y GAS",
            description="Demolición de alicatado paredes baño",
        )
        for f in (frag_same_chapter_1, frag_same_chapter_2, frag_other_chapter):
            asyncio.run(repo.save(f))
        results = asyncio.run(
            repo.find_relevant(
                chapter="DEMOLICIONES",
                description="Demolición alicatado paredes baño",
            )
        )
        ids = {r.id for r in results}
        assert "f3" not in ids
        assert {"f1", "f2"} <= ids

    def test_find_relevant_respects_similarity_threshold(self) -> None:
        repo = InMemoryHeuristicFragmentRepository()
        # Dos fragments claramente similares + uno irrelevante.
        asyncio.run(repo.save(_make_fragment(
            fragment_id="f1",
            description="Demolición de alicatado en paredes de baño",
        )))
        asyncio.run(repo.save(_make_fragment(
            fragment_id="f2",
            description="Demolición de alicatado paredes baño",
        )))
        asyncio.run(repo.save(_make_fragment(
            fragment_id="irrelevant",
            description="Instalación de inodoro con cisterna empotrada",
        )))
        results = asyncio.run(
            repo.find_relevant(
                chapter="DEMOLICIONES",
                description="Demolición alicatado paredes baño",
                similarity_threshold=0.70,
            )
        )
        ids = {r.id for r in results}
        assert "irrelevant" not in ids
        assert {"f1", "f2"} <= ids

    def test_find_relevant_respects_min_count(self) -> None:
        repo = InMemoryHeuristicFragmentRepository()
        # Un único match golden con alta similitud → por debajo de min_count=2.
        asyncio.run(repo.save(_make_fragment(
            fragment_id="f1",
            description="Demolición de alicatado paredes baño",
        )))
        # Varios irrelevantes en el mismo capítulo.
        asyncio.run(repo.save(_make_fragment(
            fragment_id="f-other",
            description="Picado manual de solera armada",
        )))
        results = asyncio.run(
            repo.find_relevant(
                chapter="DEMOLICIONES",
                description="Demolición alicatado paredes baño",
                min_count=2,
            )
        )
        assert results == []

    def test_find_relevant_returns_all_when_above_min_count(self) -> None:
        repo = InMemoryHeuristicFragmentRepository()
        for i in range(3):
            asyncio.run(repo.save(_make_fragment(
                fragment_id=f"f{i}",
                description="Demolición de alicatado paredes baño",
            )))
        results = asyncio.run(
            repo.find_relevant(
                chapter="DEMOLICIONES",
                description="Demolición alicatado paredes baño",
                min_count=2,
            )
        )
        assert len(results) == 3

    def test_find_relevant_filters_by_max_age(self) -> None:
        repo = InMemoryHeuristicFragmentRepository()
        now = datetime.now(timezone.utc)
        # Dos recientes + uno viejo (18 meses atrás).
        asyncio.run(repo.save(_make_fragment(
            fragment_id="recent-1",
            description="Demolición alicatado paredes",
            timestamp=now - timedelta(days=30),
        )))
        asyncio.run(repo.save(_make_fragment(
            fragment_id="recent-2",
            description="Demolición alicatado paredes",
            timestamp=now - timedelta(days=60),
        )))
        asyncio.run(repo.save(_make_fragment(
            fragment_id="too-old",
            description="Demolición alicatado paredes",
            timestamp=now - timedelta(days=30 * 18),
        )))
        results = asyncio.run(
            repo.find_relevant(
                chapter="DEMOLICIONES",
                description="Demolición alicatado paredes",
                max_age_months=12,
            )
        )
        ids = {r.id for r in results}
        assert "too-old" not in ids
        assert {"recent-1", "recent-2"} <= ids

    def test_find_relevant_sorts_by_similarity_desc(self) -> None:
        repo = InMemoryHeuristicFragmentRepository()
        asyncio.run(repo.save(_make_fragment(
            fragment_id="weak",
            description="Demolición parcial de baño antiguo con escombros",
        )))
        asyncio.run(repo.save(_make_fragment(
            fragment_id="strong",
            description="Demolición de alicatado paredes baño",
        )))
        asyncio.run(repo.save(_make_fragment(
            fragment_id="mid",
            description="Demolición alicatado paredes",
        )))
        results = asyncio.run(
            repo.find_relevant(
                chapter="DEMOLICIONES",
                description="Demolición de alicatado paredes baño",
                similarity_threshold=0.30,
                min_count=2,
            )
        )
        assert len(results) >= 2
        # El más similar al query debe ir primero.
        assert results[0].id == "strong"


# -------- Firestore adapter (con cliente mockeado) ------------------------------------


class _FakeDocSnapshot:
    def __init__(self, data: dict | None, doc_id: str = "", exists: bool = True):
        self._data = data
        self.id = doc_id
        self.exists = exists

    def to_dict(self):
        return self._data


class _FakeDocRef:
    def __init__(self, doc_id: str):
        self.id = doc_id
        self._data: dict | None = None

    def get(self):
        return _FakeDocSnapshot(self._data, doc_id=self.id, exists=self._data is not None)

    def set(self, data):
        self._data = data


class _FakeCollection:
    def __init__(self):
        self.docs: dict[str, _FakeDocRef] = {}

    def document(self, doc_id: str) -> _FakeDocRef:
        return self.docs.setdefault(doc_id, _FakeDocRef(doc_id))

    def stream(self):
        for doc_id, ref in self.docs.items():
            if ref._data is not None:
                yield _FakeDocSnapshot(ref._data, doc_id=doc_id)


class _FakeFirestoreClient:
    def __init__(self):
        self._collections: dict[str, _FakeCollection] = {}

    def collection(self, name: str) -> _FakeCollection:
        return self._collections.setdefault(name, _FakeCollection())


class TestFirestoreHeuristicFragmentRepositoryAdapter:
    """El adapter escribe/lee en la colección `heuristic_fragments`."""

    def test_save_writes_document_with_fragment_id(self) -> None:
        fake_db = _FakeFirestoreClient()
        repo = FirestoreHeuristicFragmentRepository(db=fake_db)
        frag = _make_fragment(fragment_id="frag-xyz")
        asyncio.run(repo.save(frag))

        col = fake_db._collections["heuristic_fragments"]
        assert "frag-xyz" in col.docs
        stored = col.docs["frag-xyz"]._data
        assert stored is not None
        assert stored["id"] == "frag-xyz"
        assert stored["status"] == "golden"

    def test_find_by_id_deserializes_into_entity(self) -> None:
        fake_db = _FakeFirestoreClient()
        repo = FirestoreHeuristicFragmentRepository(db=fake_db)
        frag = _make_fragment()
        asyncio.run(repo.save(frag))
        got = asyncio.run(repo.find_by_id(frag.id))
        assert got is not None
        assert got.id == frag.id
        assert got.context.originalDescription == frag.context.originalDescription

    def test_find_by_id_returns_none_when_missing(self) -> None:
        fake_db = _FakeFirestoreClient()
        repo = FirestoreHeuristicFragmentRepository(db=fake_db)
        assert asyncio.run(repo.find_by_id("missing")) is None

    def test_find_relevant_uses_same_filters_as_in_memory(self) -> None:
        fake_db = _FakeFirestoreClient()
        repo = FirestoreHeuristicFragmentRepository(db=fake_db)
        # Dos golden en DEMOLICIONES relevantes + uno en otro capítulo.
        asyncio.run(repo.save(_make_fragment(
            fragment_id="f1",
            chapter="DEMOLICIONES",
            description="Demolición alicatado paredes baño",
        )))
        asyncio.run(repo.save(_make_fragment(
            fragment_id="f2",
            chapter="DEMOLICIONES",
            description="Demolición de alicatado paredes baño reforma integral",
        )))
        asyncio.run(repo.save(_make_fragment(
            fragment_id="other",
            chapter="FONTANERIA Y GAS",
            description="Demolición alicatado paredes baño",
        )))

        results = asyncio.run(repo.find_relevant(
            chapter="DEMOLICIONES",
            description="Demolición alicatado paredes baño",
            similarity_threshold=0.60,
            min_count=2,
        ))
        ids = {r.id for r in results}
        assert "other" not in ids
        assert {"f1", "f2"} <= ids

    def test_find_relevant_skips_malformed_docs(self) -> None:
        fake_db = _FakeFirestoreClient()
        repo = FirestoreHeuristicFragmentRepository(db=fake_db)
        # Inyectamos un doc no válido directamente.
        col = fake_db.collection("heuristic_fragments")
        ref = col.document("broken")
        ref.set({"id": "broken", "not": "a valid fragment"})

        asyncio.run(repo.save(_make_fragment(
            fragment_id="ok-1",
            description="Demolición alicatado paredes",
        )))
        asyncio.run(repo.save(_make_fragment(
            fragment_id="ok-2",
            description="Demolición alicatado paredes",
        )))

        # No debe crashear; devuelve solo los dos válidos.
        results = asyncio.run(repo.find_relevant(
            chapter="DEMOLICIONES",
            description="Demolición alicatado paredes",
            min_count=2,
        ))
        ids = {r.id for r in results}
        assert ids == {"ok-1", "ok-2"}

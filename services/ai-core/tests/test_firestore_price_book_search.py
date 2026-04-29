"""Fase 4 — tests del adapter de búsqueda `FirestorePriceBookAdapter` ampliado.

Cambios vs v004:
  - La colección ahora guarda DOS kinds (`item` + `breakdown`). El adapter
    debe devolverlos tal cual, con el campo `kind` intacto en el dict
    resultado — el Judge aguas abajo razona distinto según el kind.
  - Nuevo param opcional `partida_unit_dimension`. Si se pasa, candidatos
    con `unit_dimension` distinta se degradan (score × 0.3) — el Judge
    decide igualmente, pero los compatibles dimensionalmente suben arriba.
  - `db` inyectable en el constructor para que los tests no requieran
    Firebase Admin arrancado.
"""

from __future__ import annotations

from typing import Any

import pytest

from src.budget.infrastructure.adapters.databases.firestore_price_book import (
    FirestorePriceBookAdapter,
)


# -------- Fake Firestore para el vector search -------------------------------------


class _FakeDocSnapshot:
    def __init__(self, doc_id: str, data: dict):
        self.id = doc_id
        self._data = data

    def to_dict(self):
        # Firestore devuelve una copia
        return dict(self._data)


class _FakeVectorQuery:
    def __init__(self, snapshots: list[_FakeDocSnapshot]):
        self._snapshots = snapshots

    def get(self):
        return self._snapshots


class _FakeCollection:
    def __init__(self, snapshots: list[_FakeDocSnapshot]):
        self._snapshots = snapshots

    def find_nearest(self, **_kwargs):
        return _FakeVectorQuery(self._snapshots)

    def where(self, **_kwargs):
        # Simulamos el chain para chapter_filters; devuelve self.
        return self


class _FakeDb:
    def __init__(self, snapshots: list[_FakeDocSnapshot]):
        self._snapshots = snapshots

    def collection(self, name: str):
        assert name == "price_book_2025"
        return _FakeCollection(self._snapshots)


def _snap(doc_id: str, **fields) -> _FakeDocSnapshot:
    """Construye un snapshot con los campos mínimos que el adapter lee."""
    base = {
        "code": doc_id,
        "description": fields.get("description", "Generic description"),
        "chapter": fields.get("chapter", "X"),
        "unit_normalized": fields.get("unit_normalized", "m2"),
        "unit_dimension": fields.get("unit_dimension", "superficie"),
        "kind": fields.get("kind", "item"),
        # Embedding idéntico al query → cosine = 1.0 si no se degrada.
        "embedding": fields.get("embedding", [1.0] + [0.0] * 767),
    }
    base.update({k: v for k, v in fields.items() if k not in base})
    return _FakeDocSnapshot(doc_id, base)


# -------- Tests ----------------------------------------------------------------


class TestKindFieldSurvivesInResult:
    def test_returns_kind_field_for_items_and_breakdowns(self) -> None:
        snaps = [
            _snap("item-A", kind="item"),
            _snap("bk-B", kind="breakdown", description="component"),
        ]
        adapter = FirestorePriceBookAdapter(db=_FakeDb(snaps))

        query_vec = [1.0] + [0.0] * 767
        results = adapter.search_similar_items(query_vector=query_vec, limit=5)

        kinds = {r.get("kind") for r in results}
        assert kinds == {"item", "breakdown"}

    def test_embedding_is_stripped_but_kind_remains(self) -> None:
        snaps = [_snap("X", kind="item")]
        adapter = FirestorePriceBookAdapter(db=_FakeDb(snaps))
        results = adapter.search_similar_items(
            query_vector=[1.0] + [0.0] * 767, limit=5
        )
        assert "embedding" not in results[0]
        assert results[0]["kind"] == "item"
        assert results[0]["id"] == "X"


class TestDimensionalDegradation:
    """Si la partida tiene una dimensión (p.ej. `superficie`) y el candidato
    otra (p.ej. `tiempo`), el score se degrada para que caiga abajo del
    ranking. NO se excluye — el Judge decide."""

    def test_incompatible_dimension_score_is_degraded(self) -> None:
        snaps = [
            _snap("match-surf", unit_dimension="superficie"),
            _snap("bad-tiempo", unit_dimension="tiempo"),
        ]
        adapter = FirestorePriceBookAdapter(db=_FakeDb(snaps))
        results = adapter.search_similar_items(
            query_vector=[1.0] + [0.0] * 767,
            limit=5,
            partida_unit_dimension="superficie",
        )

        surf = next(r for r in results if r["id"] == "match-surf")
        bad = next(r for r in results if r["id"] == "bad-tiempo")

        # El compatible mantiene score ~= 1.0; el incompatible se multiplica por 0.3
        assert surf["matchScore"] > bad["matchScore"]
        # El factor exacto:
        assert bad["matchScore"] == pytest.approx(surf["matchScore"] * 0.3, rel=1e-3)

    def test_compatible_dimension_does_not_degrade(self) -> None:
        snaps = [_snap("X", unit_dimension="superficie")]
        adapter = FirestorePriceBookAdapter(db=_FakeDb(snaps))
        results = adapter.search_similar_items(
            query_vector=[1.0] + [0.0] * 767,
            limit=5,
            partida_unit_dimension="superficie",
        )
        # Score debería estar cerca de 1.0 (cosine de vectores idénticos)
        assert results[0]["matchScore"] == pytest.approx(1.0, rel=1e-3)

    def test_without_partida_dimension_no_degradation(self) -> None:
        """Backward-compat: callers viejos que no pasan partida_unit_dimension
        obtienen el comportamiento anterior (sin filtro dimensional)."""
        snaps = [_snap("X", unit_dimension="tiempo")]
        adapter = FirestorePriceBookAdapter(db=_FakeDb(snaps))
        results = adapter.search_similar_items(
            query_vector=[1.0] + [0.0] * 767, limit=5
        )
        assert results[0]["matchScore"] == pytest.approx(1.0, rel=1e-3)

    def test_candidate_without_dimension_is_not_degraded(self) -> None:
        """Si el candidato no tiene `unit_dimension` (legacy / vacío),
        preferimos no degradar — dejar al Judge decidir."""
        snaps = [_snap("X")]
        snaps[0]._data.pop("unit_dimension", None)
        adapter = FirestorePriceBookAdapter(db=_FakeDb(snaps))
        results = adapter.search_similar_items(
            query_vector=[1.0] + [0.0] * 767,
            limit=5,
            partida_unit_dimension="superficie",
        )
        assert results[0]["matchScore"] == pytest.approx(1.0, rel=1e-3)


class TestRankingAfterDegradation:
    """La degradación debe afectar el ORDEN final: el compatible sube, el
    incompatible baja al fondo."""

    def test_compatible_ranks_above_incompatible(self) -> None:
        snaps = [
            _snap("A-bad", unit_dimension="tiempo"),
            _snap("B-good", unit_dimension="superficie"),
        ]
        adapter = FirestorePriceBookAdapter(db=_FakeDb(snaps))
        results = adapter.search_similar_items(
            query_vector=[1.0] + [0.0] * 767,
            limit=5,
            partida_unit_dimension="superficie",
        )
        # B-good primero, A-bad después
        assert results[0]["id"] == "B-good"
        assert results[1]["id"] == "A-bad"

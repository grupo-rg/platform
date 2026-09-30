"""Tests del adapter de búsqueda `FirestorePriceBookAdapter`.

Historia:
  - Fase 4: la colección guarda DOS kinds (`item` + `breakdown`) y el adapter
    los devolvía ambos. Param opcional `partida_unit_dimension` (score × 0.3
    para dimensiones incompatibles). `db` inyectable.
  - Arreglos de recuperación (2026-09) — CAMBIO de contrato:
      * El vector search se restringe a `kind == "item"` con un pre-filtro
        nativo (índice `kind + embedding`). Los breakdowns (86 % del índice)
        ocupaban el top-K y se descartaban después → llegaban 8-14 de 15.
      * `chapter_filters` ya NO se aplica (no hay índice
        `kind + chapter + embedding`); el capítulo es señal blanda del híbrido.
      * El coseno sale de la distancia de Firestore (`distance_result_field`,
        coseno = 1 − distancia) con proyección `select` sin embeddings; si no
        hay distancia se recalcula desde el embedding (fakes/legacy).
      * `_cosine_raw` (coseno puro) separado de `matchScore` (con boosts).
      * Boost léxico con tokens sin stopwords, tildes plegadas y len ≥ 3.
      * La degradación dimensional no penaliza pares puenteables ni partidas
        pa/%/h.
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
    def __init__(self, snapshots: list[_FakeDocSnapshot], collection: "_FakeCollection"):
        self._snapshots = snapshots
        self._collection = collection

    def get(self):
        if self._collection.fail_projection and self._collection.selected is not None:
            raise RuntimeError("projection not supported with find_nearest")
        return self._snapshots


class _FakeCollection:
    def __init__(self, snapshots: list[_FakeDocSnapshot], *, fail_projection: bool = False):
        self._snapshots = snapshots
        self.fail_projection = fail_projection
        self.filters: list[Any] = []
        self.selected: Any = None
        self.find_nearest_kwargs: dict = {}

    def where(self, filter=None, **_kwargs):
        self.filters.append(filter)
        return self

    def select(self, fields):
        self.selected = list(fields)
        return self

    def find_nearest(self, **kwargs):
        self.find_nearest_kwargs = kwargs
        return _FakeVectorQuery(self._snapshots, self)


class _FakeDb:
    def __init__(self, snapshots: list[_FakeDocSnapshot], **coll_kwargs):
        self._snapshots = snapshots
        self._coll_kwargs = coll_kwargs
        self.collections: list[_FakeCollection] = []

    def collection(self, name: str):
        assert name == "price_book_2025"
        coll = _FakeCollection(self._snapshots, **self._coll_kwargs)
        self.collections.append(coll)
        return coll


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


_Q = [1.0] + [0.0] * 767


# -------- Tests ----------------------------------------------------------------


class TestKindItemPreFilter:
    def test_query_prefilters_kind_item_and_requests_distance(self) -> None:
        db = _FakeDb([_snap("item-A")])
        adapter = FirestorePriceBookAdapter(db=db)
        adapter.search_similar_items(query_vector=_Q, limit=5)

        coll = db.collections[0]
        assert len(coll.filters) == 1
        f = coll.filters[0]
        assert (f.field_path, f.op_string, f.value) == ("kind", "==", "item")
        assert coll.find_nearest_kwargs.get("distance_result_field")
        # Proyección sin embedding.
        assert coll.selected is not None and "embedding" not in coll.selected
        assert coll.find_nearest_kwargs["distance_result_field"] in coll.selected

    def test_breakdowns_are_not_returned(self) -> None:
        """Defensa en profundidad: aunque un breakdown se colara, no sale."""
        snaps = [
            _snap("item-A", kind="item"),
            _snap("bk-B", kind="breakdown", description="component"),
        ]
        adapter = FirestorePriceBookAdapter(db=_FakeDb(snaps))
        results = adapter.search_similar_items(query_vector=_Q, limit=5)
        assert [r["id"] for r in results] == ["item-A"]

    def test_chapter_filters_are_ignored(self) -> None:
        """Antes `chapter_filters` añadía `where(chapter in [...])`. Ahora se
        ignora: combinado con kind exigiría un índice inexistente."""
        db = _FakeDb([_snap("X")])
        adapter = FirestorePriceBookAdapter(db=db)
        results = adapter.search_similar_items(
            query_vector=_Q, limit=5, chapter_filters=["03 HORMIGONES"]
        )
        assert len(results) == 1
        fields = [f.field_path for f in db.collections[0].filters]
        assert fields == ["kind"]

    def test_embedding_is_stripped_but_kind_remains(self) -> None:
        snaps = [_snap("X", kind="item")]
        adapter = FirestorePriceBookAdapter(db=_FakeDb(snaps))
        results = adapter.search_similar_items(query_vector=_Q, limit=5)
        assert "embedding" not in results[0]
        assert results[0]["kind"] == "item"
        assert results[0]["id"] == "X"


class TestCosineFromDistance:
    def test_cosine_raw_is_one_minus_distance_without_embedding(self) -> None:
        snap = _snap("X", _vector_distance=0.25)
        snap._data.pop("embedding")
        adapter = FirestorePriceBookAdapter(db=_FakeDb([snap]))
        results = adapter.search_similar_items(query_vector=_Q, limit=5)
        assert results[0]["_cosine_raw"] == pytest.approx(0.75)
        assert results[0]["matchScore"] == pytest.approx(0.75)
        assert "_vector_distance" not in results[0]

    def test_projection_rejected_falls_back_to_full_query(self) -> None:
        db = _FakeDb([_snap("X")], fail_projection=True)
        adapter = FirestorePriceBookAdapter(db=db)
        results = adapter.search_similar_items(query_vector=_Q, limit=5)
        assert [r["id"] for r in results] == ["X"]
        assert results[0]["_cosine_raw"] == pytest.approx(1.0)  # desde embedding
        assert adapter._projection_supported is False
        # Siguientes búsquedas ya no intentan la proyección.
        adapter.search_similar_items(query_vector=_Q, limit=5)
        assert db.collections[-1].selected is None


class TestLexicalBoost:
    def test_boost_uses_folded_tokens_without_stopwords(self) -> None:
        snaps = [
            _snap("hit", description="Solera de hormigón armado"),
            _snap("miss", description="Pintura plástica"),
        ]
        adapter = FirestorePriceBookAdapter(db=_FakeDb(snaps))
        results = adapter.search_similar_items(
            query_vector=_Q, query_text="solera de HORMIGON", limit=5,
        )
        hit = next(r for r in results if r["id"] == "hit")
        miss = next(r for r in results if r["id"] == "miss")
        # "de" es stopword → tokens {solera, hormigon}; ambos presentes (tildes plegadas).
        assert hit["_lexical_coverage"] == pytest.approx(1.0)
        assert hit["matchScore"] == pytest.approx(1.5)
        assert hit["_cosine_raw"] == pytest.approx(1.0)  # el coseno puro no cambia
        assert miss["matchScore"] == pytest.approx(1.0)
        assert results[0]["id"] == "hit"

    def test_plural_and_singular_match(self) -> None:
        snaps = [_snap("tab", description="Tabique de ladrillo")]
        adapter = FirestorePriceBookAdapter(db=_FakeDb(snaps))
        results = adapter.search_similar_items(
            query_vector=_Q, query_text="tabiques ladrillos", limit=5,
        )
        assert results[0]["_lexical_coverage"] == pytest.approx(1.0)


class TestBridgeableDimensions:
    @pytest.mark.parametrize("partida,cand", [
        ("superficie", "volumen"),
        ("volumen", "superficie"),
        ("lineal", "discreto"),
        ("discreto", "lineal"),
        ("importe", "superficie"),
        ("porcentaje", "discreto"),
        ("tiempo", "volumen"),
    ])
    def test_not_degraded(self, partida, cand) -> None:
        adapter = FirestorePriceBookAdapter(db=_FakeDb([_snap("X", unit_dimension=cand)]))
        results = adapter.search_similar_items(
            query_vector=_Q, limit=5, partida_unit_dimension=partida,
        )
        assert results[0]["matchScore"] == pytest.approx(1.0)



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


class TestAiGeneratedSourceDownweight:
    """P2 — Los candidatos con `source == 'ai_generated'` (partidas from_scratch
    guardadas por el constructor, aún sin validar) se degradan (score × 0.85)
    para relegarlos ante el catálogo oficial COAATMCA. NO se excluyen."""

    def test_ai_generated_score_is_downweighted(self) -> None:
        snaps = [
            _snap("official", source=None),        # catálogo oficial (sin source)
            _snap("ia", source="ai_generated"),    # partida IA sin validar
        ]
        # Quitar `source=None` del doc oficial para simular ausencia real.
        snaps[0]._data.pop("source", None)
        adapter = FirestorePriceBookAdapter(db=_FakeDb(snaps))
        results = adapter.search_similar_items(
            query_vector=[1.0] + [0.0] * 767, limit=5
        )

        official = next(r for r in results if r["id"] == "official")
        ia = next(r for r in results if r["id"] == "ia")

        # Mismo embedding → mismo cosine base; el IA queda relegado por × 0.85.
        assert official["matchScore"] > ia["matchScore"]
        assert ia["matchScore"] == pytest.approx(official["matchScore"] * 0.85, rel=1e-3)

    def test_ai_generated_not_excluded(self) -> None:
        snaps = [_snap("ia", source="ai_generated")]
        adapter = FirestorePriceBookAdapter(db=_FakeDb(snaps))
        results = adapter.search_similar_items(
            query_vector=[1.0] + [0.0] * 767, limit=5
        )
        # Sigue presente, solo con score degradado (no se filtra).
        assert len(results) == 1
        assert results[0]["id"] == "ia"
        assert results[0]["matchScore"] == pytest.approx(0.85, rel=1e-3)

    def test_official_source_is_not_downweighted(self) -> None:
        snaps = [_snap("coa", source="coaatmca")]
        adapter = FirestorePriceBookAdapter(db=_FakeDb(snaps))
        results = adapter.search_similar_items(
            query_vector=[1.0] + [0.0] * 767, limit=5
        )
        assert results[0]["matchScore"] == pytest.approx(1.0, rel=1e-3)

    def test_ai_generated_ranks_below_official_on_tie(self) -> None:
        snaps = [
            _snap("ia", source="ai_generated"),
            _snap("official"),
        ]
        snaps[1]._data.pop("source", None)
        adapter = FirestorePriceBookAdapter(db=_FakeDb(snaps))
        results = adapter.search_similar_items(
            query_vector=[1.0] + [0.0] * 767, limit=5
        )
        assert results[0]["id"] == "official"
        assert results[1]["id"] == "ia"


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

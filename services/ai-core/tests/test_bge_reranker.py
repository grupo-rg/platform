"""S1-A-03 — Cross-encoder reranker (BAAI/bge-reranker-v2-m3) local.

Sustituye al reranker actual con Gemini Flash (~$0.01/partida) por un
cross-encoder local (~$0/partida, ~50-200ms/batch en CPU).

Estos tests NO bajan el modelo (~280MB) — usan un fake `_CrossEncoderLike`
inyectable. La integración real con `sentence-transformers` se valida con
un smoke test cuando se carga la dependencia.

Tests:
  1. ``rerank`` aplica el modelo a pairs (query, candidate.description) y
     devuelve top-N por score descendente.
  2. ``rerank`` con menos candidatos que top_n devuelve todos.
  3. ``rerank`` con lista vacía devuelve vacío.
  4. Singleton (``BgeReranker.get()``) no recarga el modelo en llamadas
     repetidas.
  5. Lazy loading: importar el módulo NO instancia `sentence_transformers`.
"""
from __future__ import annotations

from typing import List, Sequence

import pytest

from src.budget.infrastructure.adapters.reranking.bge_reranker import (
    BgeReranker,
)


class _CrossEncoderLike:
    """Fake del `sentence_transformers.CrossEncoder` para tests sin instalar
    el modelo de ~280MB. Devuelve scores predecibles según la posición."""

    def __init__(self, scores_per_call: List[List[float]]):
        self._scores = scores_per_call
        self.predict_calls: List[List[tuple[str, str]]] = []

    def predict(self, pairs: Sequence[tuple[str, str]]):
        self.predict_calls.append(list(pairs))
        # Devuelve los scores en orden.
        return self._scores.pop(0)


# Helper para construir un candidato dict como el que vendría del catálogo.
def _cand(id_, description, **kwargs):
    return {"id": id_, "code": id_, "description": description, **kwargs}


def test_rerank_returns_top_n_by_score():
    """El reranker debe devolver los top_n candidatos ordenados por score."""
    ce = _CrossEncoderLike([[0.1, 0.9, 0.5]])
    reranker = BgeReranker(model=ce)
    cands = [
        _cand("A", "Pintura plástica"),
        _cand("B", "Solera hormigón HM-20"),
        _cand("C", "Pavimento cerámico"),
    ]
    ranked = reranker.rerank(
        query="hormigón fratasado HM-20",
        candidates=cands,
        top_n=2,
    )
    ids = [c["id"] for c, _ in ranked]
    assert ids == ["B", "C"]
    # Scores preservados.
    assert ranked[0][1] == pytest.approx(0.9)
    assert ranked[1][1] == pytest.approx(0.5)


def test_rerank_passes_query_and_description_pairs():
    """Cada pair pasado al CrossEncoder es (query, candidate.description)."""
    ce = _CrossEncoderLike([[0.5, 0.5]])
    reranker = BgeReranker(model=ce)
    reranker.rerank(
        query="Q1",
        candidates=[_cand("A", "Desc A"), _cand("B", "Desc B")],
        top_n=2,
    )
    assert ce.predict_calls == [[("Q1", "Desc A"), ("Q1", "Desc B")]]


def test_rerank_with_fewer_candidates_than_top_n():
    """Si hay menos candidates que top_n, devuelve todos."""
    ce = _CrossEncoderLike([[0.3, 0.7]])
    reranker = BgeReranker(model=ce)
    cands = [_cand("A", "a"), _cand("B", "b")]
    ranked = reranker.rerank(query="q", candidates=cands, top_n=10)
    assert len(ranked) == 2


def test_rerank_with_empty_candidates_returns_empty():
    """Lista vacía → vacío sin llamar al modelo."""
    ce = _CrossEncoderLike([])  # no scores wired — si se llamara, IndexError
    reranker = BgeReranker(model=ce)
    out = reranker.rerank(query="q", candidates=[], top_n=3)
    assert out == []
    # No se llamó al modelo.
    assert ce.predict_calls == []


def test_rerank_ignores_candidates_without_description():
    """Un candidato sin description se descarta (no se evalúa con el modelo)."""
    ce = _CrossEncoderLike([[0.5]])  # solo un pair esperado
    reranker = BgeReranker(model=ce)
    cands = [
        _cand("A", "Solera"),
        {"id": "B", "code": "B"},  # sin description
    ]
    ranked = reranker.rerank(query="q", candidates=cands, top_n=5)
    assert len(ranked) == 1
    assert ranked[0][0]["id"] == "A"


def test_singleton_reuses_model():
    """`BgeReranker.get()` devuelve la misma instancia en llamadas repetidas."""
    BgeReranker._reset_singleton_for_tests()  # internal helper
    ce = _CrossEncoderLike([[0.5]])
    inst1 = BgeReranker.get(model=ce)
    inst2 = BgeReranker.get(model=ce)
    assert inst1 is inst2


def test_import_does_not_load_sentence_transformers(monkeypatch):
    """Solo importar el módulo NO debe hacer `from sentence_transformers ...`
    El import del modelo es lazy y vive en `_create_default_model`."""
    import sys

    # Si sentence_transformers está cargado ya por otro test, no podemos
    # validar el lazy-load aquí. Skip safely.
    if "sentence_transformers" in sys.modules:
        pytest.skip("sentence_transformers ya está importado por otro test")

    # Re-importamos limpio.
    if "src.budget.infrastructure.adapters.reranking.bge_reranker" in sys.modules:
        del sys.modules["src.budget.infrastructure.adapters.reranking.bge_reranker"]
    import importlib

    importlib.import_module("src.budget.infrastructure.adapters.reranking.bge_reranker")
    assert "sentence_transformers" not in sys.modules


def test_rerank_preserves_other_candidate_fields():
    """Los dicts de candidate (con priceTotal, unit, etc.) se devuelven intactos."""
    ce = _CrossEncoderLike([[0.8]])
    reranker = BgeReranker(model=ce)
    cands = [
        _cand("A", "Solera", priceTotal=42.5, unit="m2", chapter="03 HORMIGONES"),
    ]
    ranked = reranker.rerank(query="q", candidates=cands, top_n=1)
    cand_back, score = ranked[0]
    assert cand_back["priceTotal"] == 42.5
    assert cand_back["unit"] == "m2"
    assert cand_back["chapter"] == "03 HORMIGONES"
    assert score == pytest.approx(0.8)


def test_rerank_handles_model_exception_gracefully():
    """Si el cross-encoder revienta, no propagamos: devolvemos input en orden."""
    class _BoomModel:
        def predict(self, pairs):
            raise RuntimeError("oops")

    reranker = BgeReranker(model=_BoomModel())
    cands = [_cand("A", "a"), _cand("B", "b")]
    out = reranker.rerank(query="q", candidates=cands, top_n=5)
    assert len(out) == 2
    assert [c["id"] for c, _ in out] == ["A", "B"]
    # Score por defecto en fallback es 0.0.
    assert all(s == 0.0 for _, s in out)


# ---- Integration: SwarmPricingService uses BGE when injected -------------


def test_swarm_uses_bge_when_injected(monkeypatch):
    """Con `reranker=` inyectado, el swarm llama a BGE y NO a Flash rerank."""
    import asyncio
    from src.budget.application.services.swarm_pricing_service import (
        BatchPricedItemV3,
        BatchPricingEvaluatorResultV3,
        PricingFinalResultDB,
        SwarmPricingService,
    )
    from src.budget.application.services.pdf_extractor_service import RestructuredItem
    from src.budget.application.ports.ports import (
        IGenerationEmitter,
        ILLMProvider,
        IVectorSearch,
    )

    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    flash_rerank_invocations = []

    class _LLM(ILLMProvider):
        async def generate_structured(self, system_prompt, user_prompt, response_schema, **kwargs):
            name = response_schema.__name__
            if name == "DeconstructResult":
                return response_schema(is_complex=False, queries=["q"]), {}
            if name == "CandidateRerankResult":
                # Si el swarm llega aquí, NO está usando BGE.
                flash_rerank_invocations.append(kwargs)
                return response_schema(selected_ids=["C1"]), {}
            if name == "BatchPricingEvaluatorResultV3":
                return (
                    BatchPricingEvaluatorResultV3(results=[
                        BatchPricedItemV3(
                            item_code="X.1",
                            valuation=PricingFinalResultDB(
                                pensamiento_calculista="r",
                                calculated_unit_price=10.0,
                                needs_human_review=False,
                                match_kind="1:1",
                            ),
                        ),
                    ]),
                    {},
                )
            raise AssertionError(name)

        async def get_embedding(self, text: str):
            return [0.0] * 768

    class _VS(IVectorSearch):
        def search_similar_items(self, query_vector, query_text="", limit=4, **kwargs):
            # Devolvemos 5 candidates para forzar el rerank (>3).
            return [
                {"id": f"C{i}", "code": f"C{i}", "description": f"desc {i}",
                 "matchScore": 0.9 - 0.1 * i, "unit": "m2", "priceTotal": 10.0 + i}
                for i in range(1, 6)
            ]

    class _SpyEmitter(IGenerationEmitter):
        def __init__(self):
            self.events = []
        def emit_event(self, b, t, d):
            self.events.append({"type": t, "data": d})

    # BGE fake: ordena por longitud de la descripción para que sea determinístico.
    class _BgeModel:
        def predict(self, pairs):
            # Score = longitud del candidate description.
            return [len(d) for _, d in pairs]

    BgeReranker._reset_singleton_for_tests()
    svc = SwarmPricingService(
        llm_provider=_LLM(),
        vector_search=_VS(),
        emitter=_SpyEmitter(),
        reranker=BgeReranker(model=_BgeModel()),
    )
    items = [RestructuredItem(
        code="X.1", description="d", quantity=10.0, unit="m2",
        chapter="03 HORMIGONES",
    )]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    asyncio.run(svc.evaluate_batch(items, budget_id="b-bge", metrics=metrics))

    # No deberían haberse llamado al rerank Flash.
    assert flash_rerank_invocations == [], (
        f"Se esperaba 0 llamadas Flash rerank con BGE inyectado, got {len(flash_rerank_invocations)}"
    )

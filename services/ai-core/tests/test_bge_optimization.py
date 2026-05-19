"""S2-A-00 — BGE rerank optimization, focused tests.

Estos tests cubren los criterios de aceptación de S2-A-00 que no caben en
`test_bge_reranker.py` (que tiene los unit tests del módulo). Aquí:

  - Integración end-to-end: SwarmPricingService con BGE inyectado y
    `len(items) > 1` usa el path batch (un solo predict).
  - Kill-switch `ENABLE_BGE_RERANK=false` salta el cross-encoder.
  - Sanidad del speedup: 8 partidas × 5 candidatos = 40 pairs en UN solo
    forward pass.

Estos tests usan fakes — no bajamos el modelo real (~280MB). El smoke
con el modelo real se valida en producción.
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List

import pytest

from src.budget.application.ports.ports import (
    IGenerationEmitter,
    ILLMProvider,
    IVectorSearch,
)
from src.budget.application.services.pdf_extractor_service import RestructuredItem
from src.budget.application.services.swarm_pricing_service import (
    BatchPricedItemV3,
    BatchPricingEvaluatorResultV3,
    PricingFinalResultDB,
    SwarmPricingService,
)
from src.budget.infrastructure.adapters.reranking.bge_reranker import (
    BgeReranker,
    is_enabled,
)


class _FakeBgeModel:
    """Cross-encoder fake. Cuenta predict_calls y devuelve scores=longitud(desc)."""
    def __init__(self):
        self.predict_calls: List[List[tuple]] = []

    def predict(self, pairs, batch_size: int = 0):
        self.predict_calls.append(list(pairs))
        return [len(d) for _, d in pairs]


class _SimpleLLM(ILLMProvider):
    """LLM mock que devuelve resultados rápidos por partida."""
    async def generate_structured(self, system_prompt, user_prompt, response_schema, **kwargs):
        name = response_schema.__name__
        if name == "DeconstructResult":
            return response_schema(is_complex=False, queries=["q"]), {}
        if name == "BatchPricingEvaluatorResultV3":
            import re
            m = re.search(r"PARTIDA CÓDIGO: (\S+)", user_prompt)
            code = m.group(1) if m else "X.0"
            return (
                BatchPricingEvaluatorResultV3(results=[
                    BatchPricedItemV3(
                        item_code=code,
                        valuation=PricingFinalResultDB(
                            pensamiento_calculista="x",
                            calculated_unit_price=10.0,
                            needs_human_review=False,
                            match_kind="1:1",
                        ),
                    ),
                ]),
                {"promptTokenCount": 1, "candidatesTokenCount": 1, "totalTokenCount": 2},
            )
        raise AssertionError(name)

    async def get_embedding(self, text: str):
        return [0.0] * 768


class _VS5Cands(IVectorSearch):
    """Vector search que devuelve 5 candidatos (>3, triggera rerank)."""
    def search_similar_items(self, query_vector, query_text="", limit=4, **kwargs):
        return [
            {"id": f"C{i}", "code": f"C{i}", "description": f"desc {i} " * (i + 1),
             "matchScore": 0.9 - 0.1 * i, "unit": "m2", "priceTotal": 10.0 + i}
            for i in range(1, 6)
        ]


class _SpyEmitter(IGenerationEmitter):
    def __init__(self):
        self.events: List[Dict[str, Any]] = []

    def emit_event(self, b, t, d):
        self.events.append({"type": t, "data": d})


# ---- Kill-switch integration ----------------------------------------------


def test_is_enabled_kill_switch_off():
    """is_enabled() respeta ENABLE_BGE_RERANK=false."""
    assert is_enabled(env={"ENABLE_BGE_RERANK": "false"}) is False


def test_is_enabled_kill_switch_default_on():
    """Sin la env var, is_enabled() devuelve True (BGE enabled by default)."""
    assert is_enabled(env={}) is True


@pytest.mark.asyncio
async def test_swarm_skips_bge_when_kill_switch_disabled(monkeypatch):
    """Con ENABLE_BGE_RERANK=false, el swarm devuelve los 3 primeros del
    hybrid search sin tocar el cross-encoder."""
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )
    monkeypatch.setenv("ENABLE_BGE_RERANK", "false")

    BgeReranker._reset_singleton_for_tests()
    bge_model = _FakeBgeModel()
    reranker = BgeReranker(model=bge_model)

    svc = SwarmPricingService(
        llm_provider=_SimpleLLM(),
        vector_search=_VS5Cands(),
        emitter=_SpyEmitter(),
        reranker=reranker,
    )

    items = [RestructuredItem(
        code="X.1", description="d", quantity=10.0, unit="m2", chapter="C",
    )]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    await svc.evaluate_batch(items, budget_id="b-kill", metrics=metrics)

    # El cross-encoder NO se llamó.
    assert bge_model.predict_calls == [], (
        "Con ENABLE_BGE_RERANK=false, el predict NO debe invocarse"
    )


# ---- Batch path triggers single predict for multi-item -------------------


@pytest.mark.asyncio
async def test_swarm_uses_batch_rerank_for_multiple_items(monkeypatch):
    """Con >1 items y BGE habilitado, el swarm usa `batch_rerank` → 1 solo
    `predict` call para todos los pairs."""
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )
    monkeypatch.delenv("ENABLE_BGE_RERANK", raising=False)  # default ON

    BgeReranker._reset_singleton_for_tests()
    bge_model = _FakeBgeModel()
    reranker = BgeReranker(model=bge_model)

    svc = SwarmPricingService(
        llm_provider=_SimpleLLM(),
        vector_search=_VS5Cands(),
        emitter=_SpyEmitter(),
        reranker=reranker,
    )

    items = [
        RestructuredItem(code=f"X.{i}", description=f"d{i}", quantity=1.0,
                         unit="m2", chapter="C")
        for i in range(4)
    ]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    await svc.evaluate_batch(items, budget_id="b-batch", metrics=metrics)

    # Speedup criterio: UN SOLO predict call para las 4 partidas (en lugar de 4).
    assert len(bge_model.predict_calls) == 1, (
        f"Esperaba 1 predict call (batch), got {len(bge_model.predict_calls)}"
    )
    # Y todos los pairs en él: 4 partidas × 5 candidates = 20 pairs.
    assert len(bge_model.predict_calls[0]) == 20


@pytest.mark.asyncio
async def test_swarm_batch_rerank_emits_rerank_applied_per_partida(monkeypatch):
    """`rerank_applied` se emite por cada partida que pasó por el batch."""
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )
    monkeypatch.delenv("ENABLE_BGE_RERANK", raising=False)

    BgeReranker._reset_singleton_for_tests()
    reranker = BgeReranker(model=_FakeBgeModel())

    emitter = _SpyEmitter()
    svc = SwarmPricingService(
        llm_provider=_SimpleLLM(),
        vector_search=_VS5Cands(),
        emitter=emitter,
        reranker=reranker,
    )
    items = [
        RestructuredItem(code=f"X.{i}", description=f"d{i}", quantity=1.0,
                         unit="m2", chapter="C")
        for i in range(3)
    ]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    await svc.evaluate_batch(items, budget_id="b-emit", metrics=metrics)

    rerank_events = [e for e in emitter.events if e["type"] == "rerank_applied"]
    # 3 partidas → 3 eventos rerank_applied.
    assert len(rerank_events) == 3
    # Todos marcados como batched.
    assert all(e["data"].get("batched") is True for e in rerank_events)


# ---- pre-warm wiring ------------------------------------------------------


def test_pre_warm_idempotency_in_singleton():
    """pre_warm() se puede llamar múltiples veces sin problemas."""
    BgeReranker._reset_singleton_for_tests()
    bge_model = _FakeBgeModel()
    reranker = BgeReranker.get(model=bge_model)
    reranker.pre_warm()
    reranker.pre_warm()
    reranker.pre_warm()
    # Solo se invocó al modelo UNA vez.
    assert len(bge_model.predict_calls) == 1


# ---- Speedup sanity check -------------------------------------------------


def test_batch_rerank_8_partidas_5_candidates_single_call():
    """Caso real: SWARM_CONCURRENCY=8 con 5 candidates por partida.
    40 pairs en UN solo forward pass. Speedup esperado: ~8x vs 8 sequential calls.
    """
    BgeReranker._reset_singleton_for_tests()
    bge_model = _FakeBgeModel()
    reranker = BgeReranker(model=bge_model)

    queries_with_candidates = [
        (f"query {q}", [
            {"id": f"C{q}_{i}", "description": f"desc {q}_{i}"}
            for i in range(5)
        ])
        for q in range(8)
    ]
    results = reranker.batch_rerank(queries_with_candidates, top_n=3)

    # UN SOLO predict call.
    assert len(bge_model.predict_calls) == 1
    # 8 × 5 = 40 pairs.
    assert len(bge_model.predict_calls[0]) == 40
    # 8 queries, 3 top picks cada una.
    assert len(results) == 8
    for q_results in results:
        assert len(q_results) == 3

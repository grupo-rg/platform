"""Fase 9.4 — re-rank intermedio con Flash antes del tier dispatch.

Objetivo: cuando el vector_search devuelve ≥ 4 candidatos, una llamada Flash
ligera reordena y recorta a top-3. Esto:
- Reduce el contexto que llega al modelo final (Pro o Flash) → más rápido.
- Mejora la calidad de selección sobre el cosine puro del vector store.
- En caso de fallo LLM → fallback transparente al orden original (sin
  romper el pipeline).

Telemetría: SSE `rerank_applied` con sizes y selected_ids.
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List

from src.budget.application.ports.ports import (
    IGenerationEmitter,
    ILLMProvider,
    IVectorSearch,
)
from src.budget.application.services.pdf_extractor_service import RestructuredItem
from src.budget.application.services.swarm_pricing_service import (
    BatchPricedItemV3,
    BatchPricingEvaluatorResultV3,
    CandidateRerankResult,
    PricingFinalResultDB,
    SwarmPricingService,
)


class _SpyEmitter(IGenerationEmitter):
    def __init__(self):
        self.events: List[Dict[str, Any]] = []

    def emit_event(self, budget_id, event_type, data):
        self.events.append({"type": event_type, "data": data})


def _make_candidate(id: str, score: float = 0.85, unit: str = "m2", desc: str = "Candidato"):
    return {
        "id": id,
        "description": desc,
        "matchScore": score,
        "unit": unit,
        "priceTotal": 50.0,
    }


# ---- Pure tests of _rerank_candidates --------------------------------------


def test_rerank_passes_through_when_three_or_fewer_candidates():
    """Si hay ≤ 3 candidatos, no hay valor en rerank — devolver tal cual."""
    cands = [_make_candidate("A"), _make_candidate("B"), _make_candidate("C")]
    svc = SwarmPricingService(
        llm_provider=_NeverCalledLLM(),  # explota si se invoca
        vector_search=_StubVectorSearch([]),
    )
    result = asyncio.run(svc._rerank_candidates(cands, "una partida", "m2"))
    assert [c["id"] for c in result] == ["A", "B", "C"]


def test_rerank_calls_flash_when_four_or_more_and_returns_top3():
    """Con 5 candidatos, Flash reordena y se queda con top 3."""
    cands = [
        _make_candidate("A"),
        _make_candidate("B"),
        _make_candidate("C"),
        _make_candidate("D"),
        _make_candidate("E"),
    ]
    llm = _RecordingRerankLLM(selected_ids=["C", "A", "E"])
    svc = SwarmPricingService(llm_provider=llm, vector_search=_StubVectorSearch([]))
    result = asyncio.run(svc._rerank_candidates(cands, "partida X", "m2"))
    assert [c["id"] for c in result] == ["C", "A", "E"]
    # Solo se llamó al LLM una vez (rerank).
    assert llm.call_count == 1


def test_rerank_falls_back_to_original_when_llm_fails():
    """Si la llamada Flash crashea, devolvemos los candidatos originales sin
    propagar el error (la calidad puede degradar pero el pipeline sigue)."""
    cands = [
        _make_candidate("A"), _make_candidate("B"),
        _make_candidate("C"), _make_candidate("D"),
    ]
    llm = _CrashingLLM()
    svc = SwarmPricingService(llm_provider=llm, vector_search=_StubVectorSearch([]))
    result = asyncio.run(svc._rerank_candidates(cands, "X", "m2"))
    assert [c["id"] for c in result] == ["A", "B", "C", "D"]


def test_rerank_filters_unknown_ids_emitted_by_llm():
    """Si Flash inventa un id que no estaba en el input, lo descartamos.
    Defensivo contra alucinaciones."""
    cands = [_make_candidate("A"), _make_candidate("B"), _make_candidate("C"), _make_candidate("D")]
    llm = _RecordingRerankLLM(selected_ids=["A", "GHOST", "B"])
    svc = SwarmPricingService(llm_provider=llm, vector_search=_StubVectorSearch([]))
    result = asyncio.run(svc._rerank_candidates(cands, "X", "m2"))
    # Solo A y B sobreviven; el "GHOST" se filtra.
    assert [c["id"] for c in result] == ["A", "B"]


# ---- Integration: rerank fires before tier dispatch ------------------------


class _RecordingRerankLLM(ILLMProvider):
    def __init__(self, selected_ids: List[str]):
        self.selected_ids = selected_ids
        self.call_count = 0
        self.calls: List[Dict[str, Any]] = []

    async def generate_structured(self, system_prompt, user_prompt, response_schema, **kwargs):
        self.call_count += 1
        self.calls.append({"model": kwargs.get("model"), "schema": response_schema.__name__})
        name = response_schema.__name__
        if name == "DeconstructResult":
            return response_schema(is_complex=False, queries=["q"]), {}
        if name == "CandidateRerankResult":
            return CandidateRerankResult(
                selected_ids=self.selected_ids,
                reason="ranking simulado",
            ), {}
        if name == "BatchPricingEvaluatorResultV3":
            return (
                BatchPricingEvaluatorResultV3(results=[
                    BatchPricedItemV3(
                        item_code="TEST.1",
                        valuation=PricingFinalResultDB(
                            pensamiento_calculista="r",
                            calculated_unit_price=50.0,
                            needs_human_review=False,
                            match_kind="1:1",
                        ),
                    )
                ]),
                {},
            )
        raise AssertionError(f"Schema inesperado: {name}")

    async def get_embedding(self, text: str):
        return [0.0] * 768


class _NeverCalledLLM(ILLMProvider):
    async def generate_structured(self, *args, **kwargs):
        raise AssertionError("LLM no debería llamarse en este path")

    async def get_embedding(self, text: str):
        return [0.0] * 768


class _CrashingLLM(ILLMProvider):
    async def generate_structured(self, *args, **kwargs):
        raise RuntimeError("simulated provider failure")

    async def get_embedding(self, text: str):
        return [0.0] * 768


class _StubVectorSearch(IVectorSearch):
    def __init__(self, candidates: List[Dict[str, Any]]):
        self._candidates = candidates

    def search_similar_items(self, query_vector, query_text, limit=4, **kwargs):
        return self._candidates


def test_telemetry_emits_rerank_applied_event(monkeypatch):
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    cands = [_make_candidate(f"C{i}") for i in range(5)]
    llm = _RecordingRerankLLM(selected_ids=["C0", "C1", "C2"])
    emitter = _SpyEmitter()
    svc = SwarmPricingService(
        llm_provider=llm, vector_search=_StubVectorSearch(cands), emitter=emitter,
    )
    items = [RestructuredItem(code="TEST.1", description="X", quantity=10.0, unit="m2", chapter="C")]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    asyncio.run(svc.evaluate_batch(items, budget_id="b-rerank", metrics=metrics))

    rerank_events = [e for e in emitter.events if e["type"] == "rerank_applied"]
    assert len(rerank_events) == 1
    data = rerank_events[0]["data"]
    assert data["code"] == "TEST.1"
    assert data["input_size"] == 5
    assert data["output_size"] == 3

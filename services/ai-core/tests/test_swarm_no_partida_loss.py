"""El swarm de pricing NUNCA pierde partidas en silencio (reconciliación de cobertura).

Incidente real: un BC3 de 36 partidas medidas produjo un presupuesto de 13 (se
perdió el 64%) por un burst de 429 + ausencia de reconciliación. Hay 4 puntos de
caída ("construye solo con lo que devolvió el LLM"): A) fetch de candidatos,
B) chunk de pricing caído, C) omisión del batch, D) item corrupto.

Garantía a fijar: **codes(salida) ⊇ codes(entrada post-resume)**. Lo que el LLM
omita o reviente se recupera como fallback DETERMINISTA (from_scratch +
needs_review + precio 0/bc3), SIN llamada extra al LLM. Happy-path no crea fallbacks.
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


class _SpyEmitter(IGenerationEmitter):
    def __init__(self) -> None:
        self.events: List[Dict[str, Any]] = []

    def emit_event(self, budget_id: str, event_type: str, data: Dict[str, Any]) -> None:
        self.events.append({"type": event_type, "data": data})


class _VS(IVectorSearch):
    def search_similar_items(self, query_vector, query_text, limit=4, **kwargs):
        return [{
            "id": "C1", "code": "C1", "description": "cand",
            "matchScore": 0.9, "unit": "ud", "priceTotal": 50.0,
        }]


def _priced(code: str, price: float = 100.0) -> BatchPricedItemV3:
    return BatchPricedItemV3(
        item_code=code,
        valuation=PricingFinalResultDB(
            pensamiento_calculista="ok", calculated_unit_price=price,
            needs_human_review=False, match_kind="1:1",
        ),
    )


class _FakeLLM(ILLMProvider):
    """LLM configurable. Detecta el code por substring en el user_prompt (la
    descripción de cada item lleva su code, y `_load_prompt` vuelca `batch_items`).

      - omit_codes: en pricing, NO devuelve valoración para ese code (drop C).
      - crash_pricing_codes: revienta la llamada de pricing de ese chunk (drop B).
      - crash_deconstruct_codes: revienta la deconstrucción de ese item (drop A).
    """

    def __init__(self, all_codes, *, omit_codes=(), crash_pricing_codes=(), crash_deconstruct_codes=()):
        self.all_codes = list(all_codes)
        self.omit = set(omit_codes)
        self.crash_pricing = set(crash_pricing_codes)
        self.crash_deconstruct = set(crash_deconstruct_codes)

    async def generate_structured(self, system_prompt, user_prompt, response_schema, **kwargs):
        name = response_schema.__name__
        if name == "DeconstructResult":
            for c in self.crash_deconstruct:
                if c in user_prompt:
                    raise RuntimeError(f"simulated 429 in deconstruct for {c}")
            return response_schema(is_complex=False, queries=["q"]), {}
        if name == "BatchPricingEvaluatorResultV3":
            for c in self.crash_pricing:
                if c in user_prompt:
                    raise RuntimeError(f"simulated 429 in pricing for {c}")
            results = [
                _priced(c) for c in self.all_codes
                if c in user_prompt and c not in self.omit
            ]
            return BatchPricingEvaluatorResultV3(results=results), {}
        raise AssertionError(f"schema inesperado: {name}")

    async def get_embedding(self, text: str):
        return [0.0] * 768


def _make_items(codes) -> List[RestructuredItem]:
    # La descripción lleva el code → aparece tanto en el prompt de deconstrucción
    # (que usa description) como en el de pricing (batch_items).
    return [
        RestructuredItem(code=c, description=f"Partida {c} descripcion", quantity=2.0, unit="m2", chapter="A")
        for c in codes
    ]


def _run(llm, items, emitter, monkeypatch):
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )
    svc = SwarmPricingService(llm_provider=llm, vector_search=_VS(), emitter=emitter)
    metrics: Dict[str, float] = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    return asyncio.run(svc.evaluate_batch(items, budget_id="b", metrics=metrics))


def _recovered_codes(emitter) -> set:
    return {e["data"]["code"] for e in emitter.events if e["type"] == "partida_fallback_recovered"}


# ---- A/B/C: cada punto de caída se recupera --------------------------------

def test_llm_omits_pricing_codes_all_recovered(monkeypatch):
    codes = ["P.1", "P.2", "P.3", "P.4"]
    omit = {"P.2", "P.4"}
    emitter = _SpyEmitter()
    priced = _run(_FakeLLM(codes, omit_codes=omit), _make_items(codes), emitter, monkeypatch)

    assert {p.code for p in priced} == set(codes)          # cobertura total
    assert _recovered_codes(emitter) == omit               # solo las omitidas se recuperan
    for p in priced:
        if p.code in omit:
            assert p.match_kind == "from_scratch"
            assert p.unitPrice == 0.0
            assert p.ai_resolution.needs_human_review is True


def test_llm_crashes_in_pricing_chunk_recovered(monkeypatch):
    codes = ["P.1", "P.2", "P.3"]
    emitter = _SpyEmitter()
    priced = _run(_FakeLLM(codes, crash_pricing_codes={"P.2"}), _make_items(codes), emitter, monkeypatch)
    assert {p.code for p in priced} == set(codes)
    assert "P.2" in _recovered_codes(emitter)


def test_llm_crashes_in_deconstruction_recovered(monkeypatch):
    codes = ["P.1", "P.2", "P.3"]
    emitter = _SpyEmitter()
    priced = _run(_FakeLLM(codes, crash_deconstruct_codes={"P.3"}), _make_items(codes), emitter, monkeypatch)
    assert {p.code for p in priced} == set(codes)
    assert "P.3" in _recovered_codes(emitter)


# ---- happy path: sin fallbacks ---------------------------------------------

def test_happy_path_creates_no_fallbacks(monkeypatch):
    codes = ["P.1", "P.2", "P.3"]
    emitter = _SpyEmitter()
    priced = _run(_FakeLLM(codes), _make_items(codes), emitter, monkeypatch)
    assert {p.code for p in priced} == set(codes)
    assert _recovered_codes(emitter) == set()
    assert all(p.match_kind == "1:1" for p in priced)


# ---- escala: 20 items, omite 7 → 20 en salida ------------------------------

def test_scale_20_items_omit_7_yields_20(monkeypatch):
    # Ancho fijo (2 dígitos) para que ningún code sea substring de otro
    # (N.1 ⊂ N.11 rompería el matching del fake por substring).
    codes = [f"N.{i:02d}" for i in range(20)]
    omit = {f"N.{i:02d}" for i in (2, 5, 7, 11, 13, 17, 19)}
    emitter = _SpyEmitter()
    priced = _run(_FakeLLM(codes, omit_codes=omit), _make_items(codes), emitter, monkeypatch)
    assert len(priced) == 20
    assert {p.code for p in priced} == set(codes)
    assert _recovered_codes(emitter) == omit
    # resumen de reconciliación emitido una vez.
    recon = [e for e in emitter.events if e["type"] == "coverage_reconciliation"]
    assert len(recon) == 1
    assert recon[0]["data"]["recovered"] == 7

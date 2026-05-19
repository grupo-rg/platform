"""S2-A-06 — Fix tier display bug.

Antes (smoke 2026-05-18, 74 partidas):
  - Todos los pricings fueron Flash (default tras S1-A-01 sin ENABLE_PRO_PRICING).
  - Coste real: $0.05.
  - El panel admin reportaba "Tier Pro: 74" porque `_tier_per_code[code]['tier']`
    guardaba el `suggested_tier` (lo que la heurística recomendaba) en lugar
    del modelo REAL ejecutado.

Después (S2-A-06):
  - `_tier_per_code[code]['tier']` = modelo REAL ejecutado ('flash' o 'pro').
  - `_tier_per_code[code]['suggested_tier']` = lo que la heurística recomendaba.
  - `partida_resolved_v2` emite ambos campos para que el panel admin pueda
    distinguir "ejecutado" vs "habría sido si Pro estuviese on".

Estos tests verifican que con `ENABLE_PRO_PRICING` no set:
  - `tier_used == 'flash'` aunque `suggested_tier == 'pro'`.
  - `tier_pro_count` en `job_metrics_final` refleja Pro=0 cuando todos fueron Flash.
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


def _flash_response(match_kind="1:1", needs_review=False, price=60.0):
    return PricingFinalResultDB(
        pensamiento_calculista="flash",
        calculated_unit_price=price,
        needs_human_review=needs_review,
        match_kind=match_kind,
    )


class _RecordingLLM(ILLMProvider):
    def __init__(self, response_per_model):
        self.response_per_model = response_per_model
        self.calls: List[Dict[str, Any]] = []

    async def generate_structured(self, system_prompt, user_prompt, response_schema, **kwargs):
        model = kwargs.get("model", "gemini-2.5-flash")
        self.calls.append({"model": model})
        name = response_schema.__name__
        if name == "DeconstructResult":
            return response_schema(is_complex=False, queries=["q"]), {}
        if name == "BatchPricingEvaluatorResultV3":
            val = self.response_per_model.get(model)
            code = "TEST.1"
            return (
                BatchPricingEvaluatorResultV3(
                    results=[BatchPricedItemV3(item_code=code, valuation=val)],
                ),
                {"promptTokenCount": 100, "candidatesTokenCount": 50, "totalTokenCount": 150},
            )
        raise AssertionError(f"unexpected schema {name}")

    async def get_embedding(self, text: str):
        return [0.0] * 768


class _StubVectorSearch(IVectorSearch):
    def __init__(self, candidates):
        self._candidates = candidates

    def search_similar_items(self, query_vector, query_text, limit=4, **kwargs):
        return self._candidates


class _SpyEmitter(IGenerationEmitter):
    def __init__(self):
        self.events: List[Dict[str, Any]] = []

    def emit_event(self, budget_id, event_type, data):
        self.events.append({"type": event_type, "data": data})


def _make_svc(llm, candidates, emitter):
    return SwarmPricingService(
        llm_provider=llm,
        vector_search=_StubVectorSearch(candidates),
        emitter=emitter,
    )


def test_tier_used_reflects_real_model_not_heuristic(monkeypatch):
    """S2-A-06 — partida_resolved_v2.tier_used = modelo REAL ejecutado.

    Sin ENABLE_PRO_PRICING, una partida 'hard' (suggested_tier='pro') se
    ejecuta con Flash. El bug previo guardaba tier='pro'; el fix guarda
    tier='flash' (el modelo real).
    """
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )
    # Aseguramos: NO opt-in a Pro.
    monkeypatch.delenv("ENABLE_PRO_PRICING", raising=False)
    monkeypatch.delenv("FORCE_FLASH_PRICING", raising=False)

    llm = _RecordingLLM({"gemini-2.5-flash": _flash_response()})
    # Candidato con unit mismatch → suggested_tier='pro'.
    candidates = [{
        "id": "C1", "description": "Hora oficial", "matchScore": 0.95,
        "unit": "h", "priceTotal": 25.0,
    }]
    emitter = _SpyEmitter()
    svc = _make_svc(llm, candidates, emitter)
    items = [RestructuredItem(
        code="TEST.1", description="Tabique m2",
        quantity=10.0, unit="m2", chapter="C02",
    )]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    asyncio.run(svc.evaluate_batch(items, budget_id="b-tier-fix", metrics=metrics))

    # 1. Verificación principal: partida_resolved_v2.tier_used == 'flash'
    #    (no 'pro' como decía el bug).
    v2_events = [e for e in emitter.events if e["type"] == "partida_resolved_v2"]
    assert len(v2_events) == 1
    assert v2_events[0]["data"]["tier_used"] == "flash", (
        f"BUG REGRESS: tier_used debería ser 'flash' (modelo real ejecutado), "
        f"got {v2_events[0]['data']['tier_used']}"
    )
    # 2. La heurística sigue exponiéndose como `suggested_tier='pro'` para análisis.
    assert v2_events[0]["data"]["suggested_tier"] == "pro"


def test_tier_used_pro_when_escalation_executed(monkeypatch):
    """Cuando ENABLE_PRO_PRICING=true y Flash necesita escalation, el resultado
    final es Pro — y `tier_used` debe reflejar Pro (el modelo que produjo el
    precio final)."""
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )
    monkeypatch.setenv("ENABLE_PRO_PRICING", "true")

    llm = _RecordingLLM({
        "gemini-2.5-flash": _flash_response(match_kind="from_scratch"),
        "gemini-2.5-pro": _flash_response(price=80.0),  # final accepted result
    })
    # Candidatos fuertes → suggested_tier='flash'; pero escalation a Pro tras
    # match_kind='from_scratch'.
    candidates = [{
        "id": "C1", "description": "X", "matchScore": 0.92,
        "unit": "m2", "priceTotal": 60.0,
    }]
    emitter = _SpyEmitter()
    svc = _make_svc(llm, candidates, emitter)
    items = [RestructuredItem(
        code="TEST.1", description="X",
        quantity=10.0, unit="m2", chapter="C",
    )]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    asyncio.run(svc.evaluate_batch(items, budget_id="b-esc-tier", metrics=metrics))

    v2_events = [e for e in emitter.events if e["type"] == "partida_resolved_v2"]
    assert len(v2_events) == 1
    # Tras escalation Flash→Pro, tier_used debe ser 'pro'.
    assert v2_events[0]["data"]["tier_used"] == "pro", (
        f"Tras escalation, tier_used = 'pro'. got {v2_events[0]['data']['tier_used']}"
    )
    # `suggested_tier` mantiene la heurística original ('flash' porque
    # los candidates eran fuertes).
    assert v2_events[0]["data"]["suggested_tier"] == "flash"


def test_job_metrics_final_counts_real_executions(monkeypatch):
    """`job_metrics_final.tier_flash_count` ahora cuenta partidas que REALMENTE
    se ejecutaron con Flash, no las que la heurística etiquetaba como Flash.
    """
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )
    monkeypatch.delenv("ENABLE_PRO_PRICING", raising=False)

    # Aunque la heurística diga Pro (unit mismatch), sin opt-in todo va a Flash.
    llm = _RecordingLLM({"gemini-2.5-flash": _flash_response()})
    candidates = [{
        "id": "C1", "description": "Hora", "matchScore": 0.95,
        "unit": "h", "priceTotal": 25.0,
    }]
    emitter = _SpyEmitter()
    svc = _make_svc(llm, candidates, emitter)
    items = [RestructuredItem(
        code="TEST.1", description="Tabique",
        quantity=10.0, unit="m2", chapter="C",
    )]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    asyncio.run(svc.evaluate_batch(items, budget_id="b-metrics", metrics=metrics))

    final_events = [e for e in emitter.events if e["type"] == "job_metrics_final"]
    assert len(final_events) == 1
    data = final_events[0]["data"]
    # 1 partida ejecutada con Flash, 0 con Pro (pre-S2-A-06 reportaba 0/1).
    assert data["tier_flash_count"] == 1
    assert data["tier_pro_count"] == 0


def test_tier_reason_documents_both_real_and_suggested(monkeypatch):
    """`tier_reason` ahora documenta tanto el modelo real como la sugerencia
    de la heurística, para que un operador pueda auditar la decisión.
    """
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )
    monkeypatch.delenv("ENABLE_PRO_PRICING", raising=False)

    llm = _RecordingLLM({"gemini-2.5-flash": _flash_response()})
    candidates = [{
        "id": "C1", "description": "X", "matchScore": 0.95,
        "unit": "h", "priceTotal": 25.0,
    }]
    emitter = _SpyEmitter()
    svc = _make_svc(llm, candidates, emitter)
    items = [RestructuredItem(
        code="TEST.1", description="Y",
        quantity=10.0, unit="m2", chapter="C",
    )]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    asyncio.run(svc.evaluate_batch(items, budget_id="b-reason", metrics=metrics))

    v2_events = [e for e in emitter.events if e["type"] == "partida_resolved_v2"]
    reason = v2_events[0]["data"]["tier_reason"]
    # La razón menciona ambos: el modelo real (flash) y la sugerencia (pro).
    assert "flash" in reason.lower()
    assert "pro" in reason.lower()

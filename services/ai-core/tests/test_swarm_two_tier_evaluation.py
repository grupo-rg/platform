"""Fase 9.3 — Two-tier evaluation Flash/Pro en SwarmPricingService.

Heurística de tier selection:
- "flash" si: (a) ≥ 1 candidato, (b) top candidato tiene matchScore ≥ 0.85,
  (c) unit del top candidato coincide con unit de la partida.
- "pro" en cualquier otro caso (ambigüedad, score bajo, unit mismatch, sin
  candidatos).

Escalation post-Flash:
- Si Flash devuelve `match_kind="from_scratch"` → re-ejecutar con Pro.
- Si Flash devuelve `needs_human_review=True` → re-ejecutar con Pro.

Telemetría:
- Evento SSE `tier_assigned` con `{code, tier, reason}` por partida.
- Evento SSE `tier_escalated` cuando una Flash re-corre con Pro.
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
    MODEL_FLASH,
    MODEL_PRO,
    PricingFinalResultDB,
    SwarmPricingService,
    _resolve_pricing_model,
    _select_tier,
)


# ---- Pure helper: _select_tier ---------------------------------------------


def test_select_tier_flash_when_single_high_score_unit_match():
    candidates = [
        {"id": "C1", "matchScore": 0.92, "unit": "m2", "priceTotal": 60.0},
        {"id": "C2", "matchScore": 0.71, "unit": "m2", "priceTotal": 55.0},
    ]
    tier, reason = _select_tier(candidates, partida_unit="m2")
    assert tier == "flash"
    assert "score" in reason.lower() or "match" in reason.lower()


def test_select_tier_pro_when_no_candidates():
    tier, reason = _select_tier([], partida_unit="m2")
    assert tier == "pro"
    assert "candidatos" in reason.lower() or "no candidates" in reason.lower()


def test_select_tier_pro_when_top_score_below_threshold():
    candidates = [{"id": "C1", "matchScore": 0.70, "unit": "m2", "priceTotal": 50.0}]
    tier, reason = _select_tier(candidates, partida_unit="m2")
    assert tier == "pro"
    assert "0.7" in reason or "0.70" in reason or "threshold" in reason.lower() or "score" in reason.lower()


def test_select_tier_pro_when_unit_mismatch():
    candidates = [{"id": "C1", "matchScore": 0.95, "unit": "h", "priceTotal": 25.0}]
    tier, reason = _select_tier(candidates, partida_unit="m2")
    assert tier == "pro"
    assert "unit" in reason.lower() or "unidad" in reason.lower()


def test_select_tier_pro_when_partida_unit_missing():
    """Si la partida no tiene unidad clara, conservador → Pro."""
    candidates = [{"id": "C1", "matchScore": 0.95, "unit": "m2"}]
    tier, _ = _select_tier(candidates, partida_unit=None)
    assert tier == "pro"


def test_select_tier_normalizes_unit_aliases():
    """m² ≡ m2, Ud ≡ ud — debe entrar como flash si coinciden tras normalizar."""
    candidates = [{"id": "C1", "matchScore": 0.90, "unit": "m²"}]
    tier, _ = _select_tier(candidates, partida_unit="m2")
    assert tier == "flash"


# ---- Integration: tier dispatch in evaluate_chunk --------------------------


class _RecordingLLM(ILLMProvider):
    """Fake LLM que graba el `model` que se le pidió en cada llamada."""

    def __init__(self, response_per_model: Dict[str, PricingFinalResultDB]):
        self.response_per_model = response_per_model
        self.calls: List[Dict[str, Any]] = []

    async def generate_structured(self, system_prompt, user_prompt, response_schema, **kwargs):
        model = kwargs.get("model", "gemini-2.5-flash")
        self.calls.append({"model": model, "user_prompt_len": len(user_prompt)})
        name = response_schema.__name__
        if name == "DeconstructResult":
            return response_schema(is_complex=False, queries=["q"]), {}
        if name == "BatchPricingEvaluatorResultV3":
            val = self.response_per_model.get(model)
            if val is None:
                raise AssertionError(f"No fake response wired for model {model}")
            code = "TEST.1"
            return (
                BatchPricingEvaluatorResultV3(
                    results=[BatchPricedItemV3(item_code=code, valuation=val)],
                ),
                {},
            )
        raise AssertionError(f"Schema inesperado: {name}")

    async def get_embedding(self, text: str):
        return [0.0] * 768


class _StubVectorSearch(IVectorSearch):
    def __init__(self, candidates: List[Dict[str, Any]]):
        self._candidates = candidates

    def search_similar_items(self, query_vector, query_text, limit=4, **kwargs):
        return self._candidates


class _SpyEmitter(IGenerationEmitter):
    def __init__(self):
        self.events: List[Dict[str, Any]] = []

    def emit_event(self, budget_id, event_type, data):
        self.events.append({"type": event_type, "data": data})


def _flash_response(match_kind="1:1", needs_review=False, price=60.0):
    return PricingFinalResultDB(
        pensamiento_calculista="flash reasoning",
        calculated_unit_price=price,
        needs_human_review=needs_review,
        match_kind=match_kind,
    )


def _pro_response(price=60.0):
    return PricingFinalResultDB(
        pensamiento_calculista="pro reasoning",
        calculated_unit_price=price,
        needs_human_review=False,
        match_kind="1:1",
    )


def test_easy_partida_routed_to_flash(monkeypatch):
    """Partida con candidato fuerte (score≥0.85, unit match) → solo Flash."""
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    llm = _RecordingLLM({
        "gemini-2.5-flash": _flash_response(match_kind="1:1"),
    })
    candidates = [{"id": "C1", "description": "Tabique pladur", "matchScore": 0.92,
                   "unit": "m2", "priceTotal": 60.0}]
    svc = SwarmPricingService(
        llm_provider=llm,
        vector_search=_StubVectorSearch(candidates),
        emitter=_SpyEmitter(),
    )
    items = [RestructuredItem(code="TEST.1", description="Tabique sencillo",
                              quantity=10.0, unit="m2", chapter="C02 ALBAÑILERIA")]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    asyncio.run(svc.evaluate_batch(items, budget_id="b-easy", metrics=metrics))

    flash_calls = [c for c in llm.calls if "flash" in c["model"]]
    pro_calls = [c for c in llm.calls if "pro" in c["model"]]
    pricing_flash = [c for c in flash_calls if c["user_prompt_len"] > 50]  # excluye Deconstruct
    assert len(pricing_flash) == 1, f"esperado 1 Flash pricing, got {len(pricing_flash)}"
    assert len(pro_calls) == 0, f"NO debería llamar Pro. Got {len(pro_calls)}"


def test_hard_partida_routed_to_pro_directly(monkeypatch):
    """Partida con score bajo o unit mismatch → directo a Pro (ENABLE_PRO_PRICING=true).

    S1-A-01: Pro requiere opt-in explícito. Sin el flag, todas las partidas
    van a Flash; con el flag y suggested_tier='pro', la partida va a Pro.
    """
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )
    # Opt-in a Pro (legacy behaviour). Sin este flag iría a Flash siempre.
    monkeypatch.setenv("ENABLE_PRO_PRICING", "true")

    llm = _RecordingLLM({"gemini-2.5-pro": _pro_response()})
    candidates = [{"id": "C1", "description": "Hora oficial", "matchScore": 0.95,
                   "unit": "h", "priceTotal": 25.0}]  # mismatch unit
    svc = SwarmPricingService(
        llm_provider=llm,
        vector_search=_StubVectorSearch(candidates),
        emitter=_SpyEmitter(),
    )
    items = [RestructuredItem(code="TEST.1", description="Tabique m2",
                              quantity=10.0, unit="m2", chapter="C02 ALBAÑILERIA")]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    asyncio.run(svc.evaluate_batch(items, budget_id="b-hard", metrics=metrics))

    pro_calls = [c for c in llm.calls if "pro" in c["model"]]
    pricing_pro = [c for c in pro_calls if c["user_prompt_len"] > 50]
    assert len(pricing_pro) == 1, "Debe llamar directo a Pro"


def test_flash_escalates_to_pro_when_match_kind_from_scratch(monkeypatch):
    """Flash dice from_scratch → reintentamos con Pro automáticamente.

    S1-A-01: la escalation a Pro requiere ENABLE_PRO_PRICING=true.
    """
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )
    monkeypatch.setenv("ENABLE_PRO_PRICING", "true")

    llm = _RecordingLLM({
        "gemini-2.5-flash": _flash_response(match_kind="from_scratch"),
        "gemini-2.5-pro": _pro_response(price=80.0),
    })
    candidates = [{"id": "C1", "description": "X", "matchScore": 0.92, "unit": "m2", "priceTotal": 60.0}]
    svc = SwarmPricingService(
        llm_provider=llm,
        vector_search=_StubVectorSearch(candidates),
        emitter=_SpyEmitter(),
    )
    items = [RestructuredItem(code="TEST.1", description="X",
                              quantity=10.0, unit="m2", chapter="C")]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    priced = asyncio.run(svc.evaluate_batch(items, budget_id="b-esc", metrics=metrics))

    pricing_calls = [c for c in llm.calls if c["user_prompt_len"] > 50]
    assert any("flash" in c["model"] for c in pricing_calls), "primero Flash"
    assert any("pro" in c["model"] for c in pricing_calls), "después Pro"
    # El precio final viene de Pro (escalado).
    assert priced[0].unitPrice == pytest.approx(80.0)


def test_flash_escalates_when_needs_human_review_true(monkeypatch):
    """needs_human_review=True desde Flash → escala a Pro.

    S1-A-01: la escalation a Pro requiere ENABLE_PRO_PRICING=true.
    """
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )
    monkeypatch.setenv("ENABLE_PRO_PRICING", "true")

    llm = _RecordingLLM({
        "gemini-2.5-flash": _flash_response(match_kind="1:1", needs_review=True),
        "gemini-2.5-pro": _pro_response(price=70.0),
    })
    candidates = [{"id": "C1", "description": "X", "matchScore": 0.91, "unit": "m2", "priceTotal": 60.0}]
    svc = SwarmPricingService(
        llm_provider=llm,
        vector_search=_StubVectorSearch(candidates),
        emitter=_SpyEmitter(),
    )
    items = [RestructuredItem(code="TEST.1", description="X",
                              quantity=10.0, unit="m2", chapter="C")]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    asyncio.run(svc.evaluate_batch(items, budget_id="b-rev", metrics=metrics))

    pro_calls = [c for c in llm.calls if "pro" in c["model"] and c["user_prompt_len"] > 50]
    assert len(pro_calls) == 1, "Debe escalar a Pro tras Flash needs_review=True"


# ---- S1-A-01: _resolve_pricing_model -------------------------------------


def test_resolve_pricing_model_default_returns_flash():
    """Sin env vars, el default es Flash, independientemente del suggested_tier."""
    model, reason = _resolve_pricing_model("pro", env={})
    assert model == MODEL_FLASH
    assert "flash" in reason.lower()


def test_resolve_pricing_model_flash_suggestion_returns_flash_without_optin():
    """Sin opt-in, suggested_tier='flash' devuelve Flash con razón clara."""
    model, reason = _resolve_pricing_model("flash", env={})
    assert model == MODEL_FLASH
    assert "flash" in reason.lower()


def test_resolve_pricing_model_enable_pro_with_pro_suggestion_returns_pro():
    """Con opt-in ENABLE_PRO_PRICING=true y suggested_tier='pro' → Pro."""
    model, reason = _resolve_pricing_model("pro", env={"ENABLE_PRO_PRICING": "true"})
    assert model == MODEL_PRO
    assert "pro" in reason.lower()


def test_resolve_pricing_model_enable_pro_with_flash_suggestion_returns_flash():
    """Con opt-in pero suggested_tier='flash' sigue siendo Flash (no se fuerza)."""
    model, _ = _resolve_pricing_model("flash", env={"ENABLE_PRO_PRICING": "true"})
    assert model == MODEL_FLASH


def test_resolve_pricing_model_force_flash_legacy_is_compatible():
    """FORCE_FLASH_PRICING=true (alias deprecado) sigue forzando Flash."""
    model, reason = _resolve_pricing_model("pro", env={"FORCE_FLASH_PRICING": "true"})
    assert model == MODEL_FLASH
    assert "deprecado" in reason.lower() or "forzado" in reason.lower()


def test_resolve_pricing_model_truthy_env_var_values():
    """Reconoce '1', 'true', 'yes', 'on' como truthy (case-insensitive)."""
    for v in ["1", "true", "True", "TRUE", "yes", "on", "YES"]:
        model, _ = _resolve_pricing_model("pro", env={"ENABLE_PRO_PRICING": v})
        assert model == MODEL_PRO, f"value {v!r} not recognized as truthy"


def test_resolve_pricing_model_falsy_env_var_values():
    """Reconoce '0', 'false', '', valores arbitrarios como falsy."""
    for v in ["0", "false", "False", "no", "off", "", "anything", "  "]:
        model, _ = _resolve_pricing_model("pro", env={"ENABLE_PRO_PRICING": v})
        assert model == MODEL_FLASH, f"value {v!r} should not be truthy"


# ---- S1-A-01: end-to-end swarm uses Flash by default ---------------------


def test_swarm_uses_flash_by_default_even_when_tier_says_pro(monkeypatch):
    """Sin ENABLE_PRO_PRICING, una partida 'hard' (que la heurística etiqueta
    como pro) se tasa con Flash. La telemetría guarda tier='pro' para análisis.
    """
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )
    # Asegura que ningún var del entorno fuerza Pro.
    monkeypatch.delenv("ENABLE_PRO_PRICING", raising=False)
    monkeypatch.delenv("FORCE_FLASH_PRICING", raising=False)

    llm = _RecordingLLM({"gemini-2.5-flash": _flash_response(match_kind="1:1")})
    candidates = [{"id": "C1", "description": "Hora oficial", "matchScore": 0.95,
                   "unit": "h", "priceTotal": 25.0}]  # unit mismatch → suggested_tier='pro'
    emitter = _SpyEmitter()
    svc = SwarmPricingService(
        llm_provider=llm,
        vector_search=_StubVectorSearch(candidates),
        emitter=emitter,
    )
    items = [RestructuredItem(code="TEST.1", description="Tabique m2",
                              quantity=10.0, unit="m2", chapter="C02")]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    asyncio.run(svc.evaluate_batch(items, budget_id="b-default-flash", metrics=metrics))

    pricing_calls = [c for c in llm.calls if c["user_prompt_len"] > 50]
    assert all("flash" in c["model"] for c in pricing_calls), (
        "Sin opt-in, todas las llamadas de pricing deben usar Flash"
    )

    # Telemetría preserva el tier sugerido.
    tier_events = [e for e in emitter.events if e["type"] == "tier_assigned"]
    assert tier_events and tier_events[0]["data"]["tier"] == "pro"

    # Nuevo evento de resolución del modelo expone qué se ejecutó.
    model_events = [e for e in emitter.events if e["type"] == "pricing_model_resolved"]
    assert model_events
    assert model_events[0]["data"]["model"] == "gemini-2.5-flash"
    assert model_events[0]["data"]["suggested_tier"] == "pro"


def test_swarm_suppresses_escalation_without_optin(monkeypatch):
    """Sin ENABLE_PRO_PRICING, una Flash que dice 'from_scratch' NO se escala a Pro.
    El evento 'tier_escalation_suppressed' se emite para análisis.
    """
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )
    monkeypatch.delenv("ENABLE_PRO_PRICING", raising=False)

    llm = _RecordingLLM({"gemini-2.5-flash": _flash_response(match_kind="from_scratch")})
    candidates = [{"id": "C1", "description": "X", "matchScore": 0.92,
                   "unit": "m2", "priceTotal": 60.0}]
    emitter = _SpyEmitter()
    svc = SwarmPricingService(
        llm_provider=llm,
        vector_search=_StubVectorSearch(candidates),
        emitter=emitter,
    )
    items = [RestructuredItem(code="TEST.1", description="X",
                              quantity=10.0, unit="m2", chapter="C")]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    asyncio.run(svc.evaluate_batch(items, budget_id="b-suppress", metrics=metrics))

    pro_calls = [c for c in llm.calls if "pro" in c["model"]]
    assert len(pro_calls) == 0, "Pro NO debe llamarse sin ENABLE_PRO_PRICING"

    suppressed = [e for e in emitter.events if e["type"] == "tier_escalation_suppressed"]
    assert suppressed, "Debe emitirse tier_escalation_suppressed"
    assert suppressed[0]["data"]["match_kind"] == "from_scratch"


def test_telemetry_emits_tier_assigned_event(monkeypatch):
    """Por cada partida se emite `tier_assigned` con tier + reason."""
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    llm = _RecordingLLM({"gemini-2.5-flash": _flash_response()})
    candidates = [{"id": "C1", "description": "X", "matchScore": 0.95, "unit": "m2", "priceTotal": 60.0}]
    emitter = _SpyEmitter()
    svc = SwarmPricingService(
        llm_provider=llm, vector_search=_StubVectorSearch(candidates), emitter=emitter,
    )
    items = [RestructuredItem(code="TEST.1", description="X",
                              quantity=10.0, unit="m2", chapter="C")]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    asyncio.run(svc.evaluate_batch(items, budget_id="b-telem", metrics=metrics))

    tier_events = [e for e in emitter.events if e["type"] == "tier_assigned"]
    assert len(tier_events) == 1
    assert tier_events[0]["data"]["tier"] == "flash"
    assert tier_events[0]["data"]["code"] == "TEST.1"
    assert "reason" in tier_events[0]["data"]

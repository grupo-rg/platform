"""Fase 9.1 — bug fix del Judge `calculated_total_price` → `calculated_unit_price`.

Bug observado: el LLM emite `total = unit × quantity` en el campo, el boundary
multiplica × quantity OTRA VEZ. Resultado: precios totales inflados ×N (caso
SANITAS C02.01: 60.46 €/m² × 339.02 m² → quedó como unitPrice 20.496 €/m² →
totalPrice 6,948,638 €).

Causa raíz: nombre del campo `calculated_total_price` con description "al m2"
es contradictorio. Pydantic structured-output expone el nombre al LLM como
guía semántica → cuando hay matemáticas, el LLM obedece al "total" del nombre.

Fix: rename a `calculated_unit_price` con description y prompts inequívocos;
sanity guard post-hoc en el boundary que detecta runaway pricing.
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
    PricingFinalResultDB,
    SwarmPricingService,
)


class _SpyEmitter(IGenerationEmitter):
    def __init__(self):
        self.events: List[Dict[str, Any]] = []

    def emit_event(self, budget_id: str, event_type: str, data: Dict[str, Any]) -> None:
        self.events.append({"budget_id": budget_id, "type": event_type, "data": data})


def _build_fake_llm(unit_price: float, match_kind: str = "1:1") -> ILLMProvider:
    class _FakeLLM(ILLMProvider):
        async def generate_structured(
            self, system_prompt, user_prompt, response_schema, **kwargs
        ):
            name = response_schema.__name__
            if name == "DeconstructResult":
                return response_schema(is_complex=False, queries=["q"]), {}
            if name == "BatchPricingEvaluatorResultV3":
                val = PricingFinalResultDB(
                    pensamiento_calculista=f"Precio unitario: {unit_price} €/unit",
                    calculated_unit_price=unit_price,
                    needs_human_review=False,
                    match_kind=match_kind,
                )
                # Extraemos el código del user prompt para mantener mapping
                code = "TEST.1"
                if "ANYCODE.1" in user_prompt:
                    code = "ANYCODE.1"
                return (
                    BatchPricingEvaluatorResultV3(
                        results=[BatchPricedItemV3(item_code=code, valuation=val)]
                    ),
                    {},
                )
            raise AssertionError(f"Schema inesperado: {name}")

        async def get_embedding(self, text: str):
            return [0.0] * 768

    return _FakeLLM()


class _FakeVectorSearch(IVectorSearch):
    def search_similar_items(self, query_vector, query_text, limit=4, **kwargs):
        return [{
            "id": "FBY010a",
            "description": "Tabique sencillo de 78 mm",
            "priceTotal": 55.93,
            "unit": "m2",
            "matchScore": 0.85,
        }]


# ---- Schema test ------------------------------------------------------------


def test_pricing_schema_uses_calculated_unit_price():
    """El campo se llama `calculated_unit_price` (no `calculated_total_price`)."""
    val = PricingFinalResultDB(
        pensamiento_calculista="...",
        calculated_unit_price=60.46,
        needs_human_review=False,
        match_kind="1:1",
    )
    assert val.calculated_unit_price == 60.46
    # El campo deprecated NO debe existir.
    assert not hasattr(val, "calculated_total_price")


# ---- Boundary test: unit price flow correcto -------------------------------


def test_boundary_uses_unit_price_not_pre_multiplied(monkeypatch):
    """Con calculated_unit_price=60.46 y quantity=339.02:
    - unitPrice = 60.46 (no 60.46 × 339.02)
    - totalPrice = 20,496.25 (calculado por el sistema)
    """
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    svc = SwarmPricingService(
        llm_provider=_build_fake_llm(unit_price=60.46),
        vector_search=_FakeVectorSearch(),
        emitter=_SpyEmitter(),
    )
    items = [RestructuredItem(
        code="TEST.1",
        description="Tabique 100mm",
        quantity=339.02,
        unit="m2",
        chapter="C02 ALBAÑILERIA",
    )]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    priced = asyncio.run(svc.evaluate_batch(items, budget_id="b-9.1", metrics=metrics))

    assert len(priced) == 1
    p = priced[0]
    assert p.unitPrice == 60.46, f"unitPrice debe ser 60.46, fue {p.unitPrice}"
    expected_total = round(60.46 * 339.02, 2)
    assert abs(p.totalPrice - expected_total) < 0.01, (
        f"totalPrice debe ser {expected_total}, fue {p.totalPrice}"
    )


# ---- Sanity guard: runaway price detection ---------------------------------


def test_sanity_guard_detects_runaway_price_for_common_unit(monkeypatch):
    """Si calculated_unit_price * quantity > 100K Y unidad común (m², m³, ml, ud):
    - Emite WARNING via SSE event `partida_price_anomaly`.
    - Marca `needs_human_review = True` en la partida final.
    El item NO se filtra — sigue al budget para revisión humana.
    """
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    # unit_price 1500 €/m² × 100 m² = 150,000 € → debe disparar guard.
    svc = SwarmPricingService(
        llm_provider=_build_fake_llm(unit_price=1500.0, match_kind="1:1"),
        vector_search=_FakeVectorSearch(),
        emitter=_SpyEmitter(),
    )
    items = [RestructuredItem(
        code="ANYCODE.1",
        description="Partida común",
        quantity=100.0,
        unit="m2",
        chapter="C04 PAVIMENTOS",
    )]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    priced = asyncio.run(svc.evaluate_batch(items, budget_id="b-anomaly", metrics=metrics))

    assert len(priced) == 1
    p = priced[0]
    # El item sigue, no se filtra.
    assert p.code == "ANYCODE.1"
    # El guard fuerza review.
    assert p.ai_resolution.needs_human_review is True

    # Evento SSE específico emitido.
    anomaly_events = [e for e in svc.emitter.events if e["type"] == "partida_price_anomaly"]
    assert len(anomaly_events) == 1
    assert anomaly_events[0]["data"]["code"] == "ANYCODE.1"
    assert anomaly_events[0]["data"]["unit_price"] == 1500.0
    assert anomaly_events[0]["data"]["total_price"] == 150000.0


def test_sanity_guard_does_not_fire_for_PA_partidas(monkeypatch):
    """Partidas alzadas (PA) tienen precios elevados legítimos. No disparar guard."""
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    svc = SwarmPricingService(
        llm_provider=_build_fake_llm(unit_price=200000.0, match_kind="from_scratch"),
        vector_search=_FakeVectorSearch(),
        emitter=_SpyEmitter(),
    )
    items = [RestructuredItem(
        code="PA.1",
        description="Seguridad y salud",
        quantity=1.0,
        unit="PA",
        chapter="C99 VARIOS",
    )]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    asyncio.run(svc.evaluate_batch(items, budget_id="b-pa", metrics=metrics))

    anomaly_events = [e for e in svc.emitter.events if e["type"] == "partida_price_anomaly"]
    assert anomaly_events == []


def test_sanity_guard_does_not_fire_for_normal_prices(monkeypatch):
    """60 €/m² × 100 m² = 6,000 €. Bajo el umbral. Sin guard."""
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    svc = SwarmPricingService(
        llm_provider=_build_fake_llm(unit_price=60.0),
        vector_search=_FakeVectorSearch(),
        emitter=_SpyEmitter(),
    )
    items = [RestructuredItem(
        code="TEST.1",
        description="Normal",
        quantity=100.0,
        unit="m2",
        chapter="C04 PAVIMENTOS",
    )]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    asyncio.run(svc.evaluate_batch(items, budget_id="b-normal", metrics=metrics))

    anomaly_events = [e for e in svc.emitter.events if e["type"] == "partida_price_anomaly"]
    assert anomaly_events == []

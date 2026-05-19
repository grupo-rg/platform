"""S1-A-05 — Filtros estructurales pre-vector en SwarmPricingService.

Antes del retrieval, derivamos:
  - ``chapter_filter`` cuando ``RestructuredItem.chapter`` es confiable
    (no alucinación, no en la lista de baja confianza).
  - ``unit_dimension_filter`` cuando la partida lo trae.

Estos filtros se pasan al ``HybridCatalogSearch`` (o al vector search
legacy) para reducir el pool antes del retrieval.

Tests:
  1. ``_derive_structural_filters`` con casos puros (capítulo confiable,
     capítulo alucinado, capítulo en lista negra, sin chapter, etc.).
  2. Integration: una partida con capítulo confiable hace que el adapter
     reciba el filtro.
  3. Integration: una partida en VARIOS / SIN CAPÍTULO NO propaga el filtro.
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

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
    _derive_structural_filters,
)


# ---- Pure helper -----------------------------------------------------------


def test_derive_filters_confident_chapter():
    item = RestructuredItem(
        code="X.1", description="d", quantity=1.0, unit="m2",
        chapter="03 HORMIGONES",
    )
    f = _derive_structural_filters(item)
    assert f["chapter_filter"] == "03 HORMIGONES"


def test_derive_filters_hallucinated_chapter_is_dropped():
    for bad in ["[UNKNOWN]", "NO ENCONTRADO", "NOT FOUND", "[CAPÍTULO X]"]:
        item = RestructuredItem(
            code="X.1", description="d", quantity=1.0, unit="m2", chapter=bad,
        )
        f = _derive_structural_filters(item)
        assert f["chapter_filter"] is None, f"chapter {bad!r} debería caerse"


def test_derive_filters_low_confidence_chapter_is_dropped():
    for low in ["VARIOS", "Sin Capítulo", "SIN CAPITULO", "OTROS", "general"]:
        item = RestructuredItem(
            code="X.1", description="d", quantity=1.0, unit="m2", chapter=low,
        )
        f = _derive_structural_filters(item)
        assert f["chapter_filter"] is None, f"chapter {low!r} debería caerse"


def test_derive_filters_empty_chapter_is_dropped():
    item = RestructuredItem(
        code="X.1", description="d", quantity=1.0, unit="m2", chapter="",
    )
    f = _derive_structural_filters(item)
    assert f["chapter_filter"] is None


def test_derive_filters_unit_dimension_passed_when_present():
    item = RestructuredItem(
        code="X.1", description="d", quantity=1.0, unit="m2",
        chapter="03 HORMIGONES", unit_dimension="surface_area",
    )
    f = _derive_structural_filters(item)
    assert f["unit_dimension_filter"] == "surface_area"


def test_derive_filters_unit_dimension_none_when_missing():
    item = RestructuredItem(
        code="X.1", description="d", quantity=1.0, unit="m2",
        chapter="03 HORMIGONES",
    )
    f = _derive_structural_filters(item)
    assert f["unit_dimension_filter"] is None


# ---- Integration: filters reach the adapter ------------------------------


class _RecordingVectorSearch(IVectorSearch):
    """Vector search fake que graba los filtros con los que se llama."""

    def __init__(self):
        self.last_call_kwargs: Optional[Dict[str, Any]] = None

    def search_similar_items(self, query_vector, query_text="", limit=4, **kwargs):
        self.last_call_kwargs = {"query_text": query_text, "limit": limit, **kwargs}
        # Devolvemos un candidato bueno.
        return [{
            "id": "C1",
            "code": "C1",
            "description": "match",
            "matchScore": 0.95,
            "unit": "m2",
            "unit_normalized": "m2",
            "priceTotal": 10.0,
        }]


class _StubLLM(ILLMProvider):
    async def generate_structured(self, system_prompt, user_prompt, response_schema, **kwargs):
        name = response_schema.__name__
        if name == "DeconstructResult":
            return response_schema(is_complex=False, queries=["q"]), {}
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


class _SpyEmitter(IGenerationEmitter):
    def __init__(self):
        self.events: List[Dict[str, Any]] = []

    def emit_event(self, budget_id, event_type, data):
        self.events.append({"type": event_type, "data": data})


def test_swarm_propagates_chapter_filter_to_vector_search(monkeypatch):
    """Con un capítulo confiable, el vector_search adapter recibe el filtro."""
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    vs = _RecordingVectorSearch()
    svc = SwarmPricingService(
        llm_provider=_StubLLM(),
        vector_search=vs,
        emitter=_SpyEmitter(),
    )
    items = [RestructuredItem(
        code="X.1", description="Solera hormigón", quantity=10.0, unit="m2",
        chapter="03 HORMIGONES", unit_dimension="surface_area",
    )]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    asyncio.run(svc.evaluate_batch(items, budget_id="b-flt", metrics=metrics))

    assert vs.last_call_kwargs is not None
    assert vs.last_call_kwargs.get("chapter_filters") == ["03 HORMIGONES"]
    assert vs.last_call_kwargs.get("partida_unit_dimension") == "surface_area"


def test_swarm_does_not_propagate_filter_for_unknown_chapter(monkeypatch):
    """Para capítulos en blacklist, NO se pasa chapter_filters al adapter."""
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    vs = _RecordingVectorSearch()
    svc = SwarmPricingService(
        llm_provider=_StubLLM(),
        vector_search=vs,
        emitter=_SpyEmitter(),
    )
    items = [RestructuredItem(
        code="X.1", description="d", quantity=10.0, unit="m2",
        chapter="VARIOS",
    )]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    asyncio.run(svc.evaluate_batch(items, budget_id="b-no-flt", metrics=metrics))

    assert vs.last_call_kwargs is not None
    assert vs.last_call_kwargs.get("chapter_filters") is None


def test_swarm_emits_structural_filters_applied_event(monkeypatch):
    """Se emite el evento `structural_filters_applied` con lo aplicado."""
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    emitter = _SpyEmitter()
    svc = SwarmPricingService(
        llm_provider=_StubLLM(),
        vector_search=_RecordingVectorSearch(),
        emitter=emitter,
    )
    items = [RestructuredItem(
        code="X.1", description="d", quantity=10.0, unit="m2",
        chapter="03 HORMIGONES", unit_dimension="surface_area",
    )]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    asyncio.run(svc.evaluate_batch(items, budget_id="b-event", metrics=metrics))

    events = [e for e in emitter.events if e["type"] == "structural_filters_applied"]
    assert events
    data = events[0]["data"]
    assert data["chapter_filter"] == "03 HORMIGONES"
    assert data["unit_dimension_filter"] == "surface_area"

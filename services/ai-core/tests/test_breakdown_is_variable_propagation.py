"""Fase 9.7 — propagación del flag `is_variable` end-to-end.

El catálogo COAATMCA distingue por componente del breakdown si es material
variable (suministro) o no variable (mano de obra, medios auxiliares). El
editor del frontend lo necesita para los modos `Sólo Ejecución` y
`Exclusivamente Mano de Obra`. Hasta esta fase el flag se perdía: el schema
del Pydantic que el LLM emite no lo tenía, el boundary no lo copiaba, y el
entity del domain tampoco lo declaraba. El frontend recibía `undefined` y
deshabilitaba esos modos.

Esta fase añade el campo en las 3 capas (schema, entity, boundary) +
instrucción en el prompt para que el LLM lo emita por componente.
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
    BreakdownComponentSchema,
    PricingFinalResultDB,
    SwarmPricingService,
)
from src.budget.domain.entities import BudgetBreakdownComponent


# ---- Schema test ----------------------------------------------------------


def test_breakdown_component_schema_has_is_variable_field():
    """`BreakdownComponentSchema` debe aceptar `is_variable`. Default False
    para retrocompat cuando el LLM no emite el campo."""
    comp = BreakdownComponentSchema(
        code="MAT-X",
        concept="Cerámica",
        type="MATERIAL",
        price=15.0,
        yield_val=1.0,
        total=15.0,
    )
    assert comp.is_variable is False  # default

    comp2 = BreakdownComponentSchema(
        code="MAT-X",
        concept="Cerámica",
        type="MATERIAL",
        price=15.0,
        yield_val=1.0,
        total=15.0,
        is_variable=True,
    )
    assert comp2.is_variable is True


def test_budget_breakdown_component_entity_has_is_variable():
    """El entity domain debe tener `is_variable: Optional[bool] = None`."""
    comp = BudgetBreakdownComponent(
        code="MAT-X", concept="X", type="MATERIAL",
        price=15.0, yield_amount=1.0, total=15.0,
    )
    assert comp.is_variable is None  # default Optional para retrocompat

    comp2 = BudgetBreakdownComponent(
        code="MAT-X", concept="X", type="MATERIAL",
        price=15.0, yield_amount=1.0, total=15.0,
        is_variable=True,
    )
    assert comp2.is_variable is True


# ---- Boundary integration test --------------------------------------------


class _SpyEmitter(IGenerationEmitter):
    def emit_event(self, *args, **kwargs):
        pass


def _build_fake_llm_with_breakdown(breakdown_specs: List[Dict[str, Any]]) -> ILLMProvider:
    class _FakeLLM(ILLMProvider):
        async def generate_structured(self, system_prompt, user_prompt, response_schema, **kwargs):
            name = response_schema.__name__
            if name == "DeconstructResult":
                return response_schema(is_complex=True, queries=["q1", "q2"]), {}
            if name == "BatchPricingEvaluatorResultV3":
                breakdown = [
                    BreakdownComponentSchema(
                        code=spec["code"],
                        concept=spec["concept"],
                        type=spec.get("type", "OTHER"),
                        price=spec.get("price", 10.0),
                        yield_val=spec.get("yield_val", 1.0),
                        total=spec.get("total", 10.0),
                        is_variable=spec.get("is_variable", False),
                    )
                    for spec in breakdown_specs
                ]
                val = PricingFinalResultDB(
                    pensamiento_calculista="composite 1:N",
                    calculated_unit_price=100.0,
                    needs_human_review=False,
                    match_kind="1:N",
                    breakdown=breakdown,
                )
                return (
                    BatchPricingEvaluatorResultV3(results=[
                        BatchPricedItemV3(item_code="TEST.1", valuation=val),
                    ]),
                    {},
                )
            if name == "CandidateRerankResult":
                from src.budget.application.services.swarm_pricing_service import CandidateRerankResult
                return CandidateRerankResult(selected_ids=["C1"], reason=""), {}
            raise AssertionError(f"Schema inesperado: {name}")

        async def get_embedding(self, text: str):
            return [0.0] * 768

    return _FakeLLM()


class _StubVS(IVectorSearch):
    def search_similar_items(self, query_vector, query_text, limit=4, **kwargs):
        return [{"id": "C1", "description": "X", "matchScore": 0.40, "unit": "m2", "priceTotal": 50.0}]


def test_boundary_propagates_is_variable_into_partida_breakdown(monkeypatch):
    """El LLM emite breakdown con flags mixtos (material=True, mano de obra=False).
    El boundary los copia al `BudgetPartida.breakdown` sin perder ninguno."""
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    breakdown_specs = [
        {"code": "MAT-CER", "concept": "Cerámica gres", "type": "MATERIAL",
         "price": 25.0, "yield_val": 1.05, "total": 26.25, "is_variable": True},
        {"code": "MO-OF1", "concept": "Oficial 1ª albañil", "type": "LABOR",
         "price": 28.5, "yield_val": 0.5, "total": 14.25, "is_variable": False},
        {"code": "AUX-MA", "concept": "Medios auxiliares", "type": "OTHER",
         "price": 2.0, "yield_val": 1.0, "total": 2.0, "is_variable": False},
    ]
    svc = SwarmPricingService(
        llm_provider=_build_fake_llm_with_breakdown(breakdown_specs),
        vector_search=_StubVS(),
        emitter=_SpyEmitter(),
    )
    items = [RestructuredItem(
        code="TEST.1", description="Solado gres porcelánico",
        quantity=20.0, unit="m2", chapter="C04 PAVIMENTOS",
    )]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    priced = asyncio.run(svc.evaluate_batch(items, budget_id="b-isv", metrics=metrics))

    assert len(priced) == 1
    p = priced[0]
    assert p.breakdown is not None
    assert len(p.breakdown) == 3
    by_code = {c.code: c for c in p.breakdown}
    assert by_code["MAT-CER"].is_variable is True
    assert by_code["MO-OF1"].is_variable is False
    assert by_code["AUX-MA"].is_variable is False

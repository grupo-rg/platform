"""Fase 5.E — el boundary DTO→Domain copia `match_kind` y `unit_conversion_applied`
del `PricingFinalResultDB` al `BudgetPartida` final.

Sin este paso, los nuevos campos del Judge (5.A) se quedarían en el mundo del
dominio de pricing y nunca llegarían al repositorio / Firestore / UI. La UI
del editor los necesita para pintar el panel de auditoría (5.F).

Invariantes:
  1. `BudgetPartida` acepta ambos campos como Optional — presupuestos históricos
     (escritos antes de 5.E) se siguen deserializando sin romper.
  2. Tras `evaluate_batch`, `match_kind` y `unit_conversion_applied` están presentes
     en el `BudgetPartida` con los valores que el Judge devolvió.
  3. Los campos se serializan a un dict plano válido para Firestore.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

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
    UnitConversionRecord,
)
from src.budget.domain.entities import BudgetPartida


class _SpyEmitter(IGenerationEmitter):
    def __init__(self):
        self.events: List[Dict[str, Any]] = []

    def emit_event(self, budget_id: str, event_type: str, data: Dict[str, Any]) -> None:
        self.events.append({"budget_id": budget_id, "type": event_type, "data": data})


# -------- Invariante 1: BudgetPartida acepta ambos campos como Optional -----


def test_budget_partida_accepts_match_kind_and_conversion_as_optional() -> None:
    """Compatibilidad hacia atrás: `BudgetPartida` se construye sin esos campos."""
    p = BudgetPartida(
        id="p-1",
        order=1,
        code="1.1",
        description="Legacy partida",
        unit="ud",
        quantity=1.0,
        unitPrice=10.0,
        totalPrice=10.0,
    )
    assert p.match_kind is None
    assert p.unit_conversion_applied is None


def test_budget_partida_accepts_match_kind_and_conversion_when_provided() -> None:
    p = BudgetPartida(
        id="p-2",
        order=1,
        code="1.1",
        description="Nueva partida v005",
        unit="m3",
        quantity=5.0,
        unitPrice=30.0,
        totalPrice=150.0,
        match_kind="1:N",
        unit_conversion_applied={
            "value": 50.0,
            "from_unit": "m2",
            "to_unit": "m3",
            "bridge": {"thickness_m": 0.10},
            "result": 5.0,
        },
    )
    assert p.match_kind == "1:N"
    assert p.unit_conversion_applied["result"] == 5.0


# -------- Invariante 2 + 3: el boundary copia del DB al BudgetPartida --------


def test_boundary_copies_match_kind_and_conversion_from_judge(monkeypatch) -> None:
    class _FakeLLM(ILLMProvider):
        async def generate_structured(
            self, system_prompt, user_prompt, response_schema, **kwargs
        ):
            name = response_schema.__name__
            if name == "DeconstructResult":
                return response_schema(is_complex=False, queries=["q"]), {}
            if name == "BatchPricingEvaluatorResultV3":
                if "GRAVA.1" in user_prompt:
                    val = PricingFinalResultDB(
                        pensamiento_calculista="grava 50 m2 × 0.10 m = 5 m3; precio/m3 = 30€",
                        calculated_unit_price=150.0,
                        needs_human_review=False,
                        match_kind="1:N",
                        unit_conversion_applied=UnitConversionRecord(
                            value=50.0,
                            from_unit="m2",
                            to_unit="m3",
                            bridge={"thickness_m": 0.10},
                            result=5.0,
                        ),
                    )
                    return (
                        BatchPricingEvaluatorResultV3(
                            results=[BatchPricedItemV3(item_code="GRAVA.1", valuation=val)]
                        ),
                        {},
                    )
                if "SIMPLE.1" in user_prompt:
                    val = PricingFinalResultDB(
                        pensamiento_calculista="match directo",
                        calculated_unit_price=100.0,
                        needs_human_review=False,
                        match_kind="1:1",
                    )
                    return (
                        BatchPricingEvaluatorResultV3(
                            results=[BatchPricedItemV3(item_code="SIMPLE.1", valuation=val)]
                        ),
                        {},
                    )
                return BatchPricingEvaluatorResultV3(results=[]), {}
            raise AssertionError(f"Schema inesperado: {name}")

        async def get_embedding(self, text: str):
            return [0.0] * 768

    class _FakeVectorSearch(IVectorSearch):
        def search_similar_items(self, query_vector, query_text, limit=4, **kwargs):
            return [
                {
                    "id": "cand-1",
                    "description": "Candidato",
                    "priceTotal": 30.0,
                    "unit": "m3",
                    "matchScore": 0.9,
                }
            ]

    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    svc = SwarmPricingService(
        llm_provider=_FakeLLM(),
        vector_search=_FakeVectorSearch(),
        emitter=_SpyEmitter(),
    )

    items = [
        RestructuredItem(
            code="GRAVA.1",
            description="Capa de grava 10 cm sobre 50 m2",
            quantity=50.0,
            unit="m2",
            chapter="MOVIMIENTO DE TIERRAS",
        ),
        RestructuredItem(
            code="SIMPLE.1",
            description="Partida ordinaria 1:1",
            quantity=1.0,
            unit="ud",
            chapter="OBRAS VARIAS",
        ),
    ]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    priced = asyncio.run(svc.evaluate_batch(items, budget_id="b-5e", metrics=metrics))

    by_code = {p.code: p for p in priced}

    assert by_code["GRAVA.1"].match_kind == "1:N"
    conv = by_code["GRAVA.1"].unit_conversion_applied
    assert isinstance(conv, dict), (
        "unit_conversion_applied debe serializarse a dict plano "
        "para ser guardable directamente en Firestore"
    )
    assert conv["from_unit"] == "m2"
    assert conv["to_unit"] == "m3"
    assert conv["result"] == 5.0
    assert conv["bridge"] == {"thickness_m": 0.10}

    assert by_code["SIMPLE.1"].match_kind == "1:1"
    assert by_code["SIMPLE.1"].unit_conversion_applied is None

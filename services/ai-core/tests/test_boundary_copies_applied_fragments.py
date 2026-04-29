"""Fase 6.D — el boundary copia los `applied_fragments` del Swarm al BudgetPartida.

Invariantes:
  1. `BudgetPartida` acepta `applied_fragments` como `Optional[List[str]]` —
     presupuestos históricos (escritos antes de 6.D) siguen leyéndose sin romper.
  2. Tras `evaluate_batch`, si el Swarm encontró fragments relevantes y los
     inyectó en el prompt, el `BudgetPartida` final lleva la lista de IDs.
  3. El `ai_resolution.reasoning_trace` del partida incluye una nota tipo
     "Aplicado fragment #frag-xyz" cuando hubo fragments; en caso contrario no
     se modifica el razonamiento del Judge.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
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
from src.budget.domain.entities import (
    BudgetPartida,
    HeuristicAIInferenceTrace,
    HeuristicContext,
    HeuristicFragment,
    HeuristicHumanCorrection,
)
from src.budget.learning.infrastructure.adapters.in_memory_heuristic_fragment_repository import (
    InMemoryHeuristicFragmentRepository,
)


# -------- Invariante 1: BudgetPartida acepta applied_fragments como Optional ---------


def test_budget_partida_accepts_applied_fragments_as_optional() -> None:
    p = BudgetPartida(
        id="p-1",
        order=1,
        code="1.1",
        description="Legacy sin fragments",
        unit="ud",
        quantity=1.0,
        unitPrice=10.0,
        totalPrice=10.0,
    )
    assert p.applied_fragments is None


def test_budget_partida_serializes_applied_fragments_list() -> None:
    p = BudgetPartida(
        id="p-2",
        order=1,
        code="1.1",
        description="Partida v006 con fragments",
        unit="m2",
        quantity=20.0,
        unitPrice=22.0,
        totalPrice=440.0,
        applied_fragments=["frag-abc", "frag-def"],
    )
    dumped = p.model_dump()
    assert dumped["applied_fragments"] == ["frag-abc", "frag-def"]


# -------- Shared test fixtures -------------------------------------------------------


class _SpyEmitter(IGenerationEmitter):
    def emit_event(self, budget_id: str, event_type: str, data: Dict[str, Any]) -> None:
        pass


class _FakeLLM(ILLMProvider):
    async def generate_structured(
        self, system_prompt, user_prompt, response_schema, **kwargs
    ):
        name = response_schema.__name__
        if name == "DeconstructResult":
            return response_schema(is_complex=False, queries=["q"]), {}
        if name == "BatchPricingEvaluatorResultV3":
            val = PricingFinalResultDB(
                pensamiento_calculista="Razonamiento base del Judge",
                calculated_unit_price=440.0,
                needs_human_review=False,
                match_kind="1:1",
            )
            # Extraemos el código de partida del user prompt para preservar el mapping.
            code = "DEM.1" if "DEM.1" in user_prompt else "OTHER.1"
            return (
                BatchPricingEvaluatorResultV3(
                    results=[BatchPricedItemV3(item_code=code, valuation=val)]
                ),
                {},
            )
        raise AssertionError(f"Schema inesperado: {name}")

    async def get_embedding(self, text: str):
        return [0.0] * 768


class _FakeVectorSearch(IVectorSearch):
    def search_similar_items(self, query_vector, query_text, limit=4, **kwargs):
        return [
            {
                "id": "cand-1",
                "description": "Candidato",
                "priceTotal": 22.0,
                "unit": "m2",
                "matchScore": 0.9,
            }
        ]


def _make_golden_fragment(frag_id: str) -> HeuristicFragment:
    return HeuristicFragment(
        id=frag_id,
        sourceType="internal_admin",
        status="golden",
        context=HeuristicContext(
            budgetId="b-old",
            originalDescription="Demolición alicatado paredes baño",
            originalQuantity=20.0,
            originalUnit="m2",
        ),
        aiInferenceTrace=HeuristicAIInferenceTrace(proposedUnitPrice=25.0),
        humanCorrection=HeuristicHumanCorrection(
            correctedUnitPrice=22.0,
            heuristicRule="volumen: descuento proveedor > 15 m2",
        ),
        tags=["chapter:DEMOLICIONES", "reason:volumen"],
        timestamp=datetime.now(timezone.utc),
    )


# -------- Invariante 2: boundary copia applied_fragments del Swarm a la partida ------


def test_boundary_copies_applied_fragments_when_fragments_injected(monkeypatch) -> None:
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    repo = InMemoryHeuristicFragmentRepository()
    asyncio.run(repo.save(_make_golden_fragment("frag-1")))
    asyncio.run(repo.save(_make_golden_fragment("frag-2")))

    svc = SwarmPricingService(
        llm_provider=_FakeLLM(),
        vector_search=_FakeVectorSearch(),
        emitter=_SpyEmitter(),
        fragment_repo=repo,
    )

    items = [
        RestructuredItem(
            code="DEM.1",
            description="Demolición de alicatado en paredes de baño reforma",
            quantity=20.0,
            unit="m2",
            chapter="DEMOLICIONES",
        ),
    ]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    priced = asyncio.run(svc.evaluate_batch(items, budget_id="b-6d", metrics=metrics))

    by_code = {p.code: p for p in priced}
    assert by_code["DEM.1"].applied_fragments is not None
    assert set(by_code["DEM.1"].applied_fragments) == {"frag-1", "frag-2"}


def test_boundary_leaves_applied_fragments_none_when_no_repo(monkeypatch) -> None:
    """Sin repo de fragments, el partida no debe llevar applied_fragments —
    no es que sea `[]`, es que es `None` (se distingue entre 'no había' vs
    'se buscó y no había nada')."""
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    svc = SwarmPricingService(
        llm_provider=_FakeLLM(),
        vector_search=_FakeVectorSearch(),
        emitter=_SpyEmitter(),
        # fragment_repo=None explícitamente omitido
    )

    items = [
        RestructuredItem(
            code="OTHER.1",
            description="Partida sin historia",
            quantity=1.0,
            unit="ud",
            chapter="OBRAS VARIAS",
        ),
    ]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    priced = asyncio.run(svc.evaluate_batch(items, budget_id="b-6d-no-repo", metrics=metrics))

    assert priced[0].applied_fragments is None


# -------- Invariante 3: razonamiento incluye una nota cuando hay fragments ----------


def test_reasoning_trace_includes_fragment_note_when_fragments_applied(monkeypatch) -> None:
    monkeypatch.setattr(
        SwarmPricingService,
        "_load_prompt",
        lambda self, filename, **kwargs: ("sys", kwargs.get("batch_items", "")),
    )

    repo = InMemoryHeuristicFragmentRepository()
    asyncio.run(repo.save(_make_golden_fragment("frag-a")))
    asyncio.run(repo.save(_make_golden_fragment("frag-b")))

    svc = SwarmPricingService(
        llm_provider=_FakeLLM(),
        vector_search=_FakeVectorSearch(),
        emitter=_SpyEmitter(),
        fragment_repo=repo,
    )

    items = [
        RestructuredItem(
            code="DEM.1",
            description="Demolición de alicatado paredes baño",
            quantity=20.0,
            unit="m2",
            chapter="DEMOLICIONES",
        ),
    ]
    metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    priced = asyncio.run(svc.evaluate_batch(items, budget_id="b-6d-trace", metrics=metrics))

    partida = priced[0]
    assert partida.ai_resolution is not None
    trace = partida.ai_resolution.reasoning_trace
    assert "fragment" in trace.lower()
    # La nota hace referencia al menos a uno de los IDs inyectados.
    assert "frag-a" in trace or "frag-b" in trace

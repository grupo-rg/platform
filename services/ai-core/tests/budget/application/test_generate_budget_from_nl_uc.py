"""
Tests de contrato para GenerateBudgetFromNlUseCase.

No invocan LLM real — validan que la orquestación (Architect → SwarmPricing →
Assembly → Persistence → Telemetría) mantiene el contrato esperado por el
endpoint FastAPI y el cliente Next.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

import pytest

from src.budget.application.ports.ports import IBudgetRepository, IGenerationEmitter
from src.budget.application.services.architect_service import (
    ArchitectResponse,
    ArchitectStatus,
    DecomposedTask,
)
from src.budget.application.use_cases.generate_budget_from_nl_uc import (
    AskingForClarificationError,
    GenerateBudgetFromNlUseCase,
)
from src.budget.domain.entities import (
    AIResolution,
    Budget,
    BudgetPartida,
    OriginalItem,
)


class _FakeArchitect:
    def __init__(self, response: ArchitectResponse):
        self._response = response

    async def decompose_request(self, user_request: str):
        return self._response, {"promptTokenCount": 10, "candidatesTokenCount": 5, "totalTokenCount": 15}


class _FakeSwarm:
    async def evaluate_batch(self, items, budget_id: str, metrics: Dict[str, Any]) -> List[BudgetPartida]:
        partidas: List[BudgetPartida] = []
        for i, it in enumerate(items, start=1):
            partidas.append(
                BudgetPartida(
                    id=f"p-{i}",
                    order=i,
                    type="PARTIDA",
                    code=f"MOCK-{it.code}",
                    description=it.description,
                    unit=it.unit,
                    quantity=it.quantity,
                    unitPrice=100.0,
                    totalPrice=100.0 * it.quantity,
                    breakdown=[],
                    note="mock",
                    original_item=OriginalItem(
                        code=it.code,
                        description=it.description,
                        quantity=it.quantity,
                        unit=it.unit,
                        chapter=it.chapter,
                    ),
                    ai_resolution=AIResolution(
                        selected_candidate={"code": f"MOCK-{it.code}"},
                        reasoning_trace="mock",
                        calculated_unit_price=100.0,
                        calculated_total_price=100.0 * it.quantity,
                        confidence_score=90,
                        is_estimated=False,
                        needs_human_review=False,
                    ),
                )
            )
        metrics["prompt"] += 20
        metrics["completion"] += 40
        metrics["total"] += 60
        return partidas


class _SpyRepo(IBudgetRepository):
    def __init__(self):
        self.saved: Optional[Budget] = None

    def save(self, budget: Budget) -> None:
        self.saved = budget

    def find_by_id(self, budget_id: str) -> Optional[Budget]:
        return self.saved


class _SpyEmitter(IGenerationEmitter):
    def __init__(self):
        self.events: List[Dict[str, Any]] = []

    def emit_event(self, budget_id: str, event_type: str, data: Dict[str, Any]) -> None:
        self.events.append({"budget_id": budget_id, "type": event_type, "data": data})


def _task(i: int, chapter: str) -> DecomposedTask:
    return DecomposedTask(
        taskId=i,
        dependsOn=[],
        chapter=chapter,
        subchapter=None,
        reasoning="mock",
        task=f"Tarea mock {i}",
        userSpecificMaterial=None,
        isExplicitlyRequested=True,
        estimatedParametricUnit="m2",
        estimatedParametricQuantity=10.0,
    )


def test_execute_happy_path_builds_budget_with_chapters_and_totals():
    arch_resp = ArchitectResponse(
        status=ArchitectStatus.COMPLETE,
        question=None,
        tasks=[_task(1, "DEMOLICIONES"), _task(2, "DEMOLICIONES"), _task(3, "FONTANERIA Y GAS")],
    )
    uc = GenerateBudgetFromNlUseCase(
        architect=_FakeArchitect(arch_resp),
        swarm_pricing=_FakeSwarm(),
        repository=_SpyRepo(),
        emitter=_SpyEmitter(),
    )

    budget = asyncio.run(uc.execute(narrative="Reforma mock", lead_id="lead-1", budget_id="bid-1"))

    assert budget.id == "bid-1"
    assert budget.leadId == "lead-1"
    assert budget.costBreakdown.materialExecutionPrice == pytest.approx(3000.0)
    assert budget.totalEstimated == pytest.approx(4319.7, abs=0.01)
    chapter_names = {c.name for c in budget.chapters}
    assert "DEMOLICIONES" in chapter_names
    assert "FONTANERIA Y GAS" in chapter_names


def test_execute_emits_subtasks_and_completed_events():
    spy_emitter = _SpyEmitter()
    arch_resp = ArchitectResponse(
        status=ArchitectStatus.COMPLETE,
        question=None,
        tasks=[_task(1, "DEMOLICIONES")],
    )
    uc = GenerateBudgetFromNlUseCase(
        architect=_FakeArchitect(arch_resp),
        swarm_pricing=_FakeSwarm(),
        repository=_SpyRepo(),
        emitter=spy_emitter,
    )
    asyncio.run(uc.execute(narrative="Mock", lead_id="lead-2", budget_id="bid-2"))
    types = [e["type"] for e in spy_emitter.events]
    assert "extraction_started" in types
    assert "subtasks_extracted" in types
    assert "budget_completed" in types
    assert all(e["budget_id"] == "bid-2" for e in spy_emitter.events)


def test_execute_raises_when_architect_asks():
    arch_resp = ArchitectResponse(
        status=ArchitectStatus.ASKING,
        question="¿Cuántos m²?",
        tasks=[],
    )
    uc = GenerateBudgetFromNlUseCase(
        architect=_FakeArchitect(arch_resp),
        swarm_pricing=_FakeSwarm(),
        repository=_SpyRepo(),
        emitter=_SpyEmitter(),
    )
    with pytest.raises(AskingForClarificationError) as exc:
        asyncio.run(uc.execute(narrative="Reforma ambigua", lead_id="lead-3"))
    assert "m²" in str(exc.value.question)


def test_user_specific_material_is_propagated_to_description():
    """Cuando el Architect devuelve `userSpecificMaterial`, el puente lo inyecta
    en la descripción del RestructuredItem para que el Swarm lo vea al generar queries."""
    captured: List[Any] = []

    class _CapturingSwarm:
        async def evaluate_batch(self, items, budget_id, metrics):
            captured.extend(items)
            return []

    task_with_material = DecomposedTask(
        taskId=1,
        dependsOn=[],
        chapter="FONTANERIA Y GAS",
        subchapter=None,
        reasoning="x",
        task="Nueva red de tuberías",
        userSpecificMaterial="cobre",
        isExplicitlyRequested=True,
        estimatedParametricUnit="m",
        estimatedParametricQuantity=15.0,
    )
    arch_resp = ArchitectResponse(status=ArchitectStatus.COMPLETE, question=None, tasks=[task_with_material])
    uc = GenerateBudgetFromNlUseCase(
        architect=_FakeArchitect(arch_resp),
        swarm_pricing=_CapturingSwarm(),
        repository=_SpyRepo(),
        emitter=_SpyEmitter(),
    )
    asyncio.run(uc.execute(narrative="x", lead_id="l", budget_id="b"))
    assert len(captured) == 1
    assert "MATERIAL EXPLÍCITO: cobre" in captured[0].description


def test_repository_save_called_once():
    repo = _SpyRepo()
    arch_resp = ArchitectResponse(
        status=ArchitectStatus.COMPLETE,
        question=None,
        tasks=[_task(1, "DEMOLICIONES")],
    )
    uc = GenerateBudgetFromNlUseCase(
        architect=_FakeArchitect(arch_resp),
        swarm_pricing=_FakeSwarm(),
        repository=repo,
        emitter=_SpyEmitter(),
    )
    asyncio.run(uc.execute(narrative="Mock", lead_id="l", budget_id="b-save"))
    assert repo.saved is not None
    assert repo.saved.id == "b-save"

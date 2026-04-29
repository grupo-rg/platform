"""
Use case NL → Budget.

Toma un brief en lenguaje natural, lo pasa por el `ArchitectService` para
descomponerlo en tareas atómicas, luego las precia vía `SwarmPricingService`
reutilizando toda la infraestructura que ya usa PDF-to-Budget (RAG vectorial +
evaluator). Persiste el Budget final y emite la misma telemetría que los PDFs
para que el UI no tenga que distinguir entre pipelines.
"""

from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime
from typing import Dict, List, Optional

from src.budget.application.ports.ports import IBudgetRepository, IGenerationEmitter
from src.budget.application.services.architect_service import (
    ArchitectService,
    ArchitectStatus,
    DecomposedTask,
)
from src.budget.application.services.pdf_extractor_service import RestructuredItem
from src.budget.application.services.swarm_pricing_service import SwarmPricingService
from src.budget.catalog.domain.unit import Unit
from src.budget.domain.entities import (
    Budget,
    BudgetChapter,
    BudgetCostBreakdown,
    BudgetTelemetry,
    BudgetTelemetryMetrics,
    PersonalInfo,
    ProjectSpecs,
)

logger = logging.getLogger(__name__)


class AskingForClarificationError(Exception):
    """El Architect necesita más información antes de poder descomponer."""

    def __init__(self, question: str):
        super().__init__(question)
        self.question = question


def _task_to_restructured(task: DecomposedTask) -> RestructuredItem:
    """Puente entre el dominio del Architect (tareas paramétricas) y el del
    Swarm (ítems con código, descripción, unidad y cantidad)."""
    description = task.task
    if task.userSpecificMaterial:
        # Inyectamos el material explícito en la descripción para que el
        # Deconstructor del Swarm lo vea al generar queries y lo prefiera
        # al seleccionar candidato final.
        description = f"{description} [MATERIAL EXPLÍCITO: {task.userSpecificMaterial}]"
    raw_unit = task.estimatedParametricUnit or "ud"
    # Fase 5.C — paridad con el extractor INLINE (5.B): la normalización determinista
    # server-side es condición necesaria para que el Swarm aplique el filtro dimensional
    # sobre los candidatos del price_book.
    return RestructuredItem(
        code=f"NL-{task.taskId}",
        description=description,
        quantity=float(task.estimatedParametricQuantity or 1.0),
        unit=raw_unit,
        chapter=task.chapter or "Sin Capítulo",
        unit_normalized=Unit.normalize(raw_unit),
        unit_dimension=Unit.dimension_of(raw_unit),
    )


class GenerateBudgetFromNlUseCase:
    def __init__(
        self,
        architect: ArchitectService,
        swarm_pricing: SwarmPricingService,
        repository: Optional[IBudgetRepository] = None,
        emitter: Optional[IGenerationEmitter] = None,
    ):
        self.architect = architect
        self.pricing_service = swarm_pricing
        self.repository = repository
        self.emitter = emitter

    def _emit(self, budget_id: str, event_type: str, data: Dict):
        if self.emitter:
            self.emitter.emit_event(budget_id, event_type, data)

    async def execute(
        self,
        narrative: str,
        lead_id: str = "anonymous",
        budget_id: Optional[str] = None,
    ) -> Budget:
        start_time = time.time()
        metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}

        budget_id = budget_id or str(uuid.uuid4())

        # Fase 1: Descomposición
        self._emit(budget_id, "extraction_started", {"query": "Architect descomponiendo brief en tareas COAATMCA…"})
        arch_resp, arch_usage = await self.architect.decompose_request(narrative)
        if arch_usage:
            metrics["prompt"] += arch_usage.get("promptTokenCount", 0)
            metrics["completion"] += arch_usage.get("candidatesTokenCount", 0)
            metrics["total"] += arch_usage.get("totalTokenCount", 0)

        if arch_resp.status == ArchitectStatus.ASKING:
            # El brief es demasiado ambiguo: emitimos un evento y lanzamos
            # excepción para que la capa HTTP devuelva 200 con la pregunta.
            self._emit(budget_id, "extraction_failed_chunk", {"error": arch_resp.question or "asking"})
            raise AskingForClarificationError(arch_resp.question or "Necesito más información del proyecto")

        tasks = arch_resp.tasks
        self._emit(budget_id, "subtasks_extracted", {"totalTasks": len(tasks)})
        logger.info("[NL→Budget] Architect devolvió %d tareas", len(tasks))

        # Fase 2: Pricing — reusa SwarmPricingService sin cambios.
        restructured = [_task_to_restructured(t) for t in tasks]
        partidas = await self.pricing_service.evaluate_batch(restructured, budget_id, metrics)

        # Fase 3: Assembly
        chapters_dict: Dict[str, Dict] = {}
        for p in partidas:
            ch_name = (p.original_item.chapter if p.original_item and p.original_item.chapter else "VARIOS").strip()
            bucket = chapters_dict.setdefault(ch_name, {"items": [], "total": 0.0})
            bucket["items"].append(p)
            bucket["total"] += p.totalPrice

        final_chapters: List[BudgetChapter] = []
        subtotal = 0.0
        for idx, (ch_name, data) in enumerate(chapters_dict.items(), start=1):
            final_chapters.append(
                BudgetChapter(
                    id=str(uuid.uuid4()),
                    name=ch_name,
                    order=idx,
                    items=data["items"],
                    totalPrice=data["total"],
                )
            )
            subtotal += data["total"]

        # Márgenes estandarizados (alineados con restructure_budget_uc y Node)
        gg = subtotal * 0.13
        bi = subtotal * 0.06
        pem = subtotal + gg + bi
        iva = pem * 0.21
        total = pem + iva

        duration_ms = (time.time() - start_time) * 1000
        telemetry = BudgetTelemetry(
            metrics=BudgetTelemetryMetrics(
                generationTimeMs=duration_ms,
                tokens={
                    "inputTokens": metrics["prompt"],
                    "outputTokens": metrics["completion"],
                    "totalTokens": metrics["total"],
                },
                costs={
                    "fiatAmount": metrics["cost"],
                    "fiatCurrency": "EUR",
                },
            )
        )

        budget = Budget(
            id=budget_id,
            leadId=lead_id,
            clientSnapshot=PersonalInfo(),
            status="draft",
            createdAt=datetime.utcnow(),
            updatedAt=datetime.utcnow(),
            version=1,
            specs=ProjectSpecs(),
            chapters=final_chapters,
            costBreakdown=BudgetCostBreakdown(
                materialExecutionPrice=subtotal,
                overheadExpenses=gg,
                industrialBenefit=bi,
                tax=iva,
                globalAdjustment=0.0,
                total=total,
            ),
            totalEstimated=total,
            telemetry=telemetry,
            # Phase 15 — raw PEM en partidas; markup distribuido por el editor.
            calibrationVersion="phase15",
        )

        if self.repository:
            self.repository.save(budget)

        self._emit(budget_id, "budget_completed", {
            "budgetId": budget_id,
            "total": total,
            "itemCount": sum(len(c.items) for c in final_chapters),
        })

        return budget

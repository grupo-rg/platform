import logging
from typing import List, Dict, Any, Optional
import uuid
import time
from datetime import datetime

from src.budget.application.ports.ports import IBudgetRepository, IGenerationEmitter
from src.budget.domain.entities import (
    Budget, BudgetChapter, BudgetPartida, PersonalInfo, ProjectSpecs, BudgetCostBreakdown, 
    BudgetTelemetry, BudgetTelemetryMetrics
)
from src.budget.application.services.pdf_extractor_service import InlinePdfExtractorService, AnnexedPdfExtractorService
from src.budget.application.services.swarm_pricing_service import SwarmPricingService

logger = logging.getLogger(__name__)

class RestructureBudgetUseCase:
    """
    Core AI Orchestrator that uses injected strategy services to extract and price budgets.
    """
    
    def __init__(self, 
                 inline_extractor: InlinePdfExtractorService,
                 annexed_extractor: AnnexedPdfExtractorService,
                 swarm_pricing: SwarmPricingService,
                 repository: Optional[IBudgetRepository] = None,
                 emitter: Optional[IGenerationEmitter] = None):
        self.inline_extractor = inline_extractor
        self.annexed_extractor = annexed_extractor
        self.pricing_service = swarm_pricing
        self.repository = repository
        self.emitter = emitter
        
    def _emit(self, budget_id: str, event_type: str, data: Dict[str, Any]):
        if self.emitter:
            self.emitter.emit_event(budget_id, event_type, data)

    async def execute(self, raw_items: List[Dict[str, Any]], lead_id: str = "anonymous", budget_id: str = None, strategy: str = "INLINE", pdf_bytes: Optional[bytes] = None) -> Budget:
        start_time = time.time()
        metrics = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}

        # 1. POLIMORFISMO: Seleccionar Extractor en base a metadata
        logger.info(f"Ochestrator Booting with PDF Strategy: {strategy}")
        extractor = self.annexed_extractor if strategy.upper() == "ANNEXED" else self.inline_extractor

        # Phase 1: Semantically structure messy spatial PDF chunks.
        # Fase 9.2 — INLINE acepta `pdf_bytes` para habilitar el fast path
        # heurístico. ANNEXED ignora el kwarg (su signature no lo declara
        # todavía). Try/except mantiene compat sin introspección de tipos.
        try:
            restructured_items = await extractor.extract(
                raw_items, budget_id, metrics, pdf_bytes=pdf_bytes,
            )
        except TypeError:
            restructured_items = await extractor.extract(raw_items, budget_id, metrics)
        
        # Phase 2: Swarm Pricing (Deconstructor + Vector Search + LLM Evaluator)
        partidas = await self.pricing_service.evaluate_batch(restructured_items, budget_id, metrics)
        
        # Phase 3: Assembly & Validation
        chapters_dict = {}
        for p in partidas:
            ch_name = (p.original_item.chapter if p.original_item and p.original_item.chapter else "VARIOS").strip()
            if ch_name not in chapters_dict:
                chapters_dict[ch_name] = {"items": [], "total": 0.0}
            chapters_dict[ch_name]["items"].append(p)
            chapters_dict[ch_name]["total"] += p.totalPrice
            
        final_chapters = []
        subtotal = 0.0
        order_idx = 1
        for ch_name, data in chapters_dict.items():
            final_chapters.append(BudgetChapter(
                id=str(uuid.uuid4()),
                name=ch_name,
                order=order_idx,
                items=data["items"],
                totalPrice=data["total"]
            ))
            subtotal += data["total"]
            order_idx += 1
            
        # Hardcoded margins for this microservice logic (to match TS logic currently ported here)
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
                    "totalTokens": metrics["total"]
                },
                costs={
                    "fiatAmount": metrics["cost"],
                    "fiatCurrency": "EUR"
                }
            )
        )
        
        budget = Budget(
            id=budget_id if budget_id else str(uuid.uuid4()),
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
                total=total
            ),
            totalEstimated=total,
            telemetry=telemetry,
            # Phase 15 — partidas almacenan raw PEM; el editor frontend distribuye
            # GG+BI según config. Stamp explícito para diferenciar del comportamiento
            # legacy donde partidas ya tenían markup baked-in por calibración.
            calibrationVersion="phase15",
        )
        
        if self.repository:
            self.repository.save(budget)
            
        self._emit(budget.id, 'budget_completed', {"budgetId": budget.id, "metrics": telemetry.metrics.model_dump()})
            
        return budget

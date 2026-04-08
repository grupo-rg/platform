from fastapi import Depends
from src.budget.infrastructure.adapters.ai.gemini_adapter import GoogleGenerativeAIAdapter
from src.budget.infrastructure.adapters.databases.firestore_price_book import FirestorePriceBookAdapter
from src.budget.infrastructure.adapters.databases.firestore_budget import FirestoreBudgetRepository
from src.budget.infrastructure.events.firestore_emitter import FirestoreProgressEmitter
from src.budget.application.use_cases.restructure_budget_uc import RestructureBudgetUseCase
from src.budget.application.services.pdf_extractor_service import InlinePdfExtractorService, AnnexedPdfExtractorService
from src.budget.application.services.swarm_pricing_service import SwarmPricingService

from firebase_admin import firestore
from src.pipeline_telemetry.infrastructure.firebase_telemetry_repository import FirebaseTelemetryRepository
from src.pipeline_telemetry.application.use_cases.emit_telemetry_uc import EmitTelemetryUseCase

# Singletons for connections
_llm_adapter = GoogleGenerativeAIAdapter()
_vector_search_adapter = FirestorePriceBookAdapter()
_firestore_repository = FirestoreBudgetRepository()

# Setup Telemetry dependencies
_db_client = firestore.client()
_telemetry_repo = FirebaseTelemetryRepository(db=_db_client)
_emit_telemetry_uc = EmitTelemetryUseCase(repository=_telemetry_repo, ttl_hours=12)

_progress_emitter = FirestoreProgressEmitter(emit_uc=_emit_telemetry_uc)

# Service Instances
_inline_extractor = InlinePdfExtractorService(llm_provider=_llm_adapter, emitter=_progress_emitter)
_annexed_extractor = AnnexedPdfExtractorService(llm_provider=_llm_adapter, emitter=_progress_emitter)
_swarm_pricing = SwarmPricingService(llm_provider=_llm_adapter, vector_search=_vector_search_adapter, emitter=_progress_emitter)

def get_restructure_budget_uc() -> RestructureBudgetUseCase:
    """Dependency Injection for the core AI Budget Use Case."""
    return RestructureBudgetUseCase(
        inline_extractor=_inline_extractor,
        annexed_extractor=_annexed_extractor,
        swarm_pricing=_swarm_pricing,
        repository=_firestore_repository,
        emitter=_progress_emitter
    )

from fastapi import Depends
from src.budget.infrastructure.adapters.ai.gemini_adapter import GoogleGenerativeAIAdapter
from src.budget.infrastructure.adapters.databases.firestore_price_book import FirestorePriceBookAdapter
from src.budget.infrastructure.adapters.databases.firestore_budget import FirestoreBudgetRepository
from src.budget.infrastructure.events.firestore_emitter import FirestoreProgressEmitter
from src.budget.application.use_cases.restructure_budget_uc import RestructureBudgetUseCase
from src.budget.application.services.pdf_extractor_service import InlinePdfExtractorService, AnnexedPdfExtractorService
from src.budget.application.services.swarm_pricing_service import SwarmPricingService

# Singletons for connections
_llm_adapter = GoogleGenerativeAIAdapter()
_vector_search_adapter = FirestorePriceBookAdapter()
_firestore_repository = FirestoreBudgetRepository()
_progress_emitter = FirestoreProgressEmitter()

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

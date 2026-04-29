"""DI singletons para la app FastAPI (v005 + v006).

Cablea el Swarm con el set completo de deps de producción:
  - `catalog_lookup` : tarifas oficiales COAATMCA (5.A).
  - `rules`          : markdown COAATMCA_2025 inyectado en el system prompt.
  - `dag`            : contexto DAG por capítulo (5.A).
  - `fragment_repo`  : HeuristicFragment loop de aprendizaje ICL (6.A → 6.C).

Antes de 6.E los endpoints HTTP cargaban un Swarm sin v005/v006. Esto
corregía scripts offline pero no los budgets reales que llegan por la API.
Este módulo cierra esa deuda técnica.
"""

from __future__ import annotations

import sys
from pathlib import Path

from fastapi import Depends
from firebase_admin import firestore

from src.budget.application.services.architect_service import ArchitectService
from src.budget.application.services.pdf_extractor_service import (
    AnnexedPdfExtractorService,
    InlinePdfExtractorService,
)
from src.budget.application.services.swarm_pricing_service import SwarmPricingService
from src.budget.application.use_cases.generate_budget_from_nl_uc import (
    GenerateBudgetFromNlUseCase,
)
from src.budget.application.use_cases.restructure_budget_uc import RestructureBudgetUseCase
from src.budget.catalog.application.services.catalog_lookup_service import (
    CatalogLookupService,
)
from src.budget.catalog.domain.construction_dag import load_construction_dag
from src.budget.catalog.infrastructure.adapters.firestore_catalog_repository import (
    FirestoreCatalogRepository,
)
from src.budget.infrastructure.adapters.ai.gemini_adapter import GoogleGenerativeAIAdapter
from src.budget.infrastructure.adapters.databases.firestore_budget import (
    FirestoreBudgetRepository,
)
from src.budget.infrastructure.adapters.databases.firestore_price_book import (
    FirestorePriceBookAdapter,
)
from src.budget.infrastructure.events.firestore_emitter import FirestoreProgressEmitter
from src.budget.learning.infrastructure.adapters.firestore_heuristic_fragment_repository import (
    FirestoreHeuristicFragmentRepository,
)
from src.pipeline_telemetry.application.use_cases.emit_telemetry_uc import EmitTelemetryUseCase
from src.pipeline_telemetry.infrastructure.firebase_telemetry_repository import (
    FirebaseTelemetryRepository,
)

# Cargar las normas del markdown (5.A.2). Soporta doble import path (paquete
# `prompts.rules` vs. directorio suelto) igual que `eval_pipeline_runner.py`.
try:
    from prompts.rules import load_rules  # type: ignore[no-redef]
except ImportError:
    _AI_CORE_ROOT = Path(__file__).resolve().parents[3]
    if str(_AI_CORE_ROOT) not in sys.path:
        sys.path.insert(0, str(_AI_CORE_ROOT))
    from prompts.rules import load_rules  # type: ignore[no-redef]


# -------- Singletons --------------------------------------------------------

_db_client = firestore.client()

_llm_adapter = GoogleGenerativeAIAdapter()
_vector_search_adapter = FirestorePriceBookAdapter(db=_db_client)
_firestore_repository = FirestoreBudgetRepository()

# Catalog (v005)
_catalog_repo = FirestoreCatalogRepository(db=_db_client)
_catalog_lookup = CatalogLookupService(repo=_catalog_repo)

# Normas + DAG (v005)
_rules_md = load_rules()
_construction_dag = load_construction_dag()

# Fragments (v006 — Fase 6.A/6.C)
_fragment_repo = FirestoreHeuristicFragmentRepository(db=_db_client)

# Telemetry
_telemetry_repo = FirebaseTelemetryRepository(db=_db_client)
_emit_telemetry_uc = EmitTelemetryUseCase(repository=_telemetry_repo, ttl_hours=12)
_progress_emitter = FirestoreProgressEmitter(emit_uc=_emit_telemetry_uc)

# Application services
_inline_extractor = InlinePdfExtractorService(
    llm_provider=_llm_adapter, emitter=_progress_emitter
)
_annexed_extractor = AnnexedPdfExtractorService(
    llm_provider=_llm_adapter, emitter=_progress_emitter
)
_swarm_pricing = SwarmPricingService(
    llm_provider=_llm_adapter,
    vector_search=_vector_search_adapter,
    emitter=_progress_emitter,
    catalog_lookup=_catalog_lookup,
    rules=_rules_md,
    dag=_construction_dag,
    fragment_repo=_fragment_repo,
)
_architect = ArchitectService(llm_provider=_llm_adapter)


# -------- Dependency providers ---------------------------------------------


def get_restructure_budget_uc() -> RestructureBudgetUseCase:
    """DI del flujo PDF → Budget (INLINE + ANNEXED + Swarm v006)."""
    return RestructureBudgetUseCase(
        inline_extractor=_inline_extractor,
        annexed_extractor=_annexed_extractor,
        swarm_pricing=_swarm_pricing,
        repository=_firestore_repository,
        emitter=_progress_emitter,
    )


def get_generate_budget_from_nl_uc() -> GenerateBudgetFromNlUseCase:
    """DI del flujo NL → Budget (sustituye al Node)."""
    return GenerateBudgetFromNlUseCase(
        architect=_architect,
        swarm_pricing=_swarm_pricing,
        repository=_firestore_repository,
        emitter=_progress_emitter,
    )

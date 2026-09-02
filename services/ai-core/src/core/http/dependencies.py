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
from src.budget.application.services.budget_metadata_extractor import (
    BudgetMetadataExtractor,
)
from src.budget.application.services.pricing_cache import PricingCache
from src.budget.application.services.swarm_pricing_service import SwarmPricingService
from src.budget.catalog.application.services.hybrid_catalog_search import (
    HybridCatalogSearch,
)
from src.budget.infrastructure.adapters.reranking.bge_reranker import BgeReranker
from src.budget.application.use_cases.generate_budget_from_nl_uc import (
    GenerateBudgetFromNlUseCase,
)
from src.budget.application.use_cases.restructure_budget_uc import RestructureBudgetUseCase
from src.budget.catalog.application.services.catalog_lookup_service import (
    CatalogLookupService,
)
from src.budget.catalog.infrastructure.adapters.firestore_material_catalog import (
    FirestoreMaterialCatalogAdapter,
)
from src.budget.application.services.from_scratch_compositor import (
    FromScratchCompositor,
)
from src.budget.catalog.domain.construction_dag import load_construction_dag
from src.budget.catalog.infrastructure.adapters.firestore_catalog_repository import (
    FirestoreCatalogRepository,
)
from src.budget.catalog.infrastructure.adapters.firestore_price_book_repository import (
    FirestorePriceBookRepository,
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
from src.pipeline_jobs.application.ports.job_executor import IJobExecutor
from src.pipeline_jobs.application.ports.job_repository import IPipelineJobRepository
from src.pipeline_jobs.application.ports.pdf_storage import IPdfStorage
from src.pipeline_jobs.application.ports.pipeline_runner import IPipelineRunner
from src.pipeline_jobs.application.use_cases.run_pipeline_job_uc import (
    RunPipelineJobUseCase,
)
from src.pipeline_jobs.infrastructure.budget_pipeline_runner import (
    BudgetPipelineRunner,
)
from src.pipeline_jobs.infrastructure.cloud_run_jobs_executor import (
    CloudRunJobsExecutor,
)
from src.pipeline_jobs.infrastructure.firestore_pipeline_job_repository import (
    FirestorePipelineJobRepository,
)
from src.pipeline_jobs.infrastructure.gcs_pdf_storage import GcsPdfStorage

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

# Fase 2 — compositor de partidas from_scratch: valora labor (labor_rates) +
# material (material_catalog OBRAMAT) con precios reales, sin inventar.
_material_search = FirestoreMaterialCatalogAdapter(db=_db_client)
_from_scratch_compositor = FromScratchCompositor(
    llm=_llm_adapter,
    embed_fn=_llm_adapter.get_embedding,
    catalog_lookup=_catalog_lookup,
    material_search=_material_search,
)
# Phase 17.8 — repo de price_book (kind='item' + kind='breakdown') usado para
# heredar el descompuesto del catálogo en partidas 1:1.
_price_book_repo = FirestorePriceBookRepository(db=_db_client)

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
# S1-A-02 — el HybridCatalogSearch se construye en boot del worker
# (vía `bootstrap_hybrid_catalog_search`) porque `list_all_items()` es async.
# Sin el bootstrap, `_hybrid_search_singleton` queda None y el SwarmPricingService
# usa el path legacy (solo vector). Esto preserva backward-compat con scripts
# offline y tests que no llaman al bootstrap.
_hybrid_search_singleton: Optional[HybridCatalogSearch] = None


def get_hybrid_catalog_search() -> Optional[HybridCatalogSearch]:
    """Devuelve el singleton HybridCatalogSearch si ha sido inicializado."""
    return _hybrid_search_singleton


async def bootstrap_hybrid_catalog_search() -> Optional[HybridCatalogSearch]:
    """S1-A-02 — Carga los items del price_book una vez y construye el
    índice BM25. Llamar al boot del worker (worker_main).

    Si el repo no responde (Firestore caído, colección vacía, etc.), loggea
    un warning y devuelve None — el swarm cae al path legacy automáticamente.
    """
    global _hybrid_search_singleton
    if _hybrid_search_singleton is not None:
        return _hybrid_search_singleton
    try:
        import logging as _logging
        _bootstrap_logger = _logging.getLogger(__name__)
        _bootstrap_logger.info("[bootstrap] loading price_book items for HybridCatalogSearch...")
        items = await _price_book_repo.list_all_items()
        if not items:
            _bootstrap_logger.warning(
                "[bootstrap] price_book has 0 items; HybridCatalogSearch DISABLED"
            )
            return None
        _hybrid_search_singleton = HybridCatalogSearch(
            catalog_items=items,
            vector_search=_vector_search_adapter,
            rrf_k=60,
        )
        _bootstrap_logger.info(
            f"[bootstrap] HybridCatalogSearch ready with {len(items)} items"
        )
        # Re-bind the swarm to pick up the new hybrid search.
        # Mutamos el atributo del singleton existente — no recreamos.
        _swarm_pricing.hybrid_search = _hybrid_search_singleton
        return _hybrid_search_singleton
    except Exception as e:
        import logging as _logging
        _logging.getLogger(__name__).warning(
            f"[bootstrap] HybridCatalogSearch init failed: {e}; falling back to vector-only"
        )
        return None


# S1-A-03 + S2-A-00.1 — BgeReranker singleton.
#
# Antes de S2-A-00.1 la instanciación corría a nivel módulo y el `import`
# del Service ai-core (que es puro dispatcher HTTP) cargaba ~280MB del
# modelo + torch + sentence-transformers en el boot del Service → OOM con
# memory=2Gi durante el primer upload de un PDF (smoke 2026-05-19).
#
# Fix: lazy. La instanciación se hace al primer `get_bge_reranker()`. El
# Service nunca llama esta función (puro dispatcher), así que jamás carga
# el modelo. El Job worker SÍ la llama (vía bootstrap_hybrid_catalog_search
# o vía el swarm) y paga el coste UNA SOLA VEZ al primer rerank.
#
# S2-A-00 pre-warm sigue ejecutándose en la misma llamada lazy.
_bge_reranker_singleton: Optional[BgeReranker] = None
_bge_reranker_initialized: bool = False


def get_bge_reranker() -> Optional[BgeReranker]:
    global _bge_reranker_singleton, _bge_reranker_initialized
    if _bge_reranker_initialized:
        return _bge_reranker_singleton

    _bge_reranker_initialized = True
    import logging as _logging
    _log = _logging.getLogger(__name__)
    try:
        _bge_reranker_singleton = BgeReranker.get()
        _log.info(
            "[bootstrap] BgeReranker ready (cross-encoder BAAI/bge-reranker-v2-m3)"
        )
        try:
            _bge_reranker_singleton.pre_warm()
            _log.info("[bootstrap] BgeReranker pre-warmed (torch graph cached)")
        except Exception as _bge_warm_err:  # pragma: no cover
            _log.warning(
                f"[bootstrap] BgeReranker pre_warm failed ({_bge_warm_err}); "
                f"first rerank will pay cold-start"
            )
    except Exception as _bge_err:  # pragma: no cover (depends on host env)
        _log.warning(
            f"[bootstrap] BgeReranker init failed ({_bge_err}); "
            f"swarm will use Flash rerank fallback"
        )
        _bge_reranker_singleton = None

    return _bge_reranker_singleton


# S1-A-04 — PricingCache singleton sobre Firestore.
_pricing_cache_singleton: PricingCache = PricingCache(db=_db_client)


def get_pricing_cache() -> PricingCache:
    return _pricing_cache_singleton


_swarm_pricing = SwarmPricingService(
    llm_provider=_llm_adapter,
    vector_search=_vector_search_adapter,
    emitter=_progress_emitter,
    catalog_lookup=_catalog_lookup,
    rules=_rules_md,
    dag=_construction_dag,
    fragment_repo=_fragment_repo,
    price_book_repo=_price_book_repo,
    hybrid_search=None,  # poblado al boot por bootstrap_hybrid_catalog_search()
    reranker=_bge_reranker_singleton,
    pricing_cache=_pricing_cache_singleton,
    compositor=_from_scratch_compositor,
)
_architect = ArchitectService(llm_provider=_llm_adapter)
_budget_metadata_extractor = BudgetMetadataExtractor(llm_provider=_llm_adapter)


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


# ---------------------------------------------------------------------------
# Pipeline Jobs DI (P1.c + dispatcher integration).
#
# These singletons are lazy: heavy SDK clients (Cloud Run Jobs, Cloud Storage)
# are built on first access via factory methods, so importing this module
# during local tests / CLI scripts doesn't require those packages to be
# fully configured.
# ---------------------------------------------------------------------------


import os  # noqa: E402 — local to keep std-lib imports separated from project imports

_pipeline_job_repository: Optional[IPipelineJobRepository] = None
_job_executor: Optional[IJobExecutor] = None
_pdf_storage: Optional[IPdfStorage] = None
_budget_pipeline_runner: Optional[IPipelineRunner] = None


def get_pipeline_job_repository() -> IPipelineJobRepository:
    global _pipeline_job_repository
    if _pipeline_job_repository is None:
        _pipeline_job_repository = FirestorePipelineJobRepository(db=_db_client)
    return _pipeline_job_repository


def get_job_executor() -> IJobExecutor:
    global _job_executor
    if _job_executor is None:
        _job_executor = CloudRunJobsExecutor.from_env()
    return _job_executor


def get_pdf_storage() -> IPdfStorage:
    global _pdf_storage
    if _pdf_storage is None:
        _pdf_storage = GcsPdfStorage.from_env()
    return _pdf_storage


def get_budget_metadata_extractor() -> BudgetMetadataExtractor:
    """Singleton extractor for the sync `/extract-metadata` endpoint."""
    return _budget_metadata_extractor


def get_budget_pipeline_runner() -> IPipelineRunner:
    """Wires the new IPipelineRunner contract to the existing budget use
    cases. P4.b will extend this with checkpoint hooks."""
    global _budget_pipeline_runner
    if _budget_pipeline_runner is None:
        _budget_pipeline_runner = BudgetPipelineRunner(
            restructure_uc=get_restructure_budget_uc(),
            nl_uc=get_generate_budget_from_nl_uc(),
        )
    return _budget_pipeline_runner


def get_worker_job_name() -> str:
    """Full Cloud Run Jobs resource path. Must be set via env var in prod:
        WORKER_JOB_NAME=projects/<id>/locations/<region>/jobs/ai-core-worker
    """
    name = os.environ.get("WORKER_JOB_NAME", "").strip()
    if not name:
        raise RuntimeError(
            "WORKER_JOB_NAME env var is required for the dispatcher endpoint"
        )
    return name


def get_run_pipeline_job_uc() -> RunPipelineJobUseCase:
    """Builds the worker's use case. Called by `worker_main._build_use_case_from_env`.
    Built on every call so each worker invocation has its own instance —
    cheap (no SDK calls), and avoids stale references after a hot-reload."""
    return RunPipelineJobUseCase(
        repository=get_pipeline_job_repository(),
        pdf_storage=get_pdf_storage(),
        runner=get_budget_pipeline_runner(),
        heartbeat_interval_seconds=float(
            os.environ.get("PIPELINE_HEARTBEAT_SECONDS", "30")
        ),
        cancellation_poll_interval_seconds=float(
            os.environ.get("PIPELINE_CANCEL_POLL_SECONDS", "5")
        ),
    )

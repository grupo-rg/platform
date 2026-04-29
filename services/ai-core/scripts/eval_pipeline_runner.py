"""Fase 5.H — Pipeline runner del eval (v005 completo, local).

Instancia el mismo pipeline que `src/core/http/dependencies.py`, pero
**con los 3 deps v005 que producción aún NO está cableando**:
  - `catalog_lookup: CatalogLookupService`
  - `rules: str` (load_rules())
  - `dag: ConstructionDag` (load_construction_dag())

Expone una función `run_pipeline()` que recibe input + flow + brief y
devuelve las partidas en formato plano serializable para comparar contra
el golden.

**Deuda técnica detectada**: `src/core/http/dependencies.py` debería
instanciar el Swarm con estos 3 deps. Hoy solo lo hacemos en esta eval.
Seguimiento: crear ticket "PROD: cablear v005 deps a dependencies.py".
"""
from __future__ import annotations

import asyncio
import base64
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

# Cargar .env ANTES de importar adapters (que leen env vars al construirse).
from dotenv import load_dotenv
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

# Firebase Admin init — mismo bloque que src/core/http/main.py. Hay que hacerlo
# ANTES de `firestore.client()` porque cada adapter (FirestorePriceBook,
# FirestoreCatalog, FirestoreBudget) llama a ese client al construirse.
import os as _os
import firebase_admin as _firebase_admin
from firebase_admin import credentials as _firebase_credentials

if not _firebase_admin._apps:
    _project_id = _os.environ.get("FIREBASE_PROJECT_ID")
    _client_email = _os.environ.get("FIREBASE_CLIENT_EMAIL")
    _private_key = _os.environ.get("FIREBASE_PRIVATE_KEY")
    if _project_id and _client_email and _private_key:
        _cred = _firebase_credentials.Certificate({
            "type": "service_account",
            "project_id": _project_id,
            "private_key_id": _os.environ.get("FIREBASE_PRIVATE_KEY_ID", ""),
            "private_key": _private_key.replace("\\n", "\n"),
            "client_email": _client_email,
            "client_id": _os.environ.get("FIREBASE_CLIENT_ID", ""),
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_x509_cert_url": f"https://www.googleapis.com/robot/v1/metadata/x509/{_client_email.replace('@', '%40')}",
        })
        _firebase_admin.initialize_app(_cred)
    else:
        _firebase_admin.initialize_app()  # ADC / gcloud auth

import fitz  # PyMuPDF — ya usado por el http/main.py

from src.budget.application.services.pdf_extractor_service import (
    AnnexedPdfExtractorService,
    InlinePdfExtractorService,
    RestructuredItem,
)
from src.budget.application.services.architect_service import ArchitectService, ArchitectStatus
from src.budget.application.services.swarm_pricing_service import SwarmPricingService
from src.budget.application.use_cases.generate_budget_from_nl_uc import (
    _task_to_restructured,
)
from src.budget.catalog.application.services.catalog_lookup_service import (
    CatalogLookupService,
)
from src.budget.catalog.domain.construction_dag import load_construction_dag
from src.budget.catalog.infrastructure.adapters.firestore_catalog_repository import (
    FirestoreCatalogRepository,
)
from src.budget.infrastructure.adapters.ai.gemini_adapter import GoogleGenerativeAIAdapter
from src.budget.infrastructure.adapters.databases.firestore_price_book import (
    FirestorePriceBookAdapter,
)

# Cargar las normas del markdown (5.A.2)
try:
    from prompts.rules import load_rules
except ImportError:
    # prompts está en pythonpath directamente cuando el script se ejecuta desde services/ai-core
    import sys as _sys
    _sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from prompts.rules import load_rules

logger = logging.getLogger(__name__)


# -------- Deps wiring (singletons) -----------------------------------------

_wiring: Optional[Dict[str, Any]] = None


def _build_wiring() -> Dict[str, Any]:
    """Instancia los adapters y servicios una sola vez.

    Usa las mismas env vars que producción (leídas por cada adapter).
    """
    from firebase_admin import firestore as _firestore
    db = _firestore.client()

    llm = GoogleGenerativeAIAdapter()
    vector_search = FirestorePriceBookAdapter(db=db)
    catalog_repo = FirestoreCatalogRepository(db=db)
    catalog_lookup = CatalogLookupService(repo=catalog_repo)
    rules_md = load_rules()
    dag = load_construction_dag()

    inline_extractor = InlinePdfExtractorService(llm_provider=llm)
    annexed_extractor = AnnexedPdfExtractorService(llm_provider=llm)
    swarm_pricing = SwarmPricingService(
        llm_provider=llm,
        vector_search=vector_search,
        emitter=None,
        catalog_lookup=catalog_lookup,
        rules=rules_md,
        dag=dag,
    )
    architect = ArchitectService(llm_provider=llm)
    return {
        "llm": llm,
        "vector_search": vector_search,
        "catalog_lookup": catalog_lookup,
        "inline_extractor": inline_extractor,
        "annexed_extractor": annexed_extractor,
        "swarm_pricing": swarm_pricing,
        "architect": architect,
    }


def get_wiring() -> Dict[str, Any]:
    global _wiring
    if _wiring is None:
        logger.info("Instanciando pipeline v005 completo (singleton)...")
        _wiring = _build_wiring()
    return _wiring


# -------- PDF → raw_items (local, no HTTP) ---------------------------------


def convert_pdf_to_raw_items(pdf_path: Path, annexed_heuristic: bool = False) -> List[Dict[str, Any]]:
    """Render PDF a imágenes base64, el mismo formato que el endpoint HTTP.

    `annexed_heuristic`: cuando True, marca la mitad inferior como is_summatory
    (para el ANNEXED extractor). Para INLINE se deja todo False.
    """
    doc = fitz.open(str(pdf_path))
    total = doc.page_count
    raw_items: List[Dict[str, Any]] = []
    for p in range(total):
        page = doc.load_page(p)
        matrix = fitz.Matrix(150 / 72, 150 / 72)
        pix = page.get_pixmap(matrix=matrix)
        img = base64.b64encode(pix.tobytes("png")).decode("utf-8")
        is_summatory = annexed_heuristic and p >= (total / 2)
        raw_items.append({
            "image_base64": img,
            "page_number": p,
            "is_summatory": is_summatory,
        })
    doc.close()
    return raw_items


# -------- Flattening de BudgetPartida → dict serializable ------------------


def _flatten_partida(p) -> Dict[str, Any]:
    """Convierte un BudgetPartida (pydantic) al dict que consume el eval."""
    return {
        "code": p.code,
        "description": p.description,
        "unit": p.unit,
        "quantity": p.quantity,
        "unitPrice": p.unitPrice,
        "totalPrice": p.totalPrice,
        "chapter": (
            p.original_item.chapter
            if p.original_item and p.original_item.chapter
            else None
        ),
        "match_kind": getattr(p, "match_kind", None),
        "unit_conversion_applied": getattr(p, "unit_conversion_applied", None),
    }


# -------- Runners por flujo -------------------------------------------------


async def _run_pdf_flow(
    pdf_path: Path,
    flow: str,
    budget_id: str,
) -> List[Dict[str, Any]]:
    w = get_wiring()
    metrics: Dict[str, float] = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    annexed = flow.upper() == "ANNEXED"
    raw_items = convert_pdf_to_raw_items(pdf_path, annexed_heuristic=annexed)
    extractor = w["annexed_extractor"] if annexed else w["inline_extractor"]
    logger.info(f"[{budget_id}] {flow} extractor sobre {len(raw_items)} páginas...")
    restructured: List[RestructuredItem] = await extractor.extract(
        raw_items, budget_id, metrics
    )
    logger.info(f"[{budget_id}] extractor produjo {len(restructured)} partidas → Swarm...")
    partidas = await w["swarm_pricing"].evaluate_batch(restructured, budget_id, metrics)
    logger.info(f"[{budget_id}] Swarm devolvió {len(partidas)} partidas tasadas.")
    return [_flatten_partida(p) for p in partidas]


async def _run_nl_flow(
    brief: str,
    budget_id: str,
) -> List[Dict[str, Any]]:
    w = get_wiring()
    metrics: Dict[str, float] = {"prompt": 0, "completion": 0, "total": 0, "cost": 0.0}
    logger.info(f"[{budget_id}] Architect descomponiendo brief...")
    arch_resp, arch_usage = await w["architect"].decompose_request(brief)
    if arch_usage:
        for k in ("promptTokenCount", "candidatesTokenCount", "totalTokenCount"):
            metrics[k.replace("TokenCount", "").replace("prompt", "prompt").replace("candidates", "completion").replace("total", "total")] += arch_usage.get(k, 0)
    if arch_resp.status == ArchitectStatus.ASKING:
        raise RuntimeError(
            f"Architect pidió aclaración (no admitido en eval): {arch_resp.question}"
        )
    tasks = arch_resp.tasks
    logger.info(f"[{budget_id}] Architect devolvió {len(tasks)} tareas → Swarm...")
    restructured = [_task_to_restructured(t) for t in tasks]
    partidas = await w["swarm_pricing"].evaluate_batch(restructured, budget_id, metrics)
    logger.info(f"[{budget_id}] Swarm devolvió {len(partidas)} partidas tasadas.")
    return [_flatten_partida(p) for p in partidas]


# -------- Entrypoint síncrono para el eval ---------------------------------


def run_pipeline(
    *,
    flow: str,
    input_path: Optional[Path] = None,
    brief: Optional[str] = None,
    budget_id: str = "eval-run",
) -> List[Dict[str, Any]]:
    """Entry point del eval. Devuelve la lista plana de partidas tasadas."""
    flow_up = flow.upper()
    if flow_up in ("INLINE", "ANNEXED"):
        if input_path is None:
            raise ValueError(f"{flow_up} requires input_path")
        return asyncio.run(_run_pdf_flow(input_path, flow_up, budget_id))
    if flow_up == "NL":
        if brief is None:
            raise ValueError("NL requires brief")
        return asyncio.run(_run_nl_flow(brief, budget_id))
    raise ValueError(f"flow desconocido: {flow}")

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, BackgroundTasks, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import json
import os
import io
import fitz
import base64
import requests
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials

# Load environment variables from .env file if it exists (for local development)
load_dotenv()

import logging
import sys
logging.basicConfig(level=logging.INFO, stream=sys.stdout, format='[%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

# Initialize Firebase Admin globally once
if not firebase_admin._apps:
    project_id = os.environ.get("FIREBASE_PROJECT_ID")
    client_email = os.environ.get("FIREBASE_CLIENT_EMAIL")
    private_key = os.environ.get("FIREBASE_PRIVATE_KEY")
    
    if project_id and client_email and private_key:
        print("Firebase Admin initializing with Service Account from Env Vars.")
        # Replace escaped newlines with actual newlines, just like in the TS app
        formatted_private_key = private_key.replace('\\n', '\n')
        
        cred = credentials.Certificate({
            "type": "service_account",
            "project_id": project_id,
            "private_key_id": os.environ.get("FIREBASE_PRIVATE_KEY_ID", ""),
            "private_key": formatted_private_key,
            "client_email": client_email,
            "client_id": os.environ.get("FIREBASE_CLIENT_ID", ""),
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_x509_cert_url": f"https://www.googleapis.com/robot/v1/metadata/x509/{client_email.replace('@', '%40')}"
        })
        firebase_admin.initialize_app(cred)
    else:
        print("Firebase Admin initializing with Default Credentials.")
        # Fallback for Cloud Run ADC or local gcloud auth
        firebase_admin.initialize_app()

from src.budget.application.use_cases.extract_budget_from_pdf import ExtractBudgetFromPdfUseCase
from src.extractor.infrastructure.adapters.pdfplumber_adapter import PdfPlumberAdapter
from src.budget.domain.exceptions import MathematicalValidationError

from src.budget.application.use_cases.restructure_budget_uc import RestructureBudgetUseCase
from src.budget.application.use_cases.generate_budget_from_nl_uc import (
    GenerateBudgetFromNlUseCase,
    AskingForClarificationError,
)
from src.core.http.dependencies import get_restructure_budget_uc, get_generate_budget_from_nl_uc

app = FastAPI(
    title="NexoAI Core Intelligence",
    description="Microservice to handle spatial PDF extraction and Gemini AI Budget Pricing.",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class InternalTokenMiddleware(BaseHTTPMiddleware):
    """
    Valida el header `x-internal-token` para las rutas `/api/v1/jobs/*`.
    Si `INTERNAL_WORKER_TOKEN` está vacío en el entorno (p. ej. en local), se permite el acceso
    para no bloquear el desarrollo. En producción siempre debe estar configurado.
    """

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        # Sprint 4 Fase B — el endpoint /api/v1/admin/* también queda gated
        # por `x-internal-token` (el proxy Next.js inyecta el token vía
        # `INTERNAL_WORKER_TOKEN`). Si la env var está vacía se permite el
        # acceso para no bloquear el desarrollo local.
        if path.startswith("/api/v1/jobs/") or path.startswith("/api/v1/admin/"):
            expected = os.environ.get("INTERNAL_WORKER_TOKEN", "").strip()
            if expected:
                provided = request.headers.get("x-internal-token", "").strip()
                if provided != expected:
                    return JSONResponse(
                        status_code=401,
                        content={"error": "Unauthorized", "message": "Invalid or missing x-internal-token header."},
                    )
        return await call_next(request)


app.add_middleware(InternalTokenMiddleware)

# Spatial OCR Extractor DI
pdf_reader_adapter = PdfPlumberAdapter()
extract_use_case = ExtractBudgetFromPdfUseCase(pdf_reader=pdf_reader_adapter)

# ---------------------------------------------------------------------------
# Pipeline Jobs dispatcher — replaces the legacy BackgroundTasks endpoints.
# ---------------------------------------------------------------------------

from src.core.http.dispatch_router import (
    build_router as _build_dispatch_router,
    get_job_executor as _dispatch_get_job_executor,
    get_job_repository as _dispatch_get_job_repository,
    get_worker_job_name as _dispatch_get_worker_job_name,
)
from src.core.http.dependencies import (
    get_budget_metadata_extractor as _deps_get_budget_metadata_extractor,
    get_job_executor as _deps_get_job_executor,
    get_pdf_storage as _deps_get_pdf_storage,
    get_pipeline_job_repository as _deps_get_pipeline_job_repository,
    get_worker_job_name as _deps_get_worker_job_name,
)
from src.budget.application.services.budget_metadata_extractor import (
    BudgetMetadataExtractor,
    ExtractedBudgetMetadata,
)
from src.pipeline_jobs.application.ports.job_executor import (
    IJobExecutor,
    JobExecutorError,
)
from src.pipeline_jobs.application.ports.job_repository import (
    IPipelineJobRepository,
)
from src.pipeline_jobs.application.ports.pdf_storage import IPdfStorage
from src.pipeline_jobs.domain.entities import JobType, PipelineJob
import uuid

app.include_router(_build_dispatch_router())
# The dispatch_router declares its own get_* stubs that raise NotImplementedError.
# We re-route them to the real production singletons via FastAPI's
# `dependency_overrides`. Tests use the same hook with in-memory fakes.
app.dependency_overrides[_dispatch_get_job_repository] = (
    _deps_get_pipeline_job_repository
)
app.dependency_overrides[_dispatch_get_job_executor] = _deps_get_job_executor
app.dependency_overrides[_dispatch_get_worker_job_name] = (
    _deps_get_worker_job_name
)


@app.get("/health")
def health_check():
    return {"status": "ok"}

from pydantic import BaseModel, Field
from typing import Optional

class VisionExtractRequest(BaseModel):
    pdf_url: str
    lead_id: str = "anonymous"
    budget_id: Optional[str] = None
    strategy: str = "ANNEXED"

def _download_pdf_bytes_from_url(url: str) -> bytes:
    """Fetch a PDF over HTTP and return its raw bytes.

    Used by the vision-extract endpoint to hand the file off to GCS. We
    deliberately do NOT render images here — that work is the Job worker's
    job. Keeping this path in pure-bytes mode means the Cloud Run Service
    never holds more than the raw PDF in memory (≤100MB by policy)."""
    response = requests.get(url)
    response.raise_for_status()
    return response.content

@app.post("/api/v1/budget/vision-extract")
async def process_vision_budget(
    payload: VisionExtractRequest,
    storage: IPdfStorage = Depends(_deps_get_pdf_storage),
    repo: IPipelineJobRepository = Depends(_deps_get_pipeline_job_repository),
    executor: IJobExecutor = Depends(_deps_get_job_executor),
    worker_job_name: str = Depends(_deps_get_worker_job_name),
):
    """Legacy JSON endpoint: receives a `pdf_url`, dispatches to the Job worker.

    Refactored (P5.a) for the same OOM reason as `/api/v1/jobs/measurements`.
    Steps:

      1. Download the PDF bytes from `pdf_url` (no Fitz rendering — the Job
         worker re-renders inside its own 2GiB process).
      2. Upload those bytes to GCS via `IPdfStorage.upload_pdf`.
      3. Create a `pipeline_jobs/{jobId}` doc with jobType=`vision-extract`.
      4. Dispatch the Cloud Run Job.
      5. Return 202 with `{status, jobId, leadId, budgetId}`.
    """
    job_id = str(uuid.uuid4())
    budget_id_value = (payload.budget_id or "").strip() or job_id
    uid = (payload.lead_id or "").strip() or "anonymous"

    # 1. Download bytes from the source URL.
    try:
        pdf_bytes = _download_pdf_bytes_from_url(payload.pdf_url)
    except Exception as e:
        logger.error(
            "vision_extract_url_fetch_failed",
            extra={"pdfUrl": payload.pdf_url, "error": str(e)},
        )
        raise HTTPException(
            status_code=400, detail=f"Failed to fetch PDF from URL: {e}"
        )

    if not pdf_bytes:
        raise HTTPException(
            status_code=400, detail="Empty PDF body fetched from URL"
        )

    # Derive a stable filename from the URL — fall back to "{jobId}.pdf".
    try:
        from urllib.parse import urlparse

        url_path = urlparse(payload.pdf_url).path or ""
        filename = url_path.rsplit("/", 1)[-1].strip()
    except Exception:
        filename = ""
    if not filename.lower().endswith(".pdf"):
        filename = f"{job_id}.pdf"

    # 2. Upload to GCS.
    try:
        gcs_uri = await storage.upload_pdf(
            uid=uid,
            job_id=job_id,
            filename=filename,
            pdf_bytes=pdf_bytes,
        )
    except Exception as e:
        logger.error(
            "vision_extract_upload_failed",
            extra={"jobId": job_id, "uid": uid, "error": str(e)},
        )
        raise HTTPException(
            status_code=500, detail=f"Failed to upload PDF to GCS: {e}"
        )

    # 3. Persist PipelineJob entity.
    job = PipelineJob.new(
        jobId=job_id,
        jobType=JobType.VISION_EXTRACT,
        leadId=payload.lead_id,
        budgetId=budget_id_value,
        uid=uid,
        payload={
            "gcsUri": gcs_uri,
            "strategy": (payload.strategy or "ANNEXED").upper(),
            "filename": filename,
            "sourceUrl": payload.pdf_url,
        },
    )
    try:
        await repo.create(job)
    except Exception as e:
        logger.error(
            "vision_extract_create_job_failed",
            extra={"jobId": job_id, "error": str(e)},
        )
        raise HTTPException(
            status_code=500, detail=f"Failed to persist pipeline job: {e}"
        )
    logger.info(
        "vision_extract_dispatch_queued",
        extra={
            "jobId": job_id,
            "budgetId": budget_id_value,
            "leadId": payload.lead_id,
            "strategy": payload.strategy,
            "gcsUri": gcs_uri,
        },
    )

    # 4. Spawn Cloud Run Job execution. Same failure handling as the
    #    measurements endpoint and the dispatch_router happy path.
    try:
        execution_name = await executor.run_execution(
            job_name=worker_job_name,
            env_overrides={"JOB_ID": job_id},
        )
    except JobExecutorError as e:
        try:
            await repo.mark_dispatch_failed(
                job_id,
                error_message=str(e),
                error_type=type(e).__name__,
            )
        except Exception:
            logger.exception(
                "vision_extract_mark_failed_error",
                extra={"jobId": job_id},
            )
        logger.error(
            "vision_extract_executor_failed",
            extra={"jobId": job_id, "error": str(e)},
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to start Cloud Run Job: {e}",
        )

    await repo.attach_execution_name(job_id, execution_name)
    logger.info(
        "vision_extract_dispatch_started",
        extra={"jobId": job_id, "executionName": execution_name},
    )

    return JSONResponse(status_code=202, content={
        "status": "processing",
        "message": (
            "Vision-extract pipeline dispatched to Cloud Run Job worker."
        ),
        "jobId": job_id,
        "leadId": payload.lead_id,
        "budgetId": budget_id_value,
    })

@app.post("/api/v1/bc3/detect")
async def detect_bc3(file: UploadFile = File(...)):
    """Detección rápida de un BC3 (FIEBDC-3) para la tarjeta de importación del
    chat: parsea el archivo y devuelve conteos (capítulos, partidas, con precio,
    mediciones) + metadata. NO dispara el pipeline — es de milisegundos.
    """
    if not file.filename or not file.filename.lower().endswith(".bc3"):
        raise HTTPException(status_code=400, detail="Only .bc3 files are allowed")
    try:
        raw = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read BC3: {e}")
    if not raw:
        raise HTTPException(status_code=400, detail="Empty BC3 body")

    from src.budget.bc3_parser import Bc3Parser, bc3_tree_to_restructured_items

    try:
        tree = Bc3Parser().parse(raw)
        # Usamos los RestructuredItem (misma proyección que entra al pipeline):
        # así los conteos coinciden con lo que verá el usuario en el editor.
        items = bc3_tree_to_restructured_items(tree)
    except Exception as e:
        logger.error(f"BC3 detect parse failed: {e}")
        raise HTTPException(status_code=422, detail=f"No se pudo leer el BC3: {e}")

    priced = sum(1 for it in items if it.bc3_unit_price is not None)
    with_measurements = sum(1 for it in items if it.measurements)
    distinct_chapters = len({it.chapter for it in items if it.chapter})

    # Título = descripción de la raíz de DOCUMENTO (código con "##"), no de un
    # capítulo. Si el BC3 no la trae, se deja vacío y la UI usa el nombre de archivo.
    title = ""
    for code in tree.root_codes:
        c = tree.concepts.get(code)
        if c and c.description and "##" in code:
            title = c.description
            break

    return {
        "filename": file.filename,
        "version": tree.version,
        "encoding": tree.encoding,
        "currency": tree.currency,
        "title": title,
        "chapters": distinct_chapters,
        "partidas": len(items),
        "priced_partidas": priced,
        "measurements": with_measurements,
        "has_prices": priced > 0,
    }


@app.post("/api/v1/jobs/measurements")
async def process_measurement_job(
    file: UploadFile = File(...),
    leadId: str = Form("anonymous"),
    budgetId: str = Form(None),
    strategy: str = Form("ANNEXED"),
    storage: IPdfStorage = Depends(_deps_get_pdf_storage),
    repo: IPipelineJobRepository = Depends(_deps_get_pipeline_job_repository),
    executor: IJobExecutor = Depends(_deps_get_job_executor),
    worker_job_name: str = Depends(_deps_get_worker_job_name),
):
    """Legacy `multipart/form-data` PDF endpoint.

    Refactored (P5.a) to stop running the budget pipeline inside the Service
    via BackgroundTasks — that approach OOM-killed the Cloud Run Service even
    with 8GiB because the Sprint 1 swarm now keeps the BGE reranker + the
    1,661-item catalog resident. We instead:

      1. Materialise the PDF bytes in memory just long enough to upload them
         to the `pipeline_uploads` bucket.
      2. Create a `pipeline_jobs/{jobId}` Firestore doc with jobType=
         `measurements` and payload `{gcsUri, strategy, ...}`.
      3. Dispatch a fresh execution of the `ai-core-worker` Cloud Run Job
         with `JOB_ID={jobId}` so the worker picks it up.
      4. Return 202 with `{status, jobId, message, leadId, budgetId}` so the
         UI keeps the existing wire shape (`budgetId`, `leadId` preserved).

    Heavy work (Fitz page rendering, Gemini swarm) now lives in the Job
    worker, which has its own 2GiB memory budget isolated from the Service.
    """
    if not file.filename or not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    try:
        pdf_bytes = await file.read()
    except Exception as e:
        logger.error(f"Failed to read uploaded PDF: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to read PDF: {e}")

    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Empty PDF body")

    job_id = str(uuid.uuid4())
    budget_id_value = (budgetId or "").strip() or job_id
    # Use `leadId` as `uid` until the frontend passes a real auth uid — this
    # mirrors the placeholder that Next.js currently sends (`leadId="admin-user"`).
    uid = (leadId or "").strip() or "anonymous"

    # 1. Upload the PDF to GCS so the worker can fetch it.
    try:
        gcs_uri = await storage.upload_pdf(
            uid=uid,
            job_id=job_id,
            filename=file.filename,
            pdf_bytes=pdf_bytes,
        )
    except Exception as e:
        logger.error(
            "measurements_dispatch_upload_failed",
            extra={"jobId": job_id, "uid": uid, "error": str(e)},
        )
        raise HTTPException(
            status_code=500, detail=f"Failed to upload PDF to GCS: {e}"
        )

    # 2. Persist the PipelineJob entity. Worker reads this when JOB_ID arrives.
    job = PipelineJob.new(
        jobId=job_id,
        jobType=JobType.MEASUREMENTS,
        leadId=leadId,
        budgetId=budget_id_value,
        uid=uid,
        payload={
            "gcsUri": gcs_uri,
            "strategy": (strategy or "ANNEXED").upper(),
            "filename": file.filename,
        },
    )
    try:
        await repo.create(job)
    except Exception as e:
        logger.error(
            "measurements_dispatch_create_job_failed",
            extra={"jobId": job_id, "error": str(e)},
        )
        raise HTTPException(
            status_code=500, detail=f"Failed to persist pipeline job: {e}"
        )
    logger.info(
        "measurements_dispatch_queued",
        extra={
            "jobId": job_id,
            "budgetId": budget_id_value,
            "leadId": leadId,
            "strategy": strategy,
            "gcsUri": gcs_uri,
        },
    )

    # 3. Spawn a Cloud Run Jobs execution. If the executor refuses, mark the
    #    job as `failed` so the UI surfaces a real error instead of a phantom
    #    `queued` job. Pattern lifted from `dispatch_router.dispatch`.
    try:
        execution_name = await executor.run_execution(
            job_name=worker_job_name,
            env_overrides={"JOB_ID": job_id},
        )
    except JobExecutorError as e:
        try:
            await repo.mark_dispatch_failed(
                job_id,
                error_message=str(e),
                error_type=type(e).__name__,
            )
        except Exception:
            logger.exception(
                "measurements_dispatch_mark_failed_error",
                extra={"jobId": job_id},
            )
        logger.error(
            "measurements_dispatch_executor_failed",
            extra={"jobId": job_id, "error": str(e)},
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to start Cloud Run Job: {e}",
        )

    await repo.attach_execution_name(job_id, execution_name)
    logger.info(
        "measurements_dispatch_started",
        extra={"jobId": job_id, "executionName": execution_name},
    )

    return JSONResponse(status_code=202, content={
        "status": "processing",
        "message": (
            "Measurements pipeline dispatched to Cloud Run Job worker."
        ),
        "jobId": job_id,
        "leadId": leadId,
        "budgetId": budget_id_value,
    })


# -----------------------------------------------------------------------------
# NL → Budget
# Punto de entrada que reemplaza al pipeline Node (ArchitectAgent/Surveyor/Judge).
# Recibe el brief que el Asistente IA ha recogido y lanza el job en background.
# -----------------------------------------------------------------------------


class NlBudgetRequest(BaseModel):
    leadId: str = "anonymous"
    budgetId: Optional[str] = None
    narrative: str = Field(..., description="Brief técnico consolidado (finalBrief + specs + historia de chat).")
    clientName: Optional[str] = None
    budgetTitle: Optional[str] = None


@app.post("/api/v1/jobs/nl-budget")
async def process_nl_budget_job(
    payload: NlBudgetRequest,
    repo: IPipelineJobRepository = Depends(_deps_get_pipeline_job_repository),
    executor: IJobExecutor = Depends(_deps_get_job_executor),
    worker_job_name: str = Depends(_deps_get_worker_job_name),
):
    """Legacy NL → Budget endpoint.

    Refactored (P5.a) to stop running `GenerateBudgetFromNlUseCase` inline
    via BackgroundTasks. Same OOM rationale as the PDF endpoints: the
    SwarmPricing service keeps BGE reranker + catalog resident, so even
    no-PDF NL jobs spike memory above the Service quota.

    Steps:
      1. Create `pipeline_jobs/{jobId}` with jobType=`nl-budget` and payload
         `{narrative, clientName, budgetTitle}`.
      2. Dispatch a Cloud Run Jobs execution of `ai-core-worker`.
      3. Return 202.

    Telemetry continues to land on `pipeline_telemetry/{jobId}/events` —
    the Worker emits the same events as the old BackgroundTasks path.
    """
    if not payload.narrative or len(payload.narrative.strip()) < 10:
        raise HTTPException(status_code=400, detail="narrative demasiado corta")

    job_id = str(uuid.uuid4())
    budget_id_value = (payload.budgetId or "").strip() or job_id
    uid = (payload.leadId or "").strip() or "anonymous"

    # 1. Persist PipelineJob entity.
    job = PipelineJob.new(
        jobId=job_id,
        jobType=JobType.NL_BUDGET,
        leadId=payload.leadId,
        budgetId=budget_id_value,
        uid=uid,
        payload={
            "narrative": payload.narrative,
            "clientName": (payload.clientName or "").strip() or None,
            "budgetTitle": (payload.budgetTitle or "").strip() or None,
        },
    )
    try:
        await repo.create(job)
    except Exception as e:
        logger.error(
            "nl_budget_create_job_failed",
            extra={"jobId": job_id, "error": str(e)},
        )
        raise HTTPException(
            status_code=500, detail=f"Failed to persist pipeline job: {e}"
        )
    logger.info(
        "nl_budget_dispatch_queued",
        extra={
            "jobId": job_id,
            "budgetId": budget_id_value,
            "leadId": payload.leadId,
            "narrativeLen": len(payload.narrative),
        },
    )

    # 2. Dispatch worker.
    try:
        execution_name = await executor.run_execution(
            job_name=worker_job_name,
            env_overrides={"JOB_ID": job_id},
        )
    except JobExecutorError as e:
        try:
            await repo.mark_dispatch_failed(
                job_id,
                error_message=str(e),
                error_type=type(e).__name__,
            )
        except Exception:
            logger.exception(
                "nl_budget_mark_failed_error",
                extra={"jobId": job_id},
            )
        logger.error(
            "nl_budget_executor_failed",
            extra={"jobId": job_id, "error": str(e)},
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to start Cloud Run Job: {e}",
        )

    await repo.attach_execution_name(job_id, execution_name)
    logger.info(
        "nl_budget_dispatch_started",
        extra={"jobId": job_id, "executionName": execution_name},
    )

    return JSONResponse(status_code=202, content={
        "status": "processing",
        "message": "NL → Budget pipeline dispatched to Cloud Run Job worker.",
        "jobId": job_id,
        "leadId": payload.leadId,
        "budgetId": budget_id_value,
    })


# ---------------------------------------------------------------------------
# POST /api/v1/jobs/extract-metadata
# Sync endpoint that reads the PDF from GCS, renders ONLY the first page, and
# asks Gemini Flash for the client/budget header. Used by the wizard PDF flow
# to pre-fill a confirmation form BEFORE dispatching the heavy job. Failure
# returns empty fields (200) — the UI keeps the form editable.
# ---------------------------------------------------------------------------


class ExtractMetadataRequest(BaseModel):
    gcsUri: str = Field(..., description="gs://bucket/path al PDF en Cloud Storage.")


def _first_page_image_b64_from_pdf(pdf_bytes: bytes, dpi: int = 150) -> str:
    """Render only page 0 of the PDF as a base64-encoded PNG. Keeps the cost
    bounded — header extraction never needs more than the first page."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        if doc.page_count == 0:
            return ""
        page = doc.load_page(0)
        zoom = dpi / 72
        matrix = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=matrix)
        img_bytes = pix.tobytes("png")
        return base64.b64encode(img_bytes).decode("utf-8")
    finally:
        doc.close()


@app.post("/api/v1/jobs/extract-metadata", response_model=ExtractedBudgetMetadata)
async def extract_pdf_metadata(
    payload: ExtractMetadataRequest,
    extractor: BudgetMetadataExtractor = Depends(_deps_get_budget_metadata_extractor),
    storage: IPdfStorage = Depends(_deps_get_pdf_storage),
) -> ExtractedBudgetMetadata:
    """Pre-flight to the heavy pipeline: returns a best-effort guess of
    `{clientName, budgetTitle, projectAddress, confidence}` so the UI can
    show a confirmation step. Never raises on extraction failure — returns
    empty fields with confidence=0 so the user can fill them manually."""
    try:
        pdf_bytes = await storage.download_to_bytes(payload.gcsUri)
    except Exception as e:
        logger.exception(
            "extract_metadata_download_failed",
            extra={"gcsUri": payload.gcsUri, "error": str(e)},
        )
        # Return empty rather than 500 — UI will fall back to manual entry.
        return ExtractedBudgetMetadata()

    try:
        image_b64 = _first_page_image_b64_from_pdf(pdf_bytes)
    except Exception as e:
        logger.exception(
            "extract_metadata_render_failed",
            extra={"gcsUri": payload.gcsUri, "error": str(e)},
        )
        return ExtractedBudgetMetadata()

    if not image_b64:
        return ExtractedBudgetMetadata()

    return await extractor.extract(image_b64)


# ---------------------------------------------------------------------------
# Sprint 4 Fase B — Admin TEST endpoint para el parser TABULAR coord-based.
#
# POST /api/v1/admin/test-tabular-parser
#
# Recibe un PDF (`multipart/form-data` con `file`), lo procesa con
# `TabularParser().parse(...)` y retorna las métricas + items extraídos sin
# crear ningún Budget, sin tocar Firestore y sin lanzar el Swarm. Sirve a la
# UI admin (`/dashboard/admin/pdf-layout-test`) para diagnosticar layouts
# nuevos de PDFs cliente.
#
# Gated por `x-internal-token` igual que `/api/v1/jobs/*`.
# ---------------------------------------------------------------------------


@app.post("/api/v1/admin/test-tabular-parser")
async def test_tabular_parser(file: UploadFile = File(...)) -> JSONResponse:
    """Evaluación pura del parser TABULAR sobre un PDF subido.

    No genera Budget. No persiste nada en Firestore. No invoca el Swarm.
    Pensado para QA admin y diagnóstico de layouts nuevos.

    Respuesta (200):
      {
        "viable": bool,
        "reason": str | null,             # razón del aborto si !viable
        "partidasCount": int,
        "qtyRate": float,                 # 0-1
        "chapterRate": float,             # 0-1
        "pagesTotal": int,
        "pagesWithHeader": int,
        "durationSeconds": float,
        "items": [                        # max 200 entradas (capadas)
          {
            "code": str,
            "description": str,
            "unit": str,
            "quantity": float | null,
            "chapter": str,
            "sub_chapter": str | null,
            "apartado": str | null,
            "page": int | null
          },
          ...
        ],
        "truncated": bool,                # True si len(partidas) > 200 (UI lo avisa)
        "pageMetrics": [                  # 1 entry per page; útil para inspección granular
          {
            "page": int,
            "hasHeader": bool,
            "rowsFound": int,
            "partidasExtracted": int,
            "qtyFound": int
          },
          ...
        ]
      }
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    try:
        pdf_bytes = await file.read()
    except Exception as e:
        logger.error("admin_test_tabular_read_failed", extra={"error": str(e)})
        raise HTTPException(status_code=400, detail=f"Failed to read PDF: {e}")

    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Empty PDF body")

    # Cap defensive: PDFs >50MB se rechazan — son layouts patológicos o
    # escaneos grandes que no tienen sentido procesar en modo test síncrono.
    if len(pdf_bytes) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="PDF too large (max 50MB)")

    # Lazy import — evita coste de pdfplumber en el cold start del Service si
    # nadie usa esta ruta.
    from src.budget.pdf_tabular_parser.application.tabular_parser import TabularParser

    parser = TabularParser()
    try:
        result = parser.parse(pdf_bytes)
    except Exception as e:
        logger.exception("admin_test_tabular_parser_exception", extra={"error": str(e)})
        # Devolvemos 200 con viable=False + razón explícita en vez de 500.
        # La UI admin necesita ver el detalle para diagnosticar el layout.
        return JSONResponse(
            status_code=200,
            content={
                "viable": False,
                "reason": f"exception:{type(e).__name__}: {str(e)[:200]}",
                "partidasCount": 0,
                "qtyRate": 0.0,
                "chapterRate": 0.0,
                "pagesTotal": 0,
                "pagesWithHeader": 0,
                "durationSeconds": 0.0,
                "items": [],
                "truncated": False,
                "pageMetrics": [],
            },
        )

    viable = result.is_viable()

    # Caping: max 200 items en respuesta para no inflar payload. La UI sabe
    # mostrar `truncated=true` y sugerir descargar el JSON completo si hace falta.
    ITEMS_CAP = 200
    truncated = len(result.partidas) > ITEMS_CAP
    items_payload = [
        {
            "code": p.code or "",
            "description": p.description or "",
            "unit": p.unit or "",
            "quantity": p.quantity,
            "chapter": p.chapter or "",
            "sub_chapter": p.sub_chapter,
            "apartado": p.apartado,
            "page": p.page_number,
        }
        for p in result.partidas[:ITEMS_CAP]
    ]

    page_metrics_payload = [
        {
            "page": pm.page_number,
            "hasHeader": pm.has_header,
            "rowsFound": pm.rows_found,
            "partidasExtracted": pm.partidas_extracted,
            "qtyFound": pm.qty_found,
        }
        for pm in result.page_metrics
    ]

    return JSONResponse(
        status_code=200,
        content={
            "viable": bool(viable),
            "reason": result.reason,
            "mode": getattr(result, "mode", None),
            "partidasCount": result.partidas_count,
            "qtyRate": float(result.qty_rate),
            "chapterRate": float(result.chapter_rate),
            "pagesTotal": int(result.pages_total),
            "pagesWithHeader": int(result.pages_with_header),
            "durationSeconds": float(result.duration_seconds),
            # Sprint 4 Fase F — metadata del documento (título proyecto + address).
            "documentTitle": getattr(result, "document_title", None),
            "documentAddress": getattr(result, "document_address", None),
            "items": items_payload,
            "truncated": truncated,
            "pageMetrics": page_metrics_payload,
        },
    )


# ---------------------------------------------------------------------------
# POST /api/v1/admin/price-book/detect-pages
# Compuerta 1 del asistente de actualización del libro de precios: recibe el PDF
# del libro COAATMCA, clasifica cada página por densidad (importes + códigos +
# imágenes) y devuelve los RANGOS de páginas de precios + la señal por página,
# para que el admin confirme/ajuste antes de extraer. NO escribe nada en Firestore.
# Rápido (fitz, solo texto). Gated por x-internal-token igual que /api/v1/admin/*.
# ---------------------------------------------------------------------------


@app.post("/api/v1/admin/price-book/detect-pages")
async def price_book_detect_pages(
    gcsUri: str = Form(...),
    storage: IPdfStorage = Depends(_deps_get_pdf_storage),
) -> JSONResponse:
    """Detecta las páginas de precios de un libro COAATMCA (preview, sin escribir).

    El PDF llega ya subido a GCS por el navegador (`uploadPdfForPipelineJob`) —
    evita el tope de 4,5MB de body de las server actions en Vercel. Aquí solo se
    recibe el `gs://` URI y se descarga con la SA del servicio.
    """
    from src.budget.catalog.price_book_page_detector import detect_price_pages

    if not gcsUri or not gcsUri.startswith("gs://"):
        raise HTTPException(status_code=400, detail="`gcsUri` (gs://...) requerido")
    try:
        pdf_bytes = await storage.download_to_bytes(gcsUri)
    except Exception as e:
        logger.exception("price_book_detect_pages_download_failed")
        raise HTTPException(status_code=422, detail=f"No se pudo leer el PDF de GCS: {e}")
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="PDF vacío en GCS")

    try:
        detection = detect_price_pages(pdf_bytes)
    except Exception as e:
        logger.exception("price_book_detect_pages_failed")
        raise HTTPException(status_code=422, detail=f"No se pudo analizar el PDF: {e}")

    logger.info(
        "price_book_detect_pages",
        extra={
            "gcs_uri": gcsUri,
            "total_pages": detection.total_pages,
            "price_pages": detection.price_page_count,
            "ranges": len(detection.ranges),
        },
    )
    return JSONResponse(status_code=200, content=detection.to_dict())


@app.post("/api/v1/admin/price-book/extract-preview")
async def price_book_extract_preview(
    gcsUri: str = Form(...),
    pages: str = Form(...),
    year: int = Form(0),
    limit: int = Form(30),
    storage: IPdfStorage = Depends(_deps_get_pdf_storage),
) -> JSONResponse:
    """Compuerta 2 (preview) del asistente de actualización del libro.

    Extrae una MUESTRA representativa (repartida por todo el libro) de las
    páginas que el humano confirmó y la contrasta con el libro ACTIVO
    (`price_book_{CATALOG_YEAR}`): cuántas partidas son nuevas, cuántas cambian
    de precio y cuáles siguen igual, con ejemplos ordenados por magnitud.

    Es SINCRÓNICO y ACOTADO (`limit` páginas): sirve para validar que la
    extracción y los precios son correctos ANTES de ingestar. La extracción del
    libro COMPLETO + embeddings + escritura es el job de ingesta (4c), que
    reutiliza este mismo `diff_items` sobre el universo entero.
    """
    import asyncio
    import json as _json
    import tempfile
    from pathlib import Path as _Path

    from src.budget.catalog.pdf_extractor import extract_catalog
    from src.budget.catalog.price_book_diff import diff_items, even_sample
    from src.budget.catalog.catalog_config import price_book_collection

    if not gcsUri or not gcsUri.startswith("gs://"):
        raise HTTPException(status_code=400, detail="`gcsUri` (gs://...) requerido")
    try:
        pdf_bytes = await storage.download_to_bytes(gcsUri)
    except Exception as e:
        logger.exception("price_book_extract_preview_download_failed")
        raise HTTPException(status_code=422, detail=f"No se pudo leer el PDF de GCS: {e}")
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="PDF vacío en GCS")

    # `pages`: JSON array (["1","2"]) o CSV ("1,2,3") de páginas 1-based.
    raw = (pages or "").strip()
    try:
        if raw.startswith("["):
            parsed = [int(x) for x in _json.loads(raw)]
        else:
            parsed = [int(x) for x in raw.split(",") if x.strip()]
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="`pages` inválido (usa JSON array o CSV de enteros)",
        )
    confirmed = sorted({p for p in parsed if p >= 1})
    if not confirmed:
        raise HTTPException(status_code=400, detail="No hay páginas confirmadas para extraer")

    limit = max(1, min(int(limit or 30), 120))
    sample = even_sample(confirmed, limit)

    def _work() -> dict:
        # 1. Extraer la muestra (pdfplumber es bloqueante → to_thread).
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(pdf_bytes)
            tmp_path = _Path(tmp.name)
        try:
            extraction = extract_catalog(tmp_path, page_filter=sample)
        finally:
            try:
                tmp_path.unlink()
            except OSError:
                pass

        items = [
            {
                "code": it.code,
                "unit": it.unit,
                "description": it.description,
                "price_total": it.price_total,
                "breakdown_count": len(it.breakdowns),
                "page": it.page_physical,
                "chapter": it.chapter,
            }
            for it in extraction.items
        ]

        # 2. Índice del libro activo (code -> priceTotal), proyección ligera.
        collection = price_book_collection()
        active_index: dict[str, float] = {}
        try:
            from firebase_admin import firestore as _fs

            db = _fs.client()
            q = (
                db.collection(collection)
                .where("kind", "==", "item")
                .select(["code", "priceTotal"])
            )
            for snap in q.stream():
                d = snap.to_dict() or {}
                c = (str(d.get("code") or "")).strip()
                if not c:
                    continue
                try:
                    active_index[c] = float(d.get("priceTotal") or 0.0)
                except (TypeError, ValueError):
                    active_index[c] = 0.0
        except Exception as e:  # noqa: BLE001 — el diff sigue siendo útil (todo "new")
            logger.warning(
                "extract_preview_active_index_failed",
                extra={"error": str(e), "collection": collection},
            )

        # 3. Diff.
        diff = diff_items(items, active_index)
        return {
            "target_year": year or None,
            "active_collection": collection,
            "pages_confirmed": len(confirmed),
            "pages_sampled": sample,
            "sampled_count": len(sample),
            "extracted_count": len(items),
            "active_item_count": len(active_index),
            "items_preview": items[:40],
            "diff": diff.to_dict(),
        }

    try:
        result = await asyncio.to_thread(_work)
    except Exception as e:
        logger.exception("price_book_extract_preview_failed")
        raise HTTPException(status_code=422, detail=f"No se pudo extraer/diferenciar: {e}")

    logger.info(
        "price_book_extract_preview",
        extra={
            "pdf_name": file.filename,
            "pages_confirmed": len(confirmed),
            "sampled": len(sample),
            "extracted": result["extracted_count"],
            "diff_new": result["diff"]["summary"]["new"],
            "diff_changed": result["diff"]["summary"]["changed"],
        },
    )
    return JSONResponse(status_code=200, content=result)


@app.post("/api/v1/jobs/price-book-extract")
async def dispatch_price_book_ingest(
    gcsUri: str = Form(...),
    pages: str = Form(...),
    year: int = Form(...),
    leadId: str = Form("admin-user"),
    repo: IPipelineJobRepository = Depends(_deps_get_pipeline_job_repository),
    executor: IJobExecutor = Depends(_deps_get_job_executor),
    worker_job_name: str = Depends(_deps_get_worker_job_name),
) -> JSONResponse:
    """Fase 4c — lanza el JOB de ingesta del libro nuevo a staging.

    El PDF ya está en GCS (subido por el navegador con `uploadPdfForPipelineJob`
    — evita el tope de 4,5MB de las server actions en Vercel). Aquí solo se crea
    `pipeline_jobs/{jobId}` con el `gcsUri` y se dispara el Cloud Run Job
    `ai-core-worker` con `JOB_TYPE=price-book-extract`. Responde 202 al instante;
    el progreso llega por `pipeline_telemetry/{jobId}`.
    """
    import json as _json

    if not gcsUri or not gcsUri.startswith("gs://"):
        raise HTTPException(status_code=400, detail="`gcsUri` (gs://...) requerido")

    raw = (pages or "").strip()
    try:
        parsed = _json.loads(raw) if raw.startswith("[") else [int(x) for x in raw.split(",") if x.strip()]
        page_list = sorted({int(p) for p in parsed if int(p) >= 1})
    except Exception:
        raise HTTPException(status_code=400, detail="`pages` inválido (JSON array o CSV de enteros)")
    if not page_list:
        raise HTTPException(status_code=400, detail="No hay páginas confirmadas para ingestar")
    if not year or year < 2000:
        raise HTTPException(status_code=400, detail="`year` inválido")

    job_id = str(uuid.uuid4())
    uid = (leadId or "").strip() or "admin-user"

    # Persistir el PipelineJob (el PDF ya está en GCS; el worker lo descarga).
    job = PipelineJob.new(
        jobId=job_id,
        jobType=JobType.PRICE_BOOK_EXTRACT,
        leadId=uid,
        budgetId=job_id,
        uid=uid,
        payload={
            "gcsUri": gcsUri,
            "pages": page_list,
            "year": int(year),
        },
    )
    try:
        await repo.create(job)
    except Exception as e:
        logger.error("price_book_ingest_create_job_failed", extra={"jobId": job_id, "error": str(e)})
        raise HTTPException(status_code=500, detail=f"Failed to persist pipeline job: {e}")

    # 3. Disparar el Cloud Run Job worker con el tipo de job en el env.
    try:
        execution_name = await executor.run_execution(
            job_name=worker_job_name,
            env_overrides={"JOB_ID": job_id, "JOB_TYPE": "price-book-extract"},
        )
    except JobExecutorError as e:
        try:
            await repo.mark_dispatch_failed(job_id, error_message=str(e), error_type=type(e).__name__)
        except Exception:
            logger.exception("price_book_ingest_dispatch_mark_failed", extra={"jobId": job_id})
        logger.error("price_book_ingest_executor_failed", extra={"jobId": job_id, "error": str(e)})
        raise HTTPException(status_code=500, detail=f"Failed to start Cloud Run Job: {e}")

    await repo.attach_execution_name(job_id, execution_name)
    logger.info(
        "price_book_ingest_dispatch_started",
        extra={
            "jobId": job_id,
            "pages": len(page_list),
            "year": int(year),
            "executionName": execution_name,
        },
    )
    return JSONResponse(
        status_code=202,
        content={
            "status": "processing",
            "jobId": job_id,
            "pages": len(page_list),
            "year": int(year),
            "staging": f"price_book_{int(year)}_staging",
        },
    )

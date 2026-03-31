from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, BackgroundTasks
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
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
from src.core.http.dependencies import get_restructure_budget_uc

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

# Spatial OCR Extractor DI
pdf_reader_adapter = PdfPlumberAdapter()
extract_use_case = ExtractBudgetFromPdfUseCase(pdf_reader=pdf_reader_adapter)

@app.get("/health")
def health_check():
    return {"status": "ok"}

from pydantic import BaseModel
from typing import Optional

class VisionExtractRequest(BaseModel):
    pdf_url: str
    lead_id: str = "anonymous"
    budget_id: Optional[str] = None
    strategy: str = "ANNEXED"

def download_and_convert_pdf(url: str):
    response = requests.get(url)
    response.raise_for_status()
    doc = fitz.open(stream=response.content, filetype="pdf")
    total_pages = doc.page_count
    
    raw_items = []
    logger.info(f"Descargado PDF de {total_pages} páginas. Iniciando renderizado Fitz a base64...")
    for p in range(total_pages):
        page = doc.load_page(p)
        matrix = fitz.Matrix(150 / 72, 150 / 72)
        pix = page.get_pixmap(matrix=matrix)
        img_data = pix.tobytes("png")
        b64 = base64.b64encode(img_data).decode('utf-8')
        
        # Heurística simple: Última mitad de páginas suele ser sumatorios en formato BC3/Presto
        is_summatory = True if p >= (total_pages / 2) else False
        raw_items.append({"image_base64": b64, "page_number": p, "is_summatory": is_summatory})
        
    doc.close()
    return raw_items

@app.post("/api/v1/budget/vision-extract")
async def process_vision_budget(
    background_tasks: BackgroundTasks,
    payload: VisionExtractRequest,
    restructure_uc: RestructureBudgetUseCase = Depends(get_restructure_budget_uc)
):
    try:
        # Descarga y conversión sníncrona inicial
        raw_items = download_and_convert_pdf(payload.pdf_url)
        logger.info(f"Generados {len(raw_items)} chunks de página visuales.")

        async def run_ai_vision_job():
            try:
                logger.info("Background AI Vision Job Started.")
                await restructure_uc.execute(raw_items, lead_id=payload.lead_id, budget_id=payload.budget_id, strategy=payload.strategy)
                logger.info("Background AI Vision Job Completed Successfully.")
            except Exception as e:
                logger.error(f"Background AI Vision Job Failed: {e}")
                import traceback
                traceback.print_exc()

        background_tasks.add_task(run_ai_vision_job)
        return JSONResponse(status_code=202, content={
            "status": "processing", 
            "message": "AI Vision Pipeline Started in background.",
            "leadId": payload.lead_id
        })
    except Exception as e:
        logger.error(f"Failed to start vision pipeline: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/jobs/measurements")
async def process_measurement_job(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    leadId: str = Form("anonymous"),
    budgetId: str = Form(None),
    strategy: str = Form("ANNEXED"),
    restructure_uc: RestructureBudgetUseCase = Depends(get_restructure_budget_uc)
):
    """
    1. Spatial PDF Extraction (Synchronous Conversion to Mapped Images via Fitz)
    2. Spawns Background AI Job (Asynchronous) into Map-Reduce 'ANNEXED' workflow.
    Returns 202 Accepted instantly.
    """
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    try:
        pdf_bytes = await file.read()
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        total_pages = doc.page_count
        
        raw_items = []
        logger.info(f"Recibido archivo {file.filename} ({total_pages} páginas). Convirtiendo PDF a imágenes B64...")
        for p in range(total_pages):
            page = doc.load_page(p)
            matrix = fitz.Matrix(150 / 72, 150 / 72)
            pix = page.get_pixmap(matrix=matrix)
            img_data = pix.tobytes("png")
            b64 = base64.b64encode(img_data).decode('utf-8')
            
            # Heurística temporal general para separar cuadros de texto de sumatorios BC3
            is_summatory = True if p >= (total_pages / 2) else False
            raw_items.append({"image_base64": b64, "page_number": p, "is_summatory": is_summatory})
            
        doc.close()
        logger.info(f"Generados {len(raw_items)} visual chunks en memoria. Traspasando trabajo pesado a worker Asíncrono.")

        async def run_ai_vision_job():
            try:
                logger.info(f"Swarm Pricing Strategy: {strategy} ({len(raw_items)} chunks) INICIANDO...")
                await restructure_uc.execute(raw_items, lead_id=leadId, budget_id=budgetId, strategy=strategy)
                logger.info("🎉 Background AI Budget Processing Exitóso!")
            except Exception as e:
                logger.error(f"Background AI Job Failed: {e}")
                import traceback
                traceback.print_exc()
            
        background_tasks.add_task(run_ai_vision_job)

        return JSONResponse(status_code=202, content={
            "status": "processing", 
            "message": "NexoAI Vision Swarm is now deconstructing the PDF budget.",
            "leadId": leadId,
            "budgetId": budgetId
        })
        
    except Exception as e:
         logger.error(f"Error procesando PDF: {e}")
         raise HTTPException(status_code=500, detail=str(e))

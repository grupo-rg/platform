import os
import sys
import json
import asyncio
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

project_root = Path(r"c:\Users\Usuario\Documents\github\works\nexoai\services\ai-core")
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv
load_dotenv(project_root / ".env")

import firebase_admin
from firebase_admin import credentials
if not firebase_admin._apps:
    print("[INIT] Configurando Firebase...")
    project_id = os.environ.get("FIREBASE_PROJECT_ID")
    client_email = os.environ.get("FIREBASE_CLIENT_EMAIL")
    private_key = os.environ.get("FIREBASE_PRIVATE_KEY")
    if project_id and client_email and private_key:
        formatted_private_key = private_key.replace('\\n', '\n')
        cred = credentials.Certificate({
            "type": "service_account",
            "project_id": project_id,
            "private_key": formatted_private_key,
            "client_email": client_email,
            "token_uri": "https://oauth2.googleapis.com/token",
        })
        firebase_admin.initialize_app(cred)

from src.budget.application.use_cases.extract_budget_from_pdf import ExtractBudgetFromPdfUseCase
from src.extractor.infrastructure.adapters.pdfplumber_adapter import PdfPlumberAdapter
from src.core.http.dependencies import get_restructure_budget_uc

async def main():
    pdf_path = Path(r"c:\Users\Usuario\Documents\github\works\nexoai\data_extraction_lab\docs-to-analisys\MU02-ALBAÑILERÍA-MEDICIONES-2202.pdf")
    output_json = Path(r"c:\Users\Usuario\Documents\github\works\nexoai\data_extraction_lab\mu02_ai_generated_complete.json")
    
    if not pdf_path.exists():
        print(f"❌ PDF NO ENCONTRADO: {pdf_path}")
        return
        
    print(f"📄 Lanzando Pipeline IA V2 para: {pdf_path.name}")
    
    # 1. Extracción Estructural
    pdf_reader = PdfPlumberAdapter()
    extract_uc = ExtractBudgetFromPdfUseCase(pdf_reader=pdf_reader)
    
    with open(pdf_path, "rb") as f:
        raw_extraction_result = extract_uc.execute(f)
        
    full_list = raw_extraction_result.get("extracted_text", [])
    raw_items = full_list if isinstance(full_list, list) else [{"text": str(full_list)}]
    
    # Procesar solo 1 página (Ej: la página 1)
    if len(raw_items) > 0:
        raw_items = [raw_items[0]]
    else:
        raw_items = raw_items[:1]
    
    print(f"-> Procesando activamente {len(raw_items)} página(s) seleccionadas.")
    
    # 2. Re-estructuración y Pricing RAG Batch
    restructure_uc = get_restructure_budget_uc()
    
    try:
        final_budget = await restructure_uc.execute(
            raw_items=raw_items, 
            lead_id="test-auditor", 
            budget_id="test-budget-page1-real"
        )
        
        print("\n✅ AI PIPELINE COMPLETADO.")
        
        # Save exact result to a debug json file!
        with open(output_json, "w", encoding="utf-8") as f:
            import json
            json.dump(final_budget.model_dump(mode="json", by_alias=True), f, indent=2, ensure_ascii=False)
            
        print(f"\n📂 Salida técnica guardada localmente en: {output_json}")
    except Exception as e:
        print(f"\n❌ ERROR FATAL DURANTE LA EJECUCIÓN PIPELINE: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())

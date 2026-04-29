import os
import sys
import base64
import json
import asyncio
from pathlib import Path
from io import BytesIO
import logging
from typing import List, Optional
from pydantic import BaseModel, Field

# Add project root to sys.path so we can import src
project_root = Path(r"c:\Users\Usuario\Documents\github\works\nexoai\services\ai-core")
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv
load_dotenv(project_root / ".env")

import fitz
from src.budget.infrastructure.adapters.ai.gemini_adapter import GoogleGenerativeAIAdapter

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# --- Pydantic Schema for the exact extraction ---
class HumanItem(BaseModel):
    code: str = Field(description="Código exacto de la partida (e.g., '1.1', 'VALLADOM')")
    description: str = Field(description="Descripción textual tal y como aparece en el documento")
    unit: str = Field(description="Unidad de medida (Ud, M, M2, M3, etc.)")
    quantity: float = Field(description="Cantidad o medición")
    unit_price: float = Field(description="Precio unitario en euros dictado por el humano")
    total_price: float = Field(description="Importe o total dictado por el humano")

class HumanChapter(BaseModel):
    name: str = Field(description="Nombre completo del capítulo, ej: 'Capítulo nº 1 ACTUACIONES PREVIAS'")
    items: List[HumanItem] = Field(description="Lista de partidas contenidas en este capítulo en esta página")

class HumanBudgetBaseline(BaseModel):
    chapters: List[HumanChapter] = Field(default_factory=list, description="Capítulos encontrados en la página de la imagen")


async def main():
    pdf_path = Path(r"c:\Users\Usuario\Documents\github\works\nexoai\data_extraction_lab\docs-to-analisys\MU02-aparejador-humano.pdf")
    output_json = Path(r"c:\Users\Usuario\Documents\github\works\nexoai\data_extraction_lab\mu02_human_baseline.json")
    
    if not pdf_path.exists():
        logger.error(f"Falta el PDF: {pdf_path}")
        return

    logger.info("Abriendo PDF (PyMuPDF)...")
    doc = fitz.open(pdf_path)
    
    ai_adapter = GoogleGenerativeAIAdapter(model_name="gemini-2.5-flash")
    
    system_prompt = (
        "Eres un notario auditor matemático super-preciso. Tu trabajo es leer imágenes de un presupuesto "
        "en PDF y extraer TABULARMENTE la información que ves exactamente tal cual. NO INVENTES NADA. "
        "NO REDONDEES PRECIOS. NO SUPONGAS unidades. Solo transcribe a la estructura JSON lo que logras "
        "leer con tus ojos. Es vital que preserves el `unit_price`, la `quantity` y el `total_price` "
        "como floats puros."
    )
    
    user_prompt = "Fotografía de página de Presupuesto Original. Extrae sus capítulos y partidas a JSON."
    
    all_chapters_data = {}
    sem = asyncio.Semaphore(5)  # Max 5 concurrent requests to Gemini to stay under RPM limits

    async def process_page(i):
        logger.info(f"Procesando Página {i+1} / {len(doc)} con Gemini Vision...")
        page = doc.load_page(i)
        zoom = 2.0  # High DPI
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        
        # Convert to Base64
        import io
        from PIL import Image
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        buffered = io.BytesIO()
        img.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
        
        async with sem:
            try:
                page_data, _ = await ai_adapter.generate_structured(
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    response_schema=HumanBudgetBaseline,
                    image_base64=img_str,
                    temperature=0.0
                )
                return i, page_data
            except Exception as e:
                logger.error(f"Fallo al invocar a Vision en página {i+1}: {e}")
                return i, None

    # Run concurrently
    tasks = [process_page(i) for i in range(len(doc))]
    results = await asyncio.gather(*tasks)
    
    # Sort results by page index to keep chapter order intact
    results.sort(key=lambda x: x[0])
    
    for i, page_data in results:
        if not page_data:
            continue
        for chap in page_data.chapters:
            if chap.name not in all_chapters_data:
                all_chapters_data[chap.name] = []
            all_chapters_data[chap.name].extend(chap.items)

    # Build final robust JSON structure
    final_output = {
        "metadata": {
            "source": pdf_path.name,
            "type": "gold_standard_baseline",
            "total_pages": len(doc)
        },
        "chapters": [
            {
                "name": cname,
                "items": [item.model_dump() for item in items]
            }
            for cname, items in all_chapters_data.items()
        ]
    }
    
    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(final_output, f, indent=2, ensure_ascii=False)
        
    logger.info(f"✅ Gold Standard Generado Exitosamente: {output_json}")

if __name__ == "__main__":
    asyncio.run(main())

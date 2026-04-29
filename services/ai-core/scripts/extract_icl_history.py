import os
import re
import json
import logging
import asyncio
from pathlib import Path
from difflib import SequenceMatcher
from pydantic import BaseModel, Field
from typing import List

# Setup sys path
project_root = Path(__file__).resolve().parent.parent
import sys
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv
load_dotenv(project_root / ".env")

from src.budget.infrastructure.adapters.ai.gemini_adapter import GoogleGenerativeAIAdapter

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ICLDecision(BaseModel):
    original_description: str = Field(description="La partida original solicitada (Medición)")
    original_unit: str = Field(description="Unidad original (m2, ml, ud, PA, etc)")
    human_reasoning_deduced: str = Field(description="El razonamiento que crees que aplicó el humano para resolver esto")
    human_final_price: float = Field(description="El precio unitario final que decidió el humano")

class ICLPageResult(BaseModel):
    examples: List[ICLDecision] = Field(description="Lista de ejemplos dorados extraídos de la comparación")

def similarity(a, b):
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()

def get_golden_pairs(directory: Path) -> List[tuple]:
    pairs = []
    # Iterate through all clean project folders
    for project_folder in directory.iterdir():
        if not project_folder.is_dir():
            continue
            
        medicion_files = list(project_folder.glob("MEDICION_*.pdf"))
        
        if medicion_files:
            medicion_file = sorted(medicion_files, key=os.path.getsize, reverse=True)[0]
            
            # Find the Presupuesto: 1. Try PRESUPUESTO_*. 2. Try OTRO_*. 3. Try any other PDF not CERTIFICACION/FACTURA
            candidate_presupuestos = list(project_folder.glob("PRESUPUESTO_*.pdf"))
            if not candidate_presupuestos:
                candidate_presupuestos = list(project_folder.glob("OTRO_*.pdf"))
            if not candidate_presupuestos:
                candidate_presupuestos = [f for f in project_folder.glob("*.pdf") if f != medicion_file and "CERTIFICACION" not in f.name and "FACTURA" not in f.name]
                
            if candidate_presupuestos:
                presupuesto_file = sorted(candidate_presupuestos, key=os.path.getsize, reverse=True)[0]
                pairs.append((project_folder.name, medicion_file, presupuesto_file))
            
    return pairs

async def extract_golden_examples_from_pair(medicion_path: Path, presupuesto_path: Path, llm: GoogleGenerativeAIAdapter) -> List[dict]:
    import fitz # PyMuPDF
    
    logger.info(f"Procesando par: {medicion_path.name} VS {presupuesto_path.name}")
    
    # Open both 
    try:
        doc_med = fitz.open(medicion_path)
        doc_pre = fitz.open(presupuesto_path)
    except Exception as e:
        logger.error(f"Error abriendo PDF: {e}")
        return []
        
    examples = []
    
    # We just sample the first 2 pages to extract high-value heuristics without destroying our quota
    pages_to_sample = min(2, len(doc_med), len(doc_pre))
    
    for i in range(pages_to_sample):
        try:
            med_page = doc_med[i]
            pre_page = doc_pre[i]
            
            med_pix = med_page.get_pixmap(dpi=150)
            pre_pix = pre_page.get_pixmap(dpi=150)
            
            # TODO: Convert to base64 and feed to multimodal Gemini
            # For this script we will emulate the prompt logic that would be used
            # Since Gemini Vision supports multi-image, we could pass both.
            # However, for simplicity and token limits, a text-extraction compare is better.
            
            med_text = med_page.get_text("text")
            pre_text = pre_page.get_text("text")
            
            sys_prompt = (
                "Eres un Experto Forense de Presupuestos de Construcción.\n"
                "Te daré el texto de un 'Estado de Mediciones' y el texto del 'Presupuesto Final' (hecho por un humano).\n"
                "Encuentra partidas equivalentes y deduce la Heurística: ¿Cómo calculó el humano ese precio o a qué lo equiparó?\n"
                "Devuelve una matriz de decisión (Golden Examples)."
            )
            
            user_prompt = f"--- MEDICIÓN ORIGINAL ---\n{med_text[:2000]}\n\n--- PRESUPUESTO HUMANO ---\n{pre_text[:2000]}"
            
            res, _ = await llm.generate_structured(
                system_prompt=sys_prompt, 
                user_prompt=user_prompt, 
                response_schema=ICLPageResult,
                temperature=0.1
            )
            
            for ex in res.examples:
                examples.append(ex.model_dump())
        except Exception as e:
            logger.error(f"Error procesando pagina {i}: {e}")
            
    return examples

async def main():
    target_dir = Path(r"C:\Users\Usuario\Documents\consultorIA\basis\proyectos-estructurados")
    golden_pairs = get_golden_pairs(target_dir)
    
    logger.info(f"Encontrados {len(golden_pairs)} proyectos con Pares Dorados (Medición + Presupuesto Valorado).")
    
    llm = GoogleGenerativeAIAdapter(model_name="gemini-2.5-pro")
    
    all_golden_examples = []
    
    # Sample only the top 3 pairs to generate the first batch without destroying quota
    sampled_pairs = golden_pairs[:3]
    
    for project_name, medicion_file, presupuesto_file in sampled_pairs:
        logger.info(f"Procesando Proyecto: {project_name}")
        extracted = await extract_golden_examples_from_pair(medicion_file, presupuesto_file, llm)
        all_golden_examples.extend(extracted)
        
    output_path = project_root / "icl_golden_examples.json"
    
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(all_golden_examples, f, ensure_ascii=False, indent=2)
        
    logger.info(f"¡Extracción completada! Se guardaron {len(all_golden_examples)} ejemplos dorados en {output_path}")

if __name__ == "__main__":
    asyncio.run(main())

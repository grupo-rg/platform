import os
import shutil
import asyncio
import logging
from pathlib import Path
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

class FileClassification(BaseModel):
    original_filename: str = Field(description="El nombre original del archivo exacto")
    project_name: str = Field(description="Nombre unificado y limpio del proyecto u obra (Ej. Hotel Marte, Lluis Marti, Aragon 181). Agrupa los similares.")
    document_type: str = Field(description="Clasificación estricta. Valores permitidos: MEDICION, PRESUPUESTO, CERTIFICACION, FACTURA, PLANO, ALBARAN, OTRO")
    confidence: int = Field(description="Nivel de confianza de 0 a 100")

class BatchClassificationResult(BaseModel):
    classifications: List[FileClassification]

async def process_batch(filenames: List[str], llm) -> List[FileClassification]:
    sys_prompt = (
        "Eres un clasificador inteligente de documentos de un Aparejador experto en ESPAÑA.\n"
        "Se te pasará una lista de nombres de archivo."
        "Tu tarea es normalizar el 'project_name' (identificando la misma obra independientemente de ligeras variaciones en el nombre) "
        "y determinar el 'document_type' estricto en base al nombre completo.\n"
        "Reglas para document_type:\n"
        "- MEDICION: Si solo contiene mediciones iniciales, planos ciegos o 'estado de mediciones'. (Frecuentemente el archivo se llama MEDICIONES o MED o PLANOS CIEGOS).\n"
        "- PRESUPUESTO: Si el nombre sugiere precios, estimación, respuesta, 'ppto', 'presupuesto', valorado.\n"
        "- CERTIFICACION: Si contiene 'cert', 'certif', 'liquidacion'.\n"
        "- FACTURA: Si contiene 'fact', 'factura', 'fra'.\n"
        "- PLANO: Si tiene '.dwg' o contiene 'plano', 'esquema', 'estado actual', 'distribucion'.\n"
        "- ALBARAN/OTRO: Si no estás seguro."
    )
    
    file_list_str = "\n".join(f"- {name}" for name in filenames)
    user_prompt = f"Lista de archivos a clasificar:\n{file_list_str}"
    
    try:
        res, _ = await llm.generate_structured(
            system_prompt=sys_prompt,
            user_prompt=user_prompt,
            response_schema=BatchClassificationResult,
            temperature=0.1
        )
        return res.classifications
    except Exception as e:
        logger.error(f"Error clasificando lote: {e}")
        return []

async def main():
    source_dir = Path(r"C:\Users\Usuario\Documents\consultorIA\basis\presupuestos-a-organizar")
    target_dir = Path(r"C:\Users\Usuario\Documents\consultorIA\basis\proyectos-estructurados")
    
    if not source_dir.exists():
        logger.error(f"No se encontró el directorio origen: {source_dir}")
        return
        
    target_dir.mkdir(parents=True, exist_ok=True)
    
    all_files = [f for f in source_dir.iterdir() if f.is_file()]
    file_names = [f.name for f in all_files]
    
    logger.info(f"Encontrados {len(file_names)} archivos para organizar.")
    
    llm = GoogleGenerativeAIAdapter(model_name="gemini-2.5-flash") # Flash es suficientemente rápido y barato para nombres de archivos
    
    BATCH_SIZE = 40
    all_classifications = []
    
    for i in range(0, len(file_names), BATCH_SIZE):
        batch = file_names[i:i+BATCH_SIZE]
        logger.info(f"Procesando lote {i//BATCH_SIZE + 1}...")
        results = await process_batch(batch, llm)
        all_classifications.extend(results)
        
    # Organizar físicamente en disco (COPIAR para no destruir data original)
    logger.info("Iniciando copiado estructurado...")
    success_count = 0
    
    for c in all_classifications:
        # Create folder
        clean_project_name = "".join(x for x in c.project_name if x.isalnum() or x in " -_").strip()
        if not clean_project_name or clean_project_name.upper() in ["DESCONOCIDO", "VARIOS"]:
            clean_project_name = "Proyectos_Sin_Asignar"
            
        proj_folder = target_dir / clean_project_name
        proj_folder.mkdir(parents=True, exist_ok=True)
        
        # Source file
        source_file = source_dir / c.original_filename
        
        # New name: TIPO_NombreOriginal
        # Mantenemos el nombre original pero le prefijamos el tipo para que sea evidente a primera vista
        new_name = f"{c.document_type.upper()}_{c.original_filename}"
        target_file = proj_folder / new_name
        
        if source_file.exists():
            try:
                # COPY not move, to be completely safe during data forensics
                shutil.copy2(source_file, target_file)
                success_count += 1
            except Exception as e:
                logger.error(f"Error copiando {source_file.name}: {e}")
                
    logger.info(f"¡Organización completada! {success_count} archivos estructurados en: {target_dir}")

if __name__ == "__main__":
    asyncio.run(main())

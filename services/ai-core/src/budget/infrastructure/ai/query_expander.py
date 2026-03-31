import logging
from typing import List, Optional
from pydantic import BaseModel, Field
from src.budget.application.ports.ports import ILLMProvider

logger = logging.getLogger(__name__)

class QueryExpansionResult(BaseModel):
    queries: List[str] = Field(
        description="Lista de 3 a 5 consultas semánticas expansivas para buscar en la base vectorial."
    )
    mapped_chapters: Optional[List[str]] = Field(
        default_factory=list,
        description="Array de 1 a 3 nombres estrictos de Capítulos de la Base de Datos donde esta partida tendría sentido lógicamente."
    )

class QueryExpander:
    """
    Agente Intermedio (Gemini 2.5 Flash) que intercepta la partida humana
    y genera un enjambre de 3 a 5 consultas semánticas divergentes.
    Sirve para evitar la ceguera del RAG tradicional.
    """
    def __init__(self, llm_provider: ILLMProvider):
        self.llm = llm_provider

    async def expand(self, description: str, unit: Optional[str] = None, original_chapter: Optional[str] = None) -> tuple[List[str], List[str]]:
        import json
        import os
        
        # Load the index dynamically from the project root
        current_dir = os.path.dirname(__file__)
        index_path = os.path.abspath(os.path.join(current_dir, "../../../../../../src/lib/pdf_index_2025.json"))
        try:
            with open(index_path, "r", encoding="utf-8") as f:
                index_data = json.load(f)
                
            chapters_context = []
            for chap in index_data:
                chap_name = chap["name"]
                subs = [sub["name"] for sub in chap.get("subchapters", [])]
                if subs:
                    chapters_context.append(f"- {chap_name} (Incluye: {', '.join(subs)})")
                else:
                    chapters_context.append(f"- {chap_name}")
                    
            valid_chapters_str = "\n".join(chapters_context)
            
        except Exception as e:
            logger.error(f"Failed to load pdf_index_2025.json: {e}")
            valid_chapters_str = ""

        system_prompt = (
            "Eres un Arquitecto Analista (Experto en NLP y Presupuestación).\n"
            "Tu tarea es doble:\n"
            "1. Analizar la descripción de una partida cruda (extraída de un PDF) y generar de 3 a 5 consultas clave (search queries) optimizadas para RAG Vectorial.\n"
            "   - Haz 'Query Expansion' lateral usando sinónimos técnicos (ej. 'Zahorra', 'Encachado', 'Picado a mano').\n"
            "   - REGLA CRÍTICA: Una de tus consultas DEBE SER 100% ATÓMICA, describiendo SÓLO el material o acción física base sin el contexto de la obra (Ej: si la partida es 'Relleno de grava para entrada de camiones', tu query atómica debe ser SÓLO 'Relleno con gravilla' o 'Capa de grava').\n"
            "   - Incluye siempre una consulta muy precisa y otra genérica (max 8 palabras por query).\n"
            "2. Clasificar la DESCIPCIÓN de la partida en nuestra Taxonomía Estricta.\n"
            "   - PRIO 1: Fíjate en el catálogo detallado que te proporcionamos abajo. Lee los subcapítulos entre paréntesis para deducir a qué Capítulo Principal pertenece la partida física.\n"
            "   - PRIO 2: Usa de contexto cómo se llamaba el capítulo en el PDF original (ej. 'Actuaciones previas').\n"
            "   - Debes devolver un array `mapped_chapters` con 1 a 5 CAPÍTULOS PRINCIPALES (solo el nombre principal, sin los paréntesis) donde lógicamente podría encajar esta obra.\n"
            "   - SOLO PUEDES ELEGIR el nombre exacto del CAPÍTULO PRINCIPAL de esta lista:\n"
            f"{valid_chapters_str}\n"
        )


        user_prompt = f"Partida a clasificar y expandir:\nDescripción: {description}\nUnidad original: {unit or 'N/A'}\nCapítulo PDF Original: {original_chapter or 'N/A'}\n"

        try:
            res, _ = await self.llm.generate_structured(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                response_schema=QueryExpansionResult,
                temperature=0.3 # Ligera variabilidad pero determinístico
            )
            if res:
                queries = res.queries if res.queries else [description]
                chapters = res.mapped_chapters if res.mapped_chapters else []
                return queries, chapters
            return [description], []
        except Exception as e:
            logger.error(f"Fallo en QueryExpander: {e}")
            return [description], []

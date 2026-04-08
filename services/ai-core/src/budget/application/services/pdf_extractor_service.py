from typing import List, Dict, Any, Optional
import logging
import asyncio
import json
import re
from pydantic import BaseModel, Field

from src.budget.application.ports.ports import ILLMProvider, IGenerationEmitter

logger = logging.getLogger(__name__)

# --- Chapter Stabilization Logic (Anti-Hallucination) ---
def extract_chapter_prefix(chapter_str: str) -> str:
    s = str(chapter_str).strip().upper()
    m = re.match(r'^([A-ZÁÉÍÓÚÑ]+[\s\-\.]?\d[\d\.]*)', s)
    if m:
        return re.sub(r'[\s\.\-]', '', m.group(1))
    m = re.match(r'^(\d[\d\.]*)', s)
    if m:
        return re.sub(r'\.', '', m.group(1))
    m = re.match(r'^([IVXLCDM]+)[\.\s]?', s)
    if m:
        return m.group(1)
    return s.split(' ')[0] if s else ''

def stabilize_chapter_name(new_ch: str, curr_ch: str) -> str:
    new_up = str(new_ch if new_ch else "").strip().upper()
    curr_up = str(curr_ch if curr_ch else "").strip().upper()
    
    if not new_up or new_up in ['CONTINUACIÓN_ANTERIOR', 'CONTINUACION_ANTERIOR', 'SIN CAPÍTULO', 'SIN CAPITULO', '']:
        return curr_ch
        
    hallucinations = ['[', 'NOT FOUND', 'NO ESPECIFICADO', 'NO IDENTIFICADO', 'NO ENCONTRADO', 'UNKNOWN', 'UNDEFINED', 'SIN NOMBRE']
    if any(p in new_up for p in hallucinations):
        return curr_ch
        
    if not curr_up or curr_up in ['SIN CAPÍTULO', 'SIN CAPITULO', '']:
        return new_ch.strip()
        
    new_prefix = extract_chapter_prefix(new_up)
    curr_prefix = extract_chapter_prefix(curr_up)
    
    if new_prefix and curr_prefix and new_prefix == curr_prefix:
        if len(new_ch.strip()) > len(curr_ch.strip()) + 3:
            return new_ch.strip()
        return curr_ch.strip()
        
    return new_ch.strip()

# --- Schemas Mapped during Extraction ---
class RestructuredItem(BaseModel):
    code: Optional[str] = Field(default="", description='El código original de la partida (ej. 2.2). Si no tiene, usa "".')
    description: str = Field(description='La descripción de la partida. Resume y unifica si está cortada en varias líneas.')
    quantity: float = Field(default=1.0, description='La cantidad total acumulada para esta partida.')
    unit: Optional[str] = Field(default="ud", description='La unidad de medida de la partida (ej. m2, m3, ud, ml).')
    chapter: Optional[str] = Field(default="Sin Capítulo", description='Nombre del capítulo al que pertenece.')

class RestructureChunkResult(BaseModel):
    items: List[RestructuredItem]
    has_more_items: bool = Field(default=False)
    last_extracted_code: str = Field(default="")

# --- Map-Reduce Annexed Specific Schemas ---
class DescriptionItem(BaseModel):
    code: str
    description: str
    unit: str
    chapter: str

class Phase1Result(BaseModel):
    items: List[DescriptionItem]
    has_more_items: bool = Field(default=False)
    cut_item_carryover: str = Field(default="")

class SummatoryItem(BaseModel):
    code: str
    total_quantity: float

class Phase2Result(BaseModel):
    items: List[SummatoryItem]

# --- Base Port ---
class IPdfExtractorService:
    def __init__(self, llm_provider: ILLMProvider, emitter: Optional[IGenerationEmitter] = None):
        self.llm = llm_provider
        self.emitter = emitter

    async def extract(self, raw_items: List[Dict[str, Any]], lead_id: str, metrics: Dict) -> List[RestructuredItem]:
        raise NotImplementedError

    def _track_telemetry(self, metrics_dict: Dict, usage: Dict[str, int]):
        metrics_dict["prompt"] += usage.get("promptTokenCount", 0)
        metrics_dict["completion"] += usage.get("candidatesTokenCount", 0)
        metrics_dict["total"] += usage.get("totalTokenCount", 0)
        
        cost_prompt = (usage.get("promptTokenCount", 0) / 1_000_000) * 0.071
        cost_comp = (usage.get("candidatesTokenCount", 0) / 1_000_000) * 0.28
        metrics_dict["cost"] += (cost_prompt + cost_comp)

    def _load_prompt(self, filename: str, **kwargs) -> tuple[str, str]:
        import os, re
        filepath = os.path.join(os.path.dirname(__file__), "../../../../prompts", filename)
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
            
        content = re.sub(r"^---.*?---\n", "", content, flags=re.DOTALL)
        parts = re.split(r'\{\{role "(system|user)"\}\}\n', content)
        
        sys_p, usr_p = "", ""
        curr_role = None
        for p in parts:
            if p in ('system', 'user'):
                curr_role = p
            elif curr_role == 'system':
                sys_p = p.strip()
            elif curr_role == 'user':
                usr_p = p.strip()
                
        for k, v in kwargs.items():
            usr_p = usr_p.replace(f"{{{{{k}}}}}", str(v))
            
        return sys_p, usr_p

    def _emit(self, budget_id: str, event_type: str, data: Dict[str, Any]):
        if self.emitter:
            self.emitter.emit_event(budget_id, event_type, data)

# --- Concrete: Inline (Standard) Extractor ---
class InlinePdfExtractorService(IPdfExtractorService):
    async def extract(self, raw_items: List[Dict[str, Any]], budget_id: str, metrics: Dict) -> List[RestructuredItem]:
        logger.info(f"Starting INLINE Restructure Phase for {len(raw_items)} raw items...")
        self._emit(budget_id, 'extraction_started', {"query": f"Lanzando Analista de Estructuras sobre la página..."})

        CHUNK_SIZE = 1
        chunks = [raw_items[i:i + CHUNK_SIZE] for i in range(0, len(raw_items), CHUNK_SIZE)]
        self._emit(budget_id, 'batch_restructure_submitted', {"query": f"Lote visual dividido en {len(chunks)} páginas atómicas concurrenciales."})
        
        semaphore = asyncio.Semaphore(15) 
        
        async def process_restructure_chunk(chunk_idx: int, raw_chunk: List[Dict]):
            async with semaphore:
                page_data = raw_chunk[0]
                b64_img = page_data.get("image_base64")
                
                all_items_for_page = []
                last_code = ""
                iteration = 1
                max_iterations = 4
                
                accumulated_usage = {"promptTokenCount": 0, "candidatesTokenCount": 0, "totalTokenCount": 0}
                
                while iteration <= max_iterations:
                    start_instruction = ""
                    if last_code:
                        start_instruction = f"INSTRUCCIÓN CRÍTICA: Ya extrajiste correctamente hasta la partida {last_code}. IGNORA todo lo anterior a ella. INICIA tu extracción estrictamente desde la partida SIGUIENTE a {last_code} hasta el final físico de la página."
                        
                    sys_prompt, user_prompt = self._load_prompt(
                        "restructure_image_vision.prompt", 
                        image_base64_data="[IMAGEN RAW ENVIADA EN INLINEDATA]",
                        start_instruction=start_instruction
                    )
                    
                    self._emit(budget_id, 'restructuring', {"query": f"Extracción Multimodal Página {chunk_idx + 1}/{len(chunks)} (Iteración {iteration}/{max_iterations})..."})
                    
                    partial_res, usage = await self.llm.generate_structured(
                        system_prompt=sys_prompt,
                        user_prompt=user_prompt,
                        response_schema=RestructureChunkResult,
                        temperature=0.0,
                        image_base64=b64_img
                    )
                    
                    if usage:
                        for k in accumulated_usage:
                            accumulated_usage[k] += usage.get(k, 0)
                    
                    if partial_res and partial_res.items:
                        all_items_for_page.extend(partial_res.items)
                        
                        if partial_res.has_more_items and partial_res.last_extracted_code:
                            last_code = partial_res.last_extracted_code
                            iteration += 1
                        else:
                            break
                    else:
                        break
                
                merged_res = RestructureChunkResult(items=all_items_for_page, has_more_items=False, last_extracted_code="")
                self._emit(budget_id, 'restructuring', {"query": f"Página {chunk_idx + 1}/{len(chunks)} consolidada (Total partidas: {len(all_items_for_page)})."})
                return merged_res, accumulated_usage
                
        tasks = [process_restructure_chunk(idx, chunk) for idx, chunk in enumerate(chunks)]
        results_group = await asyncio.gather(*tasks, return_exceptions=True)
        
        consolidated = []
        for i, res in enumerate(results_group):
            if isinstance(res, Exception):
                logger.error(f"Error procesando página visual {i}: {res}")
            elif isinstance(res, tuple):
                parsed, usage = res
                consolidated.extend(parsed.items)
                self._track_telemetry(metrics, usage)
                
        final_items = []
        current_chapter = "Sin Capítulo"
        for item in consolidated:
            current_chapter = stabilize_chapter_name(item.chapter, current_chapter)
            item.chapter = current_chapter
            final_items.append(item)
        
        # Filtro Anti-Fantasmas
        valid_items = [item for item in final_items if item.code and str(item.code).strip() != ""]
        total_valid = len(valid_items)
        
        self._emit(budget_id, 'subtasks_extracted', {"count": total_valid, "totalTasks": total_valid})
        self._emit(budget_id, 'batch_restructure_submitted', {"query": f"Extracción Finalizada. Consolidando {total_valid} partidas..."})
        return valid_items

# --- Concrete: Annexed (MapReduce) Extractor ---
class AnnexedPdfExtractorService(IPdfExtractorService):
    async def extract(self, pages_chunks: List[Dict[str, Any]], budget_id: str, metrics: Dict) -> List[RestructuredItem]:
        logger.info(f"Starting ANNEXED (MapReduce) Batch Restructure Phase for {len(pages_chunks)} pages...")
        self._emit(budget_id, 'extraction_started', {"query": f"Desplegando Analista Documental sobre documento multipágina ({len(pages_chunks)} páginas)..."})
        
        # En producción "real", el Endpoint separa los `raw_items` en descriptivos y contables.
        # Asumimos que los primeros N-1 son literatura y la página `raw_items[-1]` es mediciones.
        # Aquí puedes iterar o usar una heurística. Como POC robusto:
        
        if len(pages_chunks) < 2:
            # Fallback a inline si no hay modo de hacer mapreduce
            inline_svc = InlinePdfExtractorService(self.llm, self.emitter)
            return await inline_svc.extract(pages_chunks, budget_id, metrics)
            
        desc_pages = [p for p in pages_chunks if not p.get("is_summatory", False)]
        summ_pages = [p for p in pages_chunks if p.get("is_summatory", False)]
        
        # Fallback heurístico si no vienen taggeadas: MITAD Y MITAD (Solo para safety, idealmente vienen de UI)
        if not desc_pages or not summ_pages:
            mid = len(pages_chunks) // 2
            desc_pages = pages_chunks[:mid]
            summ_pages = pages_chunks[mid:]
        
        semaphore = asyncio.Semaphore(15) 
        
        # --- Fase Map: Descripciones ---
        async def process_desc_page(chunk_idx: int, page_data: Dict):
            async with semaphore:
                b64_img = page_data.get("image_base64")
                sys_prompt, user_prompt = self._load_prompt("vision_annexed_descriptions.prompt", image_base64_data="[IMAGE_B64]")
                self._emit(budget_id, 'restructuring', {"query": f"Mapeando Literatura de Obra (Página {chunk_idx+1}/{len(desc_pages)})..."})
                res, usage = await self.llm.generate_structured(
                    system_prompt=sys_prompt, user_prompt=user_prompt,
                    response_schema=Phase1Result, temperature=0.0, image_base64=b64_img
                )
                if usage: self._track_telemetry(metrics, usage)
                return res.items if res else []

        desc_tasks = [process_desc_page(idx, p) for idx, p in enumerate(desc_pages)]
        desc_results = await asyncio.gather(*desc_tasks)
        
        all_descriptions = []
        for r in desc_results:
            if isinstance(r, list): all_descriptions.extend(r)
            
        # --- Fase Map: Sumatorias ---
        async def process_summ_page(chunk_idx: int, page_data: Dict):
            async with semaphore:
                b64_img = page_data.get("image_base64")
                sys_prompt, user_prompt = self._load_prompt("vision_annexed_summatory.prompt", image_base64_data="[IMAGE_B64]")
                self._emit(budget_id, 'restructuring', {"query": f"Auditando Mediciones Contables en Anexos (Página {chunk_idx+1}/{len(summ_pages)})..."})
                res, usage = await self.llm.generate_structured(
                    system_prompt=sys_prompt, user_prompt=user_prompt,
                    response_schema=Phase2Result, temperature=0.0, image_base64=b64_img
                )
                if usage: self._track_telemetry(metrics, usage)
                return res.items if res else []

        summ_tasks = [process_summ_page(idx, p) for idx, p in enumerate(summ_pages)]
        summ_results = await asyncio.gather(*summ_tasks)
        
        all_summatories = []
        for r in summ_results:
            if isinstance(r, list): all_summatories.extend(r)
            
        # --- Fase Reduce (El Diccionario) ---
        self._emit(budget_id, 'restructuring', {"query": f"Cruzando {len(all_descriptions)} descripciones con {len(all_summatories)} mediciones de obra..."})
        
        def normalize_code(code_str: str) -> str:
            return re.sub(r'[^0-9]', '', str(code_str))
            
        sum_dict = {normalize_code(i.code): i.total_quantity for i in all_summatories}
        
        final_items: List[RestructuredItem] = []
        current_chapter = "Sin Capítulo"
        
        for d in all_descriptions:
            norm_code = normalize_code(d.code)
            qty = sum_dict.get(norm_code, 0.0)
            
            current_chapter = stabilize_chapter_name(d.chapter, current_chapter)
            ch_final = current_chapter
            
            final_items.append(RestructuredItem(
                code=d.code,
                description=d.description,
                unit=d.unit,
                quantity=qty,
                chapter=ch_final
            ))
            
        valid_items = [i for i in final_items if i.code and str(i.code).strip() != ""]
        self._emit(budget_id, 'subtasks_extracted', {"count": len(valid_items), "totalTasks": len(valid_items)})
        return valid_items

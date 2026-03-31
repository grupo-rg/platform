import logging
import asyncio
import json
import uuid
import inspect
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

from src.budget.application.ports.ports import ILLMProvider, IVectorSearch, IGenerationEmitter
from src.budget.application.services.pdf_extractor_service import RestructuredItem
from src.budget.domain.entities import BudgetPartida, AIResolution, OriginalItem, BudgetBreakdownComponent

# -------------------------------------------------------------------------------------------------
# SCHEMAS DE ENJAMBRE (SWARM)
# -------------------------------------------------------------------------------------------------
class DeconstructResult(BaseModel):
    is_complex: bool
    queries: List[str]

class BreakdownComponentSchema(BaseModel):
    code: str = Field(description="Código del catálogo elegido")
    concept: str = Field(description="Nombre/título de esta sub-partida o material")
    type: str = Field(default="OTHER")
    price: float = Field(description="Precio unitario de esta subpartida")
    yield_val: float = Field(alias="yield", default=1.0)
    total: float
    alternativeComponents: List[str] = Field(default_factory=list)

class PricingFinalResultDB(BaseModel):
    pensamiento_calculista: str = Field(description="Razonamiento matemático")
    calculated_total_price: float = Field(description="La suma exacta de los componentes y conversiones al m2")
    breakdown: Optional[List[BreakdownComponentSchema]] = Field(default=None) # Si es simple, null.
    selected_candidate: Optional[str] = Field(default=None) # Para las 1:1
    needs_human_review: bool

class BatchPricedItemV3(BaseModel):
    item_code: str
    valuation: PricingFinalResultDB

class BatchPricingEvaluatorResultV3(BaseModel):
    results: List[BatchPricedItemV3]

logger = logging.getLogger(__name__)

class SwarmPricingService:
    def __init__(self, llm_provider: ILLMProvider, vector_search: IVectorSearch, emitter: Optional[IGenerationEmitter] = None):
        self.llm = llm_provider
        self.vector_search = vector_search
        self.emitter = emitter

    def _emit(self, lead_id: str, event_type: str, data: Dict[str, Any]):
        if self.emitter:
            self.emitter.emit_event(lead_id, event_type, data)

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
            if p in ('system', 'user'): curr_role = p
            elif curr_role == 'system': sys_p = p.strip()
            elif curr_role == 'user': usr_p = p.strip()
        for k, v in kwargs.items():
            usr_p = usr_p.replace(f"{{{{{k}}}}}", str(v))
        return sys_p, usr_p

    # --- 1. Deconstructor FLASH ---
    async def _analyze_and_deconstruct(self, item: RestructuredItem, metrics: Dict) -> List[str]:
        sys_instruction = "Eres un Quantity Surveyor. Extrae los oficios ATÓMICOS de esta partida bruta para buscar en BBDD."
        res, usage = await self.llm.generate_structured(
            system_prompt=sys_instruction,
            user_prompt=f"Partida: {item.description} (U: {item.unit})",
            response_schema=DeconstructResult,
            temperature=0.0,
            model="gemini-2.5-flash"
        )
        if usage: self._track_telemetry(metrics, usage)
        if res and res.queries:
            # Fallback if too simple
            if not res.is_complex and len(res.queries) == 1:
                return [f"{item.description} {item.unit}"]
            return res.queries
        return [f"{item.description} {item.unit}"]

    # --- 2. Enjambre Vectorial DB ---
    async def _firestore_vector_swarm(self, queries: List[str]) -> List[Dict]:
        if not queries: return []
        # Multi-Embedding in one shot
        import google.genai.types as types
        # Asumiendo que el proxy genérico de self.llm soporta batch embeddings, 
        # Si no, iteramos. Por ahora, usando la interfaz base:
        
        all_candidates = []
        seen_ids = set()
        
        for q in queries:
            try:
                vector = await self.llm.get_embedding(q)
                res = self.vector_search.search_similar_items(query_vector=vector, query_text=q, limit=4)
                candidates = await res if inspect.isawaitable(res) else res
                
                for c in candidates:
                    cid = c.get('id')
                    if cid and cid not in seen_ids:
                        seen_ids.add(cid)
                        c["__query_origin"] = q
                        all_candidates.append(c)
            except Exception as e:
                logger.error(f"Vector search failed for '{q}': {e}")
                
        # Limitar para no saturar contextos enormes
        all_candidates.sort(key=lambda x: x.get('matchScore', 0), reverse=True)
        return all_candidates[:15]

    # --- 3. Ejecución Orquestada de Pricing (Public Method) ---
    async def evaluate_batch(self, items: List[RestructuredItem], lead_id: str, metrics: Dict) -> List[BudgetPartida]:
        logger.info(f"Starting Swarm Pricing Phase for {len(items)} items...")
        self._emit(lead_id, 'vector_search_started', {"query": f"Invocando al cerebro Flash para romper {len(items)} partidas en queries atómicas..."})
        
        # Obtenemos candidatos masivos
        async def fetch_item_candidates(item: RestructuredItem):
            queries = await self._analyze_and_deconstruct(item, metrics)
            candidates = await self._firestore_vector_swarm(queries)
            return item, candidates
            
        vector_tasks = [fetch_item_candidates(i) for i in items]
        vector_results = await asyncio.gather(*vector_tasks, return_exceptions=True)
        
        # Montar el RAG Prompt final para cada bloque
        candidates_map = {}
        batch_tasks = []
        
        for res in vector_results:
            if isinstance(res, Exception):
                logger.error(f"Enjambre Vectorial Crashed: {res}")
            else:
                item, candidates = res
                candidates_map[item.code] = {"item": item, "candidates": candidates}
                
                clean_cands = [{"id": c['id'], "desc": c['description'], "price": c.get('priceTotal'), "unit": c.get('unit'), "origen_swam": c.get("__query_origin")} for c in candidates]
                
                prompt_block = (
                    f"--- PARTIDA CÓDIGO: {item.code} ---\n"
                    f"Descripción: {item.description}\n"
                    f"Unidad: {item.unit} | Cantidad: {item.quantity}\n"
                    f"CANDIDATOS ENJAMBRE: {json.dumps(clean_cands, ensure_ascii=False)}"
                )
                batch_tasks.append({"id": item.code, "prompt": prompt_block})
                
        # Pro Evaluating
        self._emit(lead_id, 'batch_pricing_submitted', {"query": f"Generados {len(batch_tasks)} Enjambres de Mercado. Evaluando costes exactos con Gemini Pro..."})
        
        CHUNK_SIZE = 3
        grouped_tasks = [batch_tasks[i:i + CHUNK_SIZE] for i in range(0, len(batch_tasks), CHUNK_SIZE)]
        semaphore_pricing = asyncio.Semaphore(4)
        
        async def evaluate_chunk(chunk_idx: int, task_group: List[Dict]):
            async with semaphore_pricing:
                grouped_tasks_str = "\n\n".join(t["prompt"] for t in task_group)
                sys_prompt, user_prompt = self._load_prompt("pricing_evaluator.prompt", batch_items=grouped_tasks_str, golden_examples="No Heuristics Configured Yet.")
                
                # Respetando cuota
                await asyncio.sleep(1.0)
                eval_res, usage = await self.llm.generate_structured(
                    system_prompt=sys_prompt,
                    user_prompt=user_prompt,
                    response_schema=BatchPricingEvaluatorResultV3,
                    temperature=0.0,
                    model="gemini-2.5-pro"
                )
                self._emit(lead_id, 'vector_search', {"query": f"Evaluación Matemática Grupo {chunk_idx + 1}/{len(grouped_tasks)} terminada."})
                return eval_res, usage

        eval_tasks = [evaluate_chunk(idx, g) for idx, g in enumerate(grouped_tasks)]
        results_group = await asyncio.gather(*eval_tasks, return_exceptions=True)
        
        # Ensamblaje final de Pydantic Entities
        priced_partidas = []
        global_order = 1
        
        for chunk_idx, res in enumerate(results_group):
            if isinstance(res, Exception):
                logger.error(f"Error parseo pro {chunk_idx}: {res}")
                continue
                
            eval_res, usage = res
            self._track_telemetry(metrics, usage)
            
            for evaluated in eval_res.results:
                code = evaluated.item_code
                meta = candidates_map.get(code)
                if not meta: continue
                
                item = meta["item"]
                candidates = meta["candidates"]
                val = evaluated.valuation
                
                final_price = val.calculated_total_price
                reasoning_full = val.pensamiento_calculista
                needs_human_review = val.needs_human_review
                confidence = 40 if needs_human_review else 95
                
                # Parsear Breakdowns si existen
                breakdown_domain = []
                sel_id_flat = val.selected_candidate
                
                if val.breakdown and len(val.breakdown) > 0:
                    for b in val.breakdown:
                        alt_objs = [{"code": alt, "concept": "Similar Rechazado", "price": 0.0} for alt in b.alternativeComponents]
                        breakdown_domain.append(BudgetBreakdownComponent(
                            code=b.code,
                            concept=b.concept,
                            type="OTHER",
                            price=b.price,
                            yield_amount=b.yield_val,
                            total=b.total,
                            isSubstituted=False,
                            alternativeComponents=alt_objs
                        ))
                
                original_item_obj = OriginalItem(
                    code=item.code, description=item.description, quantity=item.quantity,
                    unit=item.unit, chapter=item.chapter, raw_table_data="Basis Swarm AI Extracted"
                )
                
                selected_cand_data = next((c for c in candidates if c.get('id') == sel_id_flat), None)
                ai_res_obj = AIResolution(
                    selected_candidate=selected_cand_data,
                    reasoning_trace=reasoning_full,
                    calculated_unit_price=final_price,
                    calculated_total_price=final_price * item.quantity,
                    confidence_score=confidence,
                    is_estimated=needs_human_review,
                    needs_human_review=needs_human_review
                )
                
                # Flat alternatives (for 1:1)
                alternatives = [c for c in candidates if c.get('id') != sel_id_flat]
                
                partida = BudgetPartida(
                    id=str(uuid.uuid4()), order=global_order,
                    original_item=original_item_obj,
                    ai_resolution=ai_res_obj,
                    alternatives=alternatives,
                    code=item.code, description=item.description,
                    unit=item.unit, quantity=item.quantity, unitPrice=final_price,
                    totalPrice=final_price * item.quantity,
                    isRealCost=not needs_human_review,
                    matchConfidence=confidence,
                    reasoning=reasoning_full,
                    breakdown=breakdown_domain if breakdown_domain else None
                )
                priced_partidas.append(partida)
                
                self._emit(lead_id, 'item_resolved', {"type": "PARTIDA", "item": partida.model_dump()})
                global_order += 1
                
        self._emit(lead_id, 'batch_pricing_completed', {"query": "Swarm finalizado. Ensamblando Presupuesto Real..."})
        return priced_partidas

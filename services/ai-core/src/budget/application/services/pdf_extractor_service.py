from typing import List, Dict, Any, Optional
import logging
import asyncio
import json
import re
from pydantic import BaseModel, Field

from src.budget.application.ports.ports import ILLMProvider, IGenerationEmitter
from src.budget.catalog.domain.unit import Unit

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

def consolidate_chapters(items: "List[RestructuredItem]") -> None:
    """Bloquea por CÓDIGO de capítulo el nombre canonical, across todos los items.

    Root cause que arregla: `stabilize_chapter_name` es sin estado — si en el
    orden de extracción aparece C02.01 ("C02 ALBAÑILERIA"), luego C01.01
    ("C01 TRABAJOS PREVIOS"), luego C02.02 ("C02 TABIQUES Y PARTICIONES"), el
    último transiciona `C01 → C02 TABIQUES` y pierde la memoria de "ALBAÑILERIA".
    Resultado: dos chapters C02 coexistiendo.

    Política:
    - Primer nombre COMPLETO visto para un prefijo gana (FIFO).
    - Un "C03" solo-código se reemplaza cuando aparece "C03 AISLAMIENTOS".
    - Items sin prefijo detectable se dejan intactos.

    Mutación in-place (consistente con el resto del pipeline).
    """
    canonical: dict[str, str] = {}

    # Primera pasada: registrar el mejor candidato por prefijo.
    for item in items:
        raw = (item.chapter or "").strip()
        if not raw:
            continue
        prefix = extract_chapter_prefix(raw.upper())
        if not prefix:
            continue
        # Considera "mejor" al nombre con letras tras el prefijo; si el actual
        # canonical es solo el código y ahora vemos uno con nombre, upgradea.
        has_name = len(raw) > len(prefix) + 2  # tolera espacios/tabuladores
        if prefix not in canonical:
            canonical[prefix] = raw
        else:
            existing = canonical[prefix]
            existing_has_name = len(existing) > len(prefix) + 2
            if not existing_has_name and has_name:
                canonical[prefix] = raw

    # Segunda pasada: aplicar el canonical.
    for item in items:
        raw = (item.chapter or "").strip()
        if not raw:
            continue
        prefix = extract_chapter_prefix(raw.upper())
        if prefix and prefix in canonical:
            item.chapter = canonical[prefix]


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
    # v005: campos de normalización + hints de conversión, opcionales hacia atrás.
    # Los rellena el extractor aguas arriba; el Swarm los lee para habilitar
    # matching 1:N con conversiones físicas.
    unit_normalized: Optional[str] = Field(
        default=None,
        description='Unidad canonical ("ud", "m2", "m3", ...) tras Unit.normalize().',
    )
    unit_dimension: Optional[str] = Field(
        default=None,
        description='Dimensión física ("superficie", "volumen", "tiempo", ...).',
    )
    unit_conversion_hints: Optional[Dict[str, float]] = Field(
        default=None,
        description='Puentes de conversión detectados en la descripción (ej. {"thickness_m": 0.10}).',
    )

class RestructureChunkResult(BaseModel):
    items: List[RestructuredItem]
    has_more_items: bool = Field(default=False)
    last_extracted_code: str = Field(default="")
    # --- Cross-page continuity fields (contingencia para partidas divididas entre páginas) ---
    # Rellenados por el LLM cuando detecta fragmentos que atraviesan límites físicos de página.
    # El extractor los usa en una pasada post-fan-out para reconstruir descripciones literales.
    orphan_tail_text: str = Field(
        default="",
        description="Texto sin código al INICIO de esta página que parece ser continuación de la "
                    "descripción de la última partida de la página anterior. Se fusiona con ella "
                    "si la anterior marcó `last_item_truncated: true`."
    )
    last_item_truncated: bool = Field(
        default=False,
        description="True si la última partida de esta página tiene una descripción que claramente "
                    "continúa en la siguiente (línea cortada, viñeta abierta, 'Incluye:' sin valor)."
    )


class MinimalItem(BaseModel):
    """Esquema de fallback cuando Gemini trunca respuestas del esquema completo.
    Mantiene solo lo imprescindible para no perder la página entera."""
    code: Optional[str] = Field(default="")
    description: str
    quantity: float = Field(default=1.0)


class RestructureChunkResultMinimal(BaseModel):
    items: List[MinimalItem]

# --- Map-Reduce Annexed Specific Schemas ---
class DescriptionItem(BaseModel):
    code: str
    description: str
    unit: str
    chapter: str
    # Fase 5.D — mismos hints que `RestructuredItem.unit_conversion_hints`, emitidos
    # directamente por el LLM anexado cuando detecta un puente físico (espesor,
    # densidad, tamaño unitario) en el texto de la descripción.
    unit_conversion_hints: Optional[Dict[str, float]] = Field(
        default=None,
        description='Puentes de conversión detectados en la descripción (ej. {"thickness_m": 0.10}).',
    )

class Phase1Result(BaseModel):
    items: List[DescriptionItem]
    # Fase 7.A — campos para cross-page merge (mismo patrón que INLINE).
    # Cuando una partida queda físicamente truncada al final de la página N,
    # `last_item_truncated=True` avisa al orquestador; el `orphan_tail_text` de la
    # página N+1 (texto huérfano sin código al inicio) se concatena a la descripción
    # de la última partida de N.
    orphan_tail_text: str = Field(default="")
    last_item_truncated: bool = Field(default=False)
    # Deprecated (pre-7.A): `has_more_items` y `cut_item_carryover` se conservan
    # solo por retrocompatibilidad de deserialización. El reduce nunca los leyó,
    # eran dead code. No usar en código nuevo — usar `last_item_truncated` y
    # `orphan_tail_text` respectivamente.
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
    async def extract(
        self,
        raw_items: List[Dict[str, Any]],
        budget_id: str,
        metrics: Dict,
        pdf_bytes: Optional[bytes] = None,
    ) -> List[RestructuredItem]:
        logger.info(f"Starting INLINE Restructure Phase for {len(raw_items)} raw items...")
        self._emit(budget_id, 'extraction_started', {"query": f"Lanzando Analista de Estructuras sobre la página..."})

        # Fase 9.2 — Fast path heurístico. Si recibimos los bytes del PDF,
        # extraemos texto por página y delegamos al LayoutAnalyzer. Si los
        # umbrales se cumplen, devolvemos `RestructuredItem` directamente sin
        # tocar el LLM. Es ~50× más rápido para PDFs con texto extraíble.
        if pdf_bytes:
            try:
                import pdfplumber  # local import para no penalizar arranque
                from io import BytesIO
                from src.budget.layout_analyzer.analyzer import try_heuristic_extraction
                with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
                    text_per_page = [p.extract_text() or "" for p in pdf.pages]
                heuristic_items = try_heuristic_extraction(text_per_page)
                if heuristic_items is not None:
                    logger.info(
                        f"INLINE fast path: {len(heuristic_items)} partidas "
                        f"extraídas via heurística sin LLM."
                    )
                    self._emit(budget_id, 'inline_fast_path_used', {
                        "partidas_count": len(heuristic_items),
                        "method": "layout_analyzer_heuristic",
                    })
                    self._emit(budget_id, 'subtasks_extracted', {
                        "count": len(heuristic_items),
                        "totalTasks": len(heuristic_items),
                    })
                    return heuristic_items
                logger.info("INLINE fast path NO aplicable; cayendo al flujo LLM.")
            except Exception as e:
                logger.warning(
                    f"INLINE fast path falló silenciosamente ({type(e).__name__}: {e}); "
                    f"fallback al flujo LLM."
                )

        CHUNK_SIZE = 1
        chunks = [raw_items[i:i + CHUNK_SIZE] for i in range(0, len(raw_items), CHUNK_SIZE)]
        self._emit(budget_id, 'batch_restructure_submitted', {"query": f"Lote visual dividido en {len(chunks)} páginas atómicas concurrenciales."})

        # 8 páginas paralelas (antes 15): reduce saturación del quota Gemini cuando
        # varias páginas densas fallan simultáneamente; en PDFs limpios el cuello de
        # botella sigue siendo el LLM por página, no la concurrencia.
        semaphore = asyncio.Semaphore(8)
        
        async def process_restructure_chunk(chunk_idx: int, raw_chunk: List[Dict]):
            async with semaphore:
                page_data = raw_chunk[0]
                b64_img = page_data.get("image_base64")

                all_items_for_page = []
                last_code = ""
                iteration = 1
                max_iterations = 4

                accumulated_usage = {"promptTokenCount": 0, "candidatesTokenCount": 0, "totalTokenCount": 0}

                # Flags de continuidad cross-page. `orphan_tail_text` se toma de la PRIMERA
                # iteración (cuando estamos leyendo el inicio físico de la página). `last_item_truncated`
                # se toma de la ÚLTIMA iteración (la que llegó al final de la página).
                page_orphan_tail = ""
                page_last_item_truncated = False
                
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

                    # Intento principal con schema completo.
                    # - temperature=0.15: rompe el determinismo del truncamiento en retries.
                    # - max_output_tokens=16384: doble del default, reduce probabilidad de cortar.
                    # Si el adapter detecta JSON truncado, hace salvage internamente y devuelve
                    # `usage['_salvaged'] = True` + `_items_recovered`.
                    partial_res = None
                    usage = None
                    try:
                        partial_res, usage = await self.llm.generate_structured(
                            system_prompt=sys_prompt,
                            user_prompt=user_prompt,
                            response_schema=RestructureChunkResult,
                            temperature=0.15,
                            image_base64=b64_img,
                            max_output_tokens=16384,
                        )
                        # Si el adapter rescató un JSON truncado, lo señalamos en la telemetría
                        # para que el panel admin y el UI muestren el parcial como "rescatado".
                        if usage and usage.get("_salvaged"):
                            self._emit(budget_id, 'extraction_partial_success', {
                                "page": chunk_idx + 1,
                                "items_recovered": usage.get("_items_recovered", len(partial_res.items) if partial_res else 0),
                            })
                    except Exception as primary_err:
                        # Schema completo agotó reintentos (típicamente JSON truncado en páginas
                        # densas). Caemos a un schema minimal para rescatar al menos code/desc/qty.
                        logger.warning(f"[extractor] Página {chunk_idx + 1}: schema completo falló ({primary_err}); reintento con schema minimal.")
                        self._emit(budget_id, 'extraction_retry_minimal', {
                            "page": chunk_idx + 1,
                            "attempt": iteration,
                            "reason": str(primary_err)[:200],
                        })
                        try:
                            minimal_res, usage = await self.llm.generate_structured(
                                system_prompt=sys_prompt,
                                user_prompt=user_prompt,
                                response_schema=RestructureChunkResultMinimal,
                                temperature=0.0,
                                image_base64=b64_img,
                                max_output_tokens=4096,  # respuestas más cortas para reducir truncamiento
                            )
                            if minimal_res and minimal_res.items:
                                # Promocionamos los MinimalItem a RestructuredItem con defaults
                                promoted = [
                                    RestructuredItem(
                                        code=it.code or "",
                                        description=it.description,
                                        quantity=it.quantity,
                                        unit="ud",
                                        chapter="Sin Capítulo",
                                    ) for it in minimal_res.items
                                ]
                                partial_res = RestructureChunkResult(
                                    items=promoted,
                                    has_more_items=False,
                                    last_extracted_code="",
                                )
                        except Exception as minimal_err:
                            logger.error(f"[extractor] Página {chunk_idx + 1}: también falló minimal ({minimal_err}). Página omitida.")
                            self._emit(budget_id, 'extraction_failed_chunk', {
                                "page": chunk_idx + 1,
                                "error": str(minimal_err)[:200],
                            })
                            break  # saltamos esta página pero NO abortamos el job

                    if usage:
                        for k in accumulated_usage:
                            accumulated_usage[k] += usage.get(k, 0)

                    if partial_res and partial_res.items:
                        all_items_for_page.extend(partial_res.items)

                        # Sólo capturamos orphan_tail en la PRIMERA iteración (inicio físico de la página).
                        if iteration == 1 and getattr(partial_res, "orphan_tail_text", ""):
                            page_orphan_tail = partial_res.orphan_tail_text

                        if partial_res.has_more_items and partial_res.last_extracted_code:
                            last_code = partial_res.last_extracted_code
                            iteration += 1
                        else:
                            # Última iteración (final físico de la página) — capturamos si la última
                            # partida quedó truncada por corte de página.
                            page_last_item_truncated = bool(getattr(partial_res, "last_item_truncated", False))
                            break
                    else:
                        break

                merged_res = RestructureChunkResult(
                    items=all_items_for_page,
                    has_more_items=False,
                    last_extracted_code="",
                    orphan_tail_text=page_orphan_tail,
                    last_item_truncated=page_last_item_truncated,
                )
                self._emit(budget_id, 'restructuring', {"query": f"Página {chunk_idx + 1}/{len(chunks)} consolidada (Total partidas: {len(all_items_for_page)})."})
                return chunk_idx, merged_res, accumulated_usage
                
        tasks = [process_restructure_chunk(idx, chunk) for idx, chunk in enumerate(chunks)]
        results_group = await asyncio.gather(*tasks, return_exceptions=True)

        # Ordenamos por chunk_idx (el paralelismo rompe el orden de llegada) y hacemos una
        # pasada de merge cross-page antes de consolidar: si la página N terminó con una partida
        # truncada físicamente y la N+1 empezó con texto huérfano sin código, concatenamos
        # el texto huérfano a la descripción de la última partida de N. Preserva literalidad.
        ordered_pages: List[tuple] = sorted(
            [r for r in results_group if isinstance(r, tuple)],
            key=lambda r: r[0],
        )
        for i in range(len(ordered_pages) - 1):
            current_idx, current_parsed, _ = ordered_pages[i]
            next_idx, next_parsed, _ = ordered_pages[i + 1]
            if current_parsed.last_item_truncated and next_parsed.orphan_tail_text and current_parsed.items:
                tail = next_parsed.orphan_tail_text.strip()
                if tail:
                    current_parsed.items[-1].description = (
                        current_parsed.items[-1].description.rstrip() + " " + tail
                    )
                    self._emit(budget_id, 'cross_page_merge', {
                        "from_page": current_idx + 1,
                        "to_page": next_idx + 1,
                        "tail_chars": len(tail),
                    })
                    # Marcamos como consumido para evitar que otro reuse lo fusione.
                    next_parsed.orphan_tail_text = ""

        # Los items ya vienen mutados en ordered_pages; el bucle de consolidación
        # mantenemos su lógica original (logging por fallo, métricas por página).
        consolidated = []
        for i, res in enumerate(results_group):
            if isinstance(res, Exception):
                logger.error(f"Error procesando página visual {i}: {res}")
            elif isinstance(res, tuple):
                _chunk_idx, parsed, usage = res
                consolidated.extend(parsed.items)
                self._track_telemetry(metrics, usage)
                
        final_items = []
        current_chapter = "Sin Capítulo"
        for item in consolidated:
            current_chapter = stabilize_chapter_name(item.chapter, current_chapter)
            item.chapter = current_chapter
            # Fase 5.B — normalización determinista server-side. Guarda `is None`
            # respeta valores que el LLM ya hubiera emitido (idempotente).
            if item.unit_normalized is None:
                item.unit_normalized = Unit.normalize(item.unit)
            if item.unit_dimension is None:
                item.unit_dimension = Unit.dimension_of(item.unit)
            final_items.append(item)

        # Fase 8.C — lock por código canonical: elimina capítulos duplicados
        # ("C02 ALBAÑILERIA" y "C02 TABIQUES Y PARTICIONES" coexistiendo).
        consolidate_chapters(final_items)

        # Filtro Anti-Fantasmas
        valid_items = [item for item in final_items if item.code and str(item.code).strip() != ""]
        total_valid = len(valid_items)

        self._emit(budget_id, 'subtasks_extracted', {"count": total_valid, "totalTasks": total_valid})
        self._emit(budget_id, 'batch_restructure_submitted', {"query": f"Extracción Finalizada. Consolidando {total_valid} partidas..."})
        return valid_items

# --- Concrete: Annexed (MapReduce) Extractor ---
class AnnexedPdfExtractorService(IPdfExtractorService):
    # Fase 5.D — paridad de parámetros con INLINE. Expuestos como constantes de
    # clase para que una regresión futura (alguien restaura temp=0.0 o concurrencia 15)
    # salte en el diff de la clase, no enterrada dentro del método extract().
    CONCURRENCY: int = 8
    TEMPERATURE: float = 0.15
    MAX_OUTPUT_TOKENS: int = 16384
    # Fase 7.C: umbral por debajo del cual una descripción se considera
    # sospechosamente corta (el LLM probablemente solo capturó el título y el
    # cross-page merge de 7.B no tuvo señal para disparar). No filtra el item
    # — solo emite señal (log + evento SSE) para intervención humana.
    MIN_DESCRIPTION_CHARS: int = 50

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
        
        semaphore = asyncio.Semaphore(self.CONCURRENCY)

        # --- Fase Map: Descripciones ---
        # Fase 7.B: ahora devolvemos el Phase1Result completo (no solo .items)
        # para poder ejecutar cross-page merge en el reduce.
        async def process_desc_page(chunk_idx: int, page_data: Dict):
            async with semaphore:
                b64_img = page_data.get("image_base64")
                sys_prompt, user_prompt = self._load_prompt("vision_annexed_descriptions.prompt", image_base64_data="[IMAGE_B64]")
                self._emit(budget_id, 'restructuring', {"query": f"Mapeando Literatura de Obra (Página {chunk_idx+1}/{len(desc_pages)})..."})
                res, usage = await self.llm.generate_structured(
                    system_prompt=sys_prompt, user_prompt=user_prompt,
                    response_schema=Phase1Result,
                    temperature=self.TEMPERATURE,
                    image_base64=b64_img,
                    max_output_tokens=self.MAX_OUTPUT_TOKENS,
                )
                if usage: self._track_telemetry(metrics, usage)
                return (chunk_idx, res, usage)

        desc_tasks = [process_desc_page(idx, p) for idx, p in enumerate(desc_pages)]
        desc_results = await asyncio.gather(*desc_tasks, return_exceptions=True)

        # Fase 7.B: merge cross-page antes de consolidar. Mismo patrón que
        # INLINE (líneas ~331-346): si página N marca `last_item_truncated` y
        # página N+1 trae `orphan_tail_text` no vacío, fusionamos la cola a la
        # descripción de la última partida de N. Los eventos SSE emitidos
        # (`cross_page_merge_annexed`) dan trazabilidad en el panel de pipelines.
        ordered_pages: List[tuple] = sorted(
            [r for r in desc_results if isinstance(r, tuple) and r[1] is not None],
            key=lambda r: r[0],
        )
        for i in range(len(ordered_pages) - 1):
            cur_idx, cur_parsed, _ = ordered_pages[i]
            nxt_idx, nxt_parsed, _ = ordered_pages[i + 1]
            tail = (nxt_parsed.orphan_tail_text or "").strip()
            if cur_parsed.last_item_truncated and tail and cur_parsed.items:
                last_item = cur_parsed.items[-1]
                last_item.description = last_item.description.rstrip() + " " + tail
                self._emit(budget_id, 'cross_page_merge_annexed', {
                    "from_page": cur_idx + 1,
                    "to_page": nxt_idx + 1,
                    "tail_chars": len(tail),
                    "partida_code": last_item.code,
                })
                nxt_parsed.orphan_tail_text = ""  # marca consumido

        all_descriptions: List[DescriptionItem] = []
        for _, parsed, _ in ordered_pages:
            all_descriptions.extend(parsed.items)
            
        # --- Fase Map: Sumatorias ---
        async def process_summ_page(chunk_idx: int, page_data: Dict):
            async with semaphore:
                b64_img = page_data.get("image_base64")
                sys_prompt, user_prompt = self._load_prompt("vision_annexed_summatory.prompt", image_base64_data="[IMAGE_B64]")
                self._emit(budget_id, 'restructuring', {"query": f"Auditando Mediciones Contables en Anexos (Página {chunk_idx+1}/{len(summ_pages)})..."})
                res, usage = await self.llm.generate_structured(
                    system_prompt=sys_prompt, user_prompt=user_prompt,
                    response_schema=Phase2Result,
                    temperature=self.TEMPERATURE,
                    image_base64=b64_img,
                    max_output_tokens=self.MAX_OUTPUT_TOKENS,
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

            # Fase 7.C — guard rail: descripciones sospechosamente cortas suelen
            # ser síntoma de cross-page merge fallido. Logueamos + emitimos SSE;
            # NO filtramos el item (mejor item dudoso con señal que pipeline
            # roto sin señal).
            desc_clean = (d.description or "").strip()
            if len(desc_clean) < self.MIN_DESCRIPTION_CHARS:
                logger.warning(
                    "[annexed] Partida %s (cap %s) tiene descripción corta: %d chars (umbral %d). Preview: %r",
                    d.code, ch_final, len(desc_clean), self.MIN_DESCRIPTION_CHARS, desc_clean[:40],
                )
                self._emit(budget_id, 'partida_description_short', {
                    "code": d.code,
                    "chars": len(desc_clean),
                    "chapter": ch_final,
                    "preview": desc_clean[:40],
                })

            final_items.append(RestructuredItem(
                code=d.code,
                description=d.description,
                unit=d.unit,
                quantity=qty,
                chapter=ch_final,
                # Fase 5.D — paridad con INLINE (5.B): normalizamos la unidad y
                # propagamos el hint que el LLM anexado haya emitido en Phase1.
                unit_normalized=Unit.normalize(d.unit),
                unit_dimension=Unit.dimension_of(d.unit),
                unit_conversion_hints=d.unit_conversion_hints,
            ))

        # Fase 8.C — lock por código canonical: elimina capítulos duplicados
        # en el flujo ANNEXED (mismo fix que INLINE).
        consolidate_chapters(final_items)

        valid_items = [i for i in final_items if i.code and str(i.code).strip() != ""]
        self._emit(budget_id, 'subtasks_extracted', {"count": len(valid_items), "totalTasks": len(valid_items)})
        return valid_items

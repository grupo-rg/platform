import logging
import asyncio
import json
import uuid
import inspect
from typing import List, Dict, Any, Optional, Literal
from pydantic import BaseModel, Field

from src.budget.application.ports.ports import ILLMProvider, IVectorSearch, IGenerationEmitter
from src.budget.application.services.pdf_extractor_service import RestructuredItem
from src.budget.catalog.application.services.catalog_lookup_service import CatalogLookupService
from src.budget.catalog.domain.construction_dag import ConstructionDag
from src.budget.domain.entities import BudgetPartida, AIResolution, OriginalItem, BudgetBreakdownComponent, HeuristicFragment
from src.budget.learning.application.ports.heuristic_fragment_repository import IHeuristicFragmentRepository

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
    # Fase 9.7 — flag heredado del catálogo COAATMCA. True si es material
    # variable (suministro: cerámica, vidrio, cementos…), False si es mano
    # de obra, medios auxiliares o coste indirecto. Lo usa el editor del
    # frontend para los modos `Sólo Ejecución` y `Exclusivamente Mano de Obra`.
    is_variable: bool = Field(
        default=False,
        description=(
            "True si este componente es material suministrado (variable). "
            "False si es mano de obra, medios auxiliares o coste indirecto. "
            "Hereda el flag `is_variable` del candidato seleccionado del catálogo."
        ),
    )


class UnitConversionRecord(BaseModel):
    """Registro auditable de una conversión de unidades aplicada por el Judge.

    Ej: "50 m² de grava a 10 cm de espesor" → 5 m³ para buscar el precio
    del libro. Se persiste para que el panel de auditoría del editor
    muestre la trazabilidad matemática.
    """
    value: float = Field(description="Valor original en la unidad de la partida")
    from_unit: str = Field(description="Unidad canonical de origen (ej. 'm2')")
    to_unit: str = Field(description="Unidad canonical destino (ej. 'm3')")
    bridge: Dict[str, float] = Field(
        description="Puente físico usado (ej. {'thickness_m': 0.10})"
    )
    result: float = Field(gt=0.0, description="Resultado convertido (>0 obligatorio)")


MatchKind = Literal["1:1", "1:N", "from_scratch"]


class PricingFinalResultDB(BaseModel):
    pensamiento_calculista: str = Field(description="Razonamiento matemático")
    # Fase 9.1 — bug fix: el campo se llamaba `calculated_total_price` con
    # description "al m2" (contradictorio). El LLM, cuando hacía matemáticas,
    # interpretaba el nombre y multiplicaba por la cantidad ANTES de emitirlo.
    # El boundary multiplicaba OTRA VEZ → precios totales ×N inflados.
    # Nombre + description ahora son inequívocos.
    calculated_unit_price: float = Field(
        description=(
            "PRECIO UNITARIO por unidad de la partida (€/m², €/ud, €/ml…). "
            "PROHIBIDO multiplicar por la cantidad — el sistema lo hace después. "
            "Si el candidato cuesta 60 €/m² y la partida son 100 m², emite 60 (NO 6000)."
        )
    )
    breakdown: Optional[List[BreakdownComponentSchema]] = Field(default=None) # Si es simple, null.
    selected_candidate: Optional[str] = Field(default=None) # Para las 1:1
    needs_human_review: bool
    # v005: cómo se resolvió la partida y (si aplica) qué conversión se usó.
    match_kind: MatchKind = Field(description="1:1 exacto / 1:N compuesto / from_scratch")
    unit_conversion_applied: Optional[UnitConversionRecord] = Field(
        default=None,
        description="Registro de la conversión matemática si se aplicó una",
    )

class BatchPricedItemV3(BaseModel):
    item_code: str
    valuation: PricingFinalResultDB

class BatchPricingEvaluatorResultV3(BaseModel):
    results: List[BatchPricedItemV3]


# Fase 9.4 — schema del re-rank intermedio con Flash.
class CandidateRerankResult(BaseModel):
    selected_ids: List[str] = Field(
        description=(
            "Lista de IDs de los candidatos seleccionados, ordenados por relevancia "
            "(más relevante primero). Máximo 3 elementos. Solo IDs que aparezcan "
            "en la lista de entrada — PROHIBIDO inventar IDs nuevos."
        )
    )
    reason: str = Field(
        default="",
        description="Razón breve del ranking, para auditoría (puede dejar en blanco).",
    )

logger = logging.getLogger(__name__)


# -------------------------------------------------------------------------------------------------
# TOOL CONTEXT PRECOMPUTADO (v005)
# -------------------------------------------------------------------------------------------------
# Mapping hint_key -> (source_unit -> target_unit). Dice qué conversión se
# habilita cuando el hint está presente Y la partida viene en ese `source_unit`.
_HINT_TARGET_MAP: Dict[str, Dict[str, str]] = {
    "thickness_m": {"m2": "m3", "m3": "m2"},
    "piece_length_m": {"ml": "ud", "ud": "ml"},
    "density_kg_m3": {"m3": "kg", "kg": "m3"},
}


def _prepare_tool_context(
    *, partida: RestructuredItem, catalog: CatalogLookupService
) -> Dict[str, Any]:
    """Precomputa las tools que el Judge usaría para esta partida.

    Hoy solo cubre `convert_measurement` (el path caliente del caso canónico).
    Las tarifas de mano de obra se inyectan por el otro canal (dentro del
    `{{rules}}` al montar el DI), así que no se precomputan aquí por partida.

    Devuelve un dict serializable con clave `conversions`: lista de
    registros con value/from/to/bridge/result. Conversiones inválidas
    (hint desconocido, source_unit no mapea, bridge ≤ 0) se descartan
    silenciosamente — el Judge verá la lista vacía y decidirá.
    """
    conversions: List[Dict[str, Any]] = []
    hints = partida.unit_conversion_hints or {}
    if not hints:
        return {"conversions": conversions}

    source_unit = partida.unit_normalized or partida.unit
    if not source_unit:
        return {"conversions": conversions}

    for hint_key, hint_value in hints.items():
        target_map = _HINT_TARGET_MAP.get(hint_key)
        if not target_map:
            continue  # hint desconocida
        target_unit = target_map.get(source_unit)
        if not target_unit:
            continue  # source_unit no aplica a este hint
        result = catalog.convert_measurement(
            value=partida.quantity,
            from_unit=source_unit,
            to_unit=target_unit,
            bridge={hint_key: hint_value},
        )
        if result is None:
            continue  # conversión rechazada (bridge ≤ 0, etc.)
        conversions.append({
            "value": partida.quantity,
            "from_unit": source_unit,
            "to_unit": target_unit,
            "bridge": {hint_key: hint_value},
            "result": result.value,
        })

    return {"conversions": conversions}


ICL_EMPTY_SENTINEL = "(sin ejemplos históricos para esta partida)"


# Fase 9.3 — Two-tier evaluation Flash/Pro.
# Threshold de score sobre el cual aceptamos que Flash 2.5 es suficiente.
TIER_FLASH_SCORE_THRESHOLD: float = 0.85
# Modelos LLM. Mantenidos como constantes para evitar typos en strings sueltos.
MODEL_FLASH: str = "gemini-2.5-flash"
MODEL_PRO: str = "gemini-2.5-pro"


def _group_tasks_adaptively(
    batch_tasks: List[Dict[str, Any]],
    candidates_map: Dict[str, Dict[str, Any]],
    items_by_code: Dict[str, Any],
    max_batch: int = 5,
) -> List[List[Dict[str, Any]]]:
    """Fase 9.5 — agrupa partidas adyacentes "fáciles" del mismo capítulo en
    un solo chunk para batch a Flash. Las difíciles quedan singleton (Pro).

    Reglas:
    - "Fácil" si `_select_tier(candidates, partida_unit) == 'flash'`.
    - Solo se agrupan partidas CONSECUTIVAS en `batch_tasks` (preserva orden).
    - Cambio de capítulo rompe el grupo.
    - Una difícil rompe el grupo y se emite como singleton.
    - `max_batch` cap el tamaño de cada cluster easy.
    """
    if not batch_tasks:
        return []

    groups: List[List[Dict[str, Any]]] = []
    current: List[Dict[str, Any]] = []
    current_chapter: Optional[str] = None

    def _flush() -> None:
        nonlocal current, current_chapter
        if current:
            groups.append(current)
            current = []
            current_chapter = None

    for task in batch_tasks:
        code = task["id"]
        item = items_by_code.get(code)
        chapter = item.chapter if item is not None else None
        unit = item.unit if item is not None else None
        cands = candidates_map.get(code, {}).get("candidates", [])
        tier, _ = _select_tier(cands, unit)

        if tier != "flash":
            # Difícil: corta el grupo en curso y emite singleton.
            _flush()
            groups.append([task])
            continue

        # Fácil: encadena con el grupo actual si comparten capítulo y hay espacio.
        if not current:
            current = [task]
            current_chapter = chapter
        elif chapter == current_chapter and len(current) < max_batch:
            current.append(task)
        else:
            _flush()
            current = [task]
            current_chapter = chapter

    _flush()
    return groups


def _select_tier(
    candidates: List[Dict[str, Any]],
    partida_unit: Optional[str],
) -> tuple[str, str]:
    """Decide si la partida puede tasarse con Flash o necesita Pro.

    Heurística (calibrada para minimizar falsos negativos):
    - "flash" si: hay candidatos, top tiene `matchScore ≥ 0.85`, unit del top
      coincide con la unit de la partida (tras normalización).
    - "pro" en cualquier otro caso. Es la opción conservadora.

    Devuelve `(tier, reason)`. La razón es legible para SSE/logs.
    """
    from src.budget.catalog.domain.unit import Unit

    if not candidates:
        return "pro", "no candidatos del vector_search → Pro conservador"

    if not partida_unit:
        return "pro", "partida sin unidad clara → Pro conservador"

    top = candidates[0]
    score = float(top.get("matchScore") or top.get("score") or 0.0)
    if score < TIER_FLASH_SCORE_THRESHOLD:
        return (
            "pro",
            f"top score {score:.2f} < {TIER_FLASH_SCORE_THRESHOLD} → Pro",
        )

    top_unit = top.get("unit") or ""
    partida_unit_n = Unit.normalize(partida_unit)
    top_unit_n = Unit.normalize(top_unit)
    if not partida_unit_n or not top_unit_n or partida_unit_n != top_unit_n:
        return (
            "pro",
            f"unit mismatch: partida={partida_unit!r} ({partida_unit_n}) "
            f"vs top candidate={top_unit!r} ({top_unit_n}) → Pro",
        )

    return (
        "flash",
        f"score {score:.2f} ≥ {TIER_FLASH_SCORE_THRESHOLD} y unit {partida_unit_n} coincide → Flash",
    )


def _is_medios_partida(item: Optional[RestructuredItem]) -> bool:
    """Fase 14.B — detecta si la partida es 'Medios para ejecución'.

    El Judge necesita el PEM acumulado del capítulo para aplicar el
    fragment ICL `principle:coaatmca_norm_1.1_medios_pem` (% PEM). Estas
    partidas se evalúan en una segunda pasada después del resto del
    capítulo.

    Heurística keyword-based: descripción contiene 'medios' Y
    ('auxiliares' | 'ejecución' | 'ejecucion').
    """
    if item is None:
        return False
    desc = (item.description or "").lower()
    if "medios" not in desc:
        return False
    return any(k in desc for k in ("auxiliares", "ejecución", "ejecucion"))


def _reason_from_tags(tags: list[str]) -> str | None:
    for t in tags:
        if t.lower().startswith("reason:"):
            return t.split(":", 1)[1]
    return None


def _chapter_from_tags(tags: list[str]) -> str | None:
    for t in tags:
        if t.lower().startswith("chapter:"):
            return t.split(":", 1)[1]
    return None


def _format_fragments_as_icl(fragments: list[HeuristicFragment]) -> str:
    """Formatea los fragments como bloque de ICL para el prompt del Pro.

    - Cuando no hay fragments devuelve un sentinel claro.
    - Emite un ejemplo por fragment (AI price vs human price + motivo).
    - Si un mismo `reason` aparece ≥ 2 veces, añade una línea de "patrón
      aprendido" que destaca la corrección recurrente.
    """
    if not fragments:
        return ICL_EMPTY_SENTINEL

    # Agrupa por motivo para detectar patrones repetidos.
    by_reason: dict[str, list[HeuristicFragment]] = {}
    for f in fragments:
        r = _reason_from_tags(f.tags) or "otro"
        by_reason.setdefault(r, []).append(f)

    lines: list[str] = []
    for reason, group in by_reason.items():
        if len(group) >= 2:
            # Ejemplo: "PATRÓN APRENDIDO (volumen, 3 casos en DEMOLICIONES):
            #           el aparejador ha corregido precios a la baja en 3 partidas
            #           similares con motivo 'volumen'."
            chapter = _chapter_from_tags(group[0].tags) or "(capítulo no etiquetado)"
            lines.append(
                f"PATRÓN APRENDIDO ({reason}, {len(group)} casos en {chapter}):"
                f" el aparejador ha corregido precios con motivo '{reason}' en"
                f" partidas similares. Úsalo como referencia."
            )
        for f in group:
            ai_price = f.aiInferenceTrace.proposedUnitPrice
            human_price = f.humanCorrection.correctedUnitPrice
            rule = f.humanCorrection.heuristicRule
            chapter = _chapter_from_tags(f.tags) or ""
            desc = (f.context.originalDescription or "").strip()
            price_change = "→".join([
                f"{ai_price:.2f}€" if ai_price is not None else "—",
                f"{human_price:.2f}€" if human_price is not None else "—",
            ])
            lines.append(
                f"- [{chapter}] \"{desc[:120]}\" | IA {price_change} | motivo: {rule}"
            )

    return "\n".join(lines)


class SwarmPricingService:

    # v005: una partida por prompt del Pro — elimina cross-talk de contexto
    # entre partidas distintas. Antes era 3.
    CHUNK_SIZE: int = 1

    def __init__(
        self,
        llm_provider: ILLMProvider,
        vector_search: IVectorSearch,
        emitter: Optional[IGenerationEmitter] = None,
        *,
        catalog_lookup: Optional[CatalogLookupService] = None,
        rules: Optional[str] = None,
        dag: Optional[ConstructionDag] = None,
        fragment_repo: Optional[IHeuristicFragmentRepository] = None,
    ):
        self.llm = llm_provider
        self.vector_search = vector_search
        self.emitter = emitter
        # Dependencias v005 (opcionales para backward-compat). Cuando llegan
        # se activa el flujo enriquecido: tools precomputadas, normas en el
        # system prompt, contexto del DAG por partida.
        self.catalog_lookup = catalog_lookup
        self.rules = rules or ""
        self.dag = dag
        # Dependencia v006 (Fase 6.C) — retrieval de HeuristicFragments para
        # el loop de aprendizaje. Opcional: si falta, el Pro opera sin ICL.
        self.fragment_repo = fragment_repo

    async def _rerank_candidates(
        self,
        candidates: List[Dict[str, Any]],
        partida_description: str,
        partida_unit: Optional[str],
    ) -> List[Dict[str, Any]]:
        """Fase 9.4 — re-rank intermedio con Flash. Si hay ≥ 4 candidatos,
        invoca Flash con un prompt mínimo y devuelve los top-3 reordenados.

        Si hay ≤ 3 candidatos: passthrough sin LLM (no aporta valor).
        Si Flash falla: passthrough con los originales (no se rompe el pipeline).
        IDs inventados por el LLM se descartan defensivamente.
        """
        if len(candidates) <= 3:
            return candidates

        # Prompt minimalista — solo lo necesario para rankear.
        compact = [
            {
                "id": c.get("id"),
                "desc": (c.get("description") or "")[:160],
                "unit": c.get("unit"),
                "score": c.get("matchScore") or c.get("score"),
            }
            for c in candidates
        ]
        sys_prompt = (
            "Eres un aparejador. Te paso una partida y una lista de candidatos del catálogo. "
            "Devuelve los 3 IDs MÁS relevantes para esta partida en el campo `selected_ids`, "
            "del más relevante al menos. PROHIBIDO inventar IDs que no aparezcan en la lista."
        )
        user_prompt = (
            f"PARTIDA: descripción='{partida_description[:500]}', unidad='{partida_unit or '?'}'\n\n"
            f"CANDIDATOS:\n{json.dumps(compact, ensure_ascii=False)}"
        )

        try:
            res, _ = await self.llm.generate_structured(
                system_prompt=sys_prompt,
                user_prompt=user_prompt,
                response_schema=CandidateRerankResult,
                temperature=0.0,
                model=MODEL_FLASH,
            )
        except Exception as e:
            logger.warning(
                f"Re-rank Flash falló ({type(e).__name__}: {e}); fallback a candidatos originales."
            )
            return candidates

        if not res or not res.selected_ids:
            return candidates

        # Filtrar IDs inventados (defensivo) y respetar el orden devuelto.
        cand_by_id = {c.get("id"): c for c in candidates if c.get("id")}
        reordered = [cand_by_id[i] for i in res.selected_ids if i in cand_by_id]
        return reordered if reordered else candidates

    async def _find_relevant_fragments(
        self, partida: RestructuredItem
    ) -> List[HeuristicFragment]:
        """Devuelve fragments dorados para la partida en curso.

        Envuelve `fragment_repo.find_relevant` con defaults del plan
        (similarity ≥ 0.70, min_count ≥ 2, max_age_months=12). Cualquier
        error del repo (Firestore caído, etc.) se captura y devuelve [] —
        el pricing no debe reventar por un fallo del loop ICL.
        """
        if self.fragment_repo is None:
            return []
        chapter = partida.chapter or ""
        description = partida.description or ""
        if not chapter or not description:
            return []
        try:
            # Fase 13.E — threshold bajado de 0.70 a 0.30 porque el nuevo
            # `_similarity` combina SequenceMatcher.ratio + token_coverage.
            # `min_count=2` se relaja internamente a 1 para fragments con
            # `sourceType='baseline_migration'` (golden firmados). Para
            # capturas del editor (`internal_admin`) sigue exigiendo evidencia
            # repetida.
            #
            # Phase 14 fix — pasamos `partida_code` para que el filtro de
            # capítulo use `chapter_code:NN` (estable) sobre `chapter:NAME`
            # (variable). El nombre del capítulo cambia run-a-run según
            # interpretación del extractor LLM; el código (01, 02) viene del
            # propio PDF y es invariante.
            return await self.fragment_repo.find_relevant(
                chapter=chapter,
                description=description,
                similarity_threshold=0.30,
                min_count=2,
                max_age_months=12,
                partida_code=partida.code,
            )
        except Exception as e:
            logger.warning(
                "find_relevant_fragments failed for %s (%s): %s",
                partida.code, chapter, e,
            )
            return []

    def _emit(self, budget_id: str, event_type: str, data: Dict[str, Any]):
        if self.emitter:
            self.emitter.emit_event(budget_id, event_type, data)

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
        # v005: reemplazamos placeholders en AMBOS prompts — antes solo el user.
        # Esto permite que `{{rules}}` (contenido estable) viva en el system y
        # `{{batch_items}}` / `{{tool_context}}` / `{{dag_context}}` en el user.
        for k, v in kwargs.items():
            needle = f"{{{{{k}}}}}"
            sys_p = sys_p.replace(needle, str(v))
            usr_p = usr_p.replace(needle, str(v))
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
    async def _firestore_vector_swarm(
        self,
        queries: List[str],
        partida_unit_dimension: Optional[str] = None,
    ) -> List[Dict]:
        if not queries:
            return []

        # Fase 9.6 — paralelizar embeddings + vector_search por subquery.
        # Antes (secuencial): 3 queries × (100ms embed + 100ms search) ~600ms.
        # Ahora (paralelo): max(...) ~200ms. Speedup ~3× en partidas con
        # múltiples sub-queries (típico en 1:N).
        async def _fetch_one(q: str) -> tuple[str, List[Dict]]:
            try:
                vector = await self.llm.get_embedding(q)
                res = self.vector_search.search_similar_items(
                    query_vector=vector,
                    query_text=q,
                    limit=4,
                    partida_unit_dimension=partida_unit_dimension,
                )
                candidates = await res if inspect.isawaitable(res) else res
                return q, candidates or []
            except Exception as e:
                logger.error(f"Vector search failed for '{q}': {e}")
                return q, []

        results = await asyncio.gather(*(_fetch_one(q) for q in queries))

        # Dedup determinista (preservando orden de queries originales) +
        # marcar el query de origen.
        all_candidates: List[Dict] = []
        seen_ids: set = set()
        for q, cands in results:
            for c in cands:
                cid = c.get('id')
                if cid and cid not in seen_ids:
                    seen_ids.add(cid)
                    c["__query_origin"] = q
                    all_candidates.append(c)

        # Limitar para no saturar contextos enormes.
        all_candidates.sort(key=lambda x: x.get('matchScore', 0), reverse=True)
        return all_candidates[:15]

    # --- 3. Ejecución Orquestada de Pricing (Public Method) ---
    async def evaluate_batch(self, items: List[RestructuredItem], budget_id: str, metrics: Dict) -> List[BudgetPartida]:
        logger.info(f"Starting Swarm Pricing Phase for {len(items)} items...")
        self._emit(budget_id, 'vector_search_started', {"query": f"Invocando al cerebro Flash para romper {len(items)} partidas en queries atómicas..."})
        
        # Obtenemos candidatos masivos
        async def fetch_item_candidates(item: RestructuredItem):
            queries = await self._analyze_and_deconstruct(item, metrics)
            candidates = await self._firestore_vector_swarm(
                queries,
                partida_unit_dimension=item.unit_dimension,
            )
            return item, candidates
            
        vector_tasks = [fetch_item_candidates(i) for i in items]
        vector_results = await asyncio.gather(*vector_tasks, return_exceptions=True)
        
        # Montar el RAG Prompt final para cada bloque
        candidates_map = {}
        batch_tasks = []
        
        # Fase 9.4 — re-rank con Flash en paralelo para todas las partidas con
        # ≥ 4 candidatos. Reduce el contexto del modelo final (10 → 3) y mejora
        # la calidad de selección. Errores quedan silenciados (passthrough).
        items_with_cands: List[tuple[Any, List[Dict[str, Any]]]] = []
        for res in vector_results:
            if isinstance(res, Exception):
                logger.error(f"Enjambre Vectorial Crashed: {res}")
                continue
            item, candidates = res
            items_with_cands.append((item, candidates))

        async def _rerank_for_item(item: RestructuredItem, candidates: List[Dict[str, Any]]):
            input_size = len(candidates)
            reranked = await self._rerank_candidates(
                candidates,
                partida_description=item.description or "",
                partida_unit=item.unit,
            )
            if input_size >= 4:
                self._emit(budget_id, 'rerank_applied', {
                    "code": item.code,
                    "input_size": input_size,
                    "output_size": len(reranked),
                    "selected_ids": [c.get("id") for c in reranked],
                })
            return item, reranked

        rerank_tasks = [_rerank_for_item(it, cs) for it, cs in items_with_cands]
        reranked_pairs = await asyncio.gather(*rerank_tasks)

        for item, candidates in reranked_pairs:
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
        self._emit(budget_id, 'batch_pricing_submitted', {"query": f"Generados {len(batch_tasks)} Enjambres de Mercado. Evaluando costes exactos con Gemini Pro..."})
        
        # Fase 9.5 — agrupado adaptativo: easy clusters → batch Flash, hard
        # singleton → Pro. Reduce ~60% de llamadas LLM en presupuestos con
        # clusters de 1:1 fáciles consecutivos.
        items_by_code = {it.code: it for it in items if it.code}
        grouped_tasks = _group_tasks_adaptively(
            batch_tasks,
            candidates_map,
            items_by_code,
            max_batch=5,
        )
        # Fase 6.C → 6.D: qué fragments se inyectaron al prompt de qué partida.
        # Poblado en evaluate_chunk, leído en el assembly de BudgetPartida (6.D).
        fragments_used_per_code: Dict[str, List[str]] = {}
        semaphore_pricing = asyncio.Semaphore(4)

        # Fase 14.B — PEM acumulado por capítulo, poblado tras la 1ª pasada
        # (no-medios) y leído por evaluate_chunk en la 2ª pasada (medios).
        # Se captura por referencia en el closure; medios se procesan en una
        # segunda pasada secuencial post-resto, con este dict ya poblado.
        chapter_pem_for_medios: Dict[str, float] = {}

        async def evaluate_chunk(chunk_idx: int, task_group: List[Dict]):
            async with semaphore_pricing:
                grouped_tasks_str = "\n\n".join(t["prompt"] for t in task_group)

                # v005: contexto DAG + tools precomputadas, por cada partida del chunk.
                # Con CHUNK_SIZE=1 esto es una única partida → un único contexto.
                dag_context_str = ""
                tool_context_str = "{}"
                golden_examples_str = ICL_EMPTY_SENTINEL
                if task_group:
                    first_code = task_group[0]["id"]
                    first_meta = candidates_map.get(first_code, {}).get("item")
                    if first_meta is not None:
                        if self.dag is not None and first_meta.chapter:
                            ctx = self.dag.context_for(first_meta.chapter)
                            if ctx is not None:
                                dag_context_str = (
                                    f"FASE: {ctx.phase} | "
                                    f"Precedentes: {', '.join(ctx.precedents) or '—'} | "
                                    f"Siguientes: {', '.join(ctx.followers) or '—'}"
                                )
                        if self.catalog_lookup is not None:
                            tool_ctx = _prepare_tool_context(
                                partida=first_meta, catalog=self.catalog_lookup
                            )
                            tool_context_str = json.dumps(tool_ctx, ensure_ascii=False)
                        # v006 (Fase 6.C) — retrieval de fragments dorados para ICL.
                        fragments = await self._find_relevant_fragments(first_meta)
                        if fragments:
                            golden_examples_str = _format_fragments_as_icl(fragments)
                            # Fase 6.D persistirá los ids en el BudgetPartida;
                            # aquí registramos qué fragments entraron al prompt.
                            fragments_used_per_code[first_code] = [f.id for f in fragments]

                        # Fase 14.B — para partidas de medios, inyectar el PEM
                        # acumulado del capítulo en el dag_context. Esto permite
                        # al Judge aplicar la regla del fragment
                        # `principle:coaatmca_norm_1.1_medios_pem` (% PEM).
                        if _is_medios_partida(first_meta) and first_meta.chapter:
                            pem_value = chapter_pem_for_medios.get(first_meta.chapter)
                            if pem_value is not None and pem_value > 0:
                                pem_line = (
                                    f"PEM ACUMULADO DEL CAPÍTULO "
                                    f"(sin esta partida de medios): "
                                    f"{pem_value:,.2f} €"
                                )
                                dag_context_str = (
                                    (dag_context_str + " | " if dag_context_str else "")
                                    + pem_line
                                )
                                self._emit(budget_id, 'medios_pem_context_injected', {
                                    "code": first_code,
                                    "chapter": first_meta.chapter,
                                    "chapter_pem": round(pem_value, 2),
                                })

                sys_prompt, user_prompt = self._load_prompt(
                    "pricing_evaluator.prompt",
                    batch_items=grouped_tasks_str,
                    golden_examples=golden_examples_str,
                    rules=self.rules or "(normas no configuradas)",
                    tool_context=tool_context_str,
                    dag_context=dag_context_str or "(capítulo sin contexto DAG disponible)",
                )

                # Fase 9.3 — Two-tier dispatch. Con CHUNK_SIZE=1 cada chunk es
                # una sola partida; usamos sus candidatos para decidir tier.
                tier, tier_reason = "pro", "default"
                first_code = task_group[0]["id"] if task_group else None
                if first_code is not None:
                    cands_for_tier = candidates_map.get(first_code, {}).get("candidates", [])
                    first_meta = candidates_map.get(first_code, {}).get("item")
                    partida_unit = first_meta.unit if first_meta else None
                    tier, tier_reason = _select_tier(cands_for_tier, partida_unit)
                    self._emit(budget_id, 'tier_assigned', {
                        "code": first_code,
                        "tier": tier,
                        "reason": tier_reason,
                    })

                # Respetando cuota
                await asyncio.sleep(1.0)
                model_to_use = MODEL_FLASH if tier == "flash" else MODEL_PRO
                eval_res, usage = await self.llm.generate_structured(
                    system_prompt=sys_prompt,
                    user_prompt=user_prompt,
                    response_schema=BatchPricingEvaluatorResultV3,
                    temperature=0.0,
                    model=model_to_use,
                )

                # Fase 9.3 — escalation: si Flash devuelve from_scratch o flag
                # needs_human_review, re-corremos con Pro. Esto preserva calidad
                # en los casos difíciles que el tier selector no detectó.
                needs_escalation = False
                if tier == "flash" and eval_res and eval_res.results:
                    val = eval_res.results[0].valuation
                    if val.match_kind == "from_scratch" or val.needs_human_review:
                        needs_escalation = True

                if needs_escalation:
                    self._emit(budget_id, 'tier_escalated', {
                        "code": first_code,
                        "from_tier": "flash",
                        "to_tier": "pro",
                        "reason": (
                            f"flash devolvió match_kind={eval_res.results[0].valuation.match_kind} "
                            f"needs_review={eval_res.results[0].valuation.needs_human_review} "
                            f"→ re-tasando con Pro"
                        ),
                    })
                    eval_res_pro, usage_pro = await self.llm.generate_structured(
                        system_prompt=sys_prompt,
                        user_prompt=user_prompt,
                        response_schema=BatchPricingEvaluatorResultV3,
                        temperature=0.0,
                        model=MODEL_PRO,
                    )
                    if eval_res_pro and eval_res_pro.results:
                        eval_res = eval_res_pro
                        # Acumulamos uso de tokens de ambas llamadas.
                        if usage_pro and usage:
                            for k in ("promptTokenCount", "candidatesTokenCount", "totalTokenCount"):
                                usage[k] = usage.get(k, 0) + usage_pro.get(k, 0)
                        elif usage_pro:
                            usage = usage_pro

                self._emit(budget_id, 'vector_search', {"query": f"Evaluación Matemática Grupo {chunk_idx + 1}/{len(grouped_tasks)} terminada."})
                return eval_res, usage

        # Fase 14.B — split grupos en non-medios + medios. Pass 1 evalúa todo
        # excepto medios en paralelo. Tras pass 1 calculamos el PEM acumulado
        # por capítulo y poblamos `chapter_pem_for_medios`. Pass 2 evalúa los
        # grupos de medios con el PEM ya disponible en su dag_context.
        non_medios_indexed: List[tuple[int, List[Dict]]] = []
        medios_indexed: List[tuple[int, List[Dict]]] = []
        for idx, g in enumerate(grouped_tasks):
            is_medios_group = any(
                _is_medios_partida(items_by_code.get(t["id"]))
                for t in g
            )
            if is_medios_group:
                medios_indexed.append((idx, g))
            else:
                non_medios_indexed.append((idx, g))

        results_group: List[Any] = [None] * len(grouped_tasks)

        # Pass 1: non-medios en paralelo (comportamiento histórico).
        non_medios_tasks = [evaluate_chunk(idx, g) for idx, g in non_medios_indexed]
        non_medios_results = await asyncio.gather(*non_medios_tasks, return_exceptions=True)
        for (idx, _), res in zip(non_medios_indexed, non_medios_results):
            results_group[idx] = res

        # Calcular PEM acumulado por capítulo desde resultados pass 1.
        if medios_indexed:
            for res in non_medios_results:
                if isinstance(res, Exception):
                    continue
                eval_res, _usage = res
                if not eval_res or not eval_res.results:
                    continue
                for evaluated in eval_res.results:
                    item = items_by_code.get(evaluated.item_code)
                    if item is None:
                        continue
                    chapter = item.chapter or "Sin Capítulo"
                    unit_price = evaluated.valuation.calculated_unit_price or 0.0
                    qty = item.quantity or 0.0
                    chapter_pem_for_medios[chapter] = (
                        chapter_pem_for_medios.get(chapter, 0.0) + unit_price * qty
                    )

            # Pass 2: medios en paralelo, ya con dict poblado.
            medios_tasks = [evaluate_chunk(idx, g) for idx, g in medios_indexed]
            medios_results = await asyncio.gather(*medios_tasks, return_exceptions=True)
            for (idx, _), res in zip(medios_indexed, medios_results):
                results_group[idx] = res
        
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

                # Un item corrupto (p. ej. `unit=None` llegando a un schema estricto) NO debe
                # abortar el batch completo. Capturamos por item y emitimos `item_skipped`.
                try:
                    item = meta["item"]
                    candidates = meta["candidates"]
                    val = evaluated.valuation

                    # Sanitización en el boundary DTO→Domain: RestructuredItem permite None en
                    # code/unit/chapter (Optional[str]), OriginalItem los exige `str`. Coaccionamos
                    # aquí una única vez y reutilizamos las locales para BudgetPartida.
                    safe_code = item.code or ""
                    safe_description = item.description or ""
                    safe_quantity = item.quantity if item.quantity is not None else 0.0
                    safe_unit = item.unit or "ud"
                    safe_chapter = item.chapter or "Sin Capítulo"

                    final_price = val.calculated_unit_price
                    reasoning_full = val.pensamiento_calculista
                    needs_human_review = val.needs_human_review

                    # Fase 9.1 — sanity guard post-hoc: si el precio total
                    # calculado supera 100K € Y la partida está en una unidad
                    # común (m², m³, ml, ud), forzamos review humano y emitimos
                    # señal SSE. Las partidas alzadas (PA) se exceptúan porque
                    # legítimamente pueden tener precios elevados.
                    PRICE_ANOMALY_THRESHOLD_EUR = 100_000.0
                    COMMON_UNITS = {"m2", "m3", "ml", "ud"}
                    total_price_estimate = final_price * safe_quantity
                    unit_norm = (safe_unit or "").lower()
                    is_common_unit = unit_norm in COMMON_UNITS
                    if is_common_unit and total_price_estimate > PRICE_ANOMALY_THRESHOLD_EUR:
                        needs_human_review = True
                        self._emit(budget_id, 'partida_price_anomaly', {
                            "code": safe_code,
                            "unit_price": final_price,
                            "quantity": safe_quantity,
                            "unit": safe_unit,
                            "total_price": total_price_estimate,
                            "threshold": PRICE_ANOMALY_THRESHOLD_EUR,
                            "reason": (
                                f"unit_price × quantity = {total_price_estimate:.2f} €  "
                                f"supera el umbral de {PRICE_ANOMALY_THRESHOLD_EUR} € "
                                f"para unidad común '{safe_unit}'. Posible runaway pricing."
                            ),
                        })

                    confidence = 40 if needs_human_review else 95

                    # Parsear Breakdowns si existen
                    breakdown_domain = []
                    sel_id_flat = val.selected_candidate

                    # Fase 11.A — guard defensivo de coherencia breakdown↔unit_price.
                    # Si el Judge declaró `unit_conversion_applied` y el sumatorio del
                    # breakdown se sale del ±5% del unit_price, escalamos por
                    # factor=result/value. Idempotente: si el LLM ya respetó la
                    # regla 14b del prompt, no tocamos. Si NO hay conversión pero
                    # hay divergencia >50% solo emitimos warning (no escalamos sin puente).
                    if val.breakdown and final_price > 0:
                        sum_total = sum((b.total or 0) for b in val.breakdown)
                        if sum_total > 0:
                            ratio = sum_total / final_price
                            if val.unit_conversion_applied and (ratio > 1.05 or ratio < 0.95):
                                conv_value = val.unit_conversion_applied.value or 1.0
                                conv_result = val.unit_conversion_applied.result or 1.0
                                factor = conv_result / max(conv_value, 1e-6)
                                for b in val.breakdown:
                                    b.price = (b.price or 0) * factor
                                    b.total = (b.total or 0) * factor
                                self._emit(budget_id, 'breakdown_scaled_defensive', {
                                    "code": safe_code,
                                    "factor": round(factor, 6),
                                    "ratio_before": round(ratio, 3),
                                })
                            elif not val.unit_conversion_applied and (ratio > 1.5 or ratio < 0.7):
                                # Fase 13.B — divergencia bidireccional sin
                                # conversión declarada. `sum_above` (>1.5):
                                # breakdown sin escalar hacia arriba. `sum_below`
                                # (<0.7): Judge multiplicó manualmente vía
                                # DIMENSIONAMIENTO OCULTO sin escalar el
                                # breakdown (caso 01.06 del eval 2026-04-27).
                                self._emit(budget_id, 'breakdown_sum_divergence', {
                                    "code": safe_code,
                                    "sum_total": round(sum_total, 2),
                                    "unit_price": round(final_price, 2),
                                    "ratio": round(ratio, 2),
                                    "direction": "sum_above" if ratio > 1.5 else "sum_below",
                                })

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
                                alternativeComponents=alt_objs,
                                # Fase 9.7 — propagar el flag desde el schema del LLM al entity domain.
                                is_variable=b.is_variable,
                            ))

                    original_item_obj = OriginalItem(
                        code=safe_code, description=safe_description, quantity=safe_quantity,
                        unit=safe_unit, chapter=safe_chapter, raw_table_data="Basis Swarm AI Extracted"
                    )

                    selected_cand_data = next((c for c in candidates if c.get('id') == sel_id_flat), None)

                    # Fase 6.D — fragments que el Swarm inyectó como ICL al tasar
                    # esta partida. None = no se consultó (repo ausente); lista no
                    # vacía = se aplicaron y debe quedar rastro en el razonamiento.
                    fragment_ids = fragments_used_per_code.get(code)
                    if fragment_ids:
                        fragment_note = (
                            "[v006] Aplicado(s) fragment(s) "
                            + ", ".join(f"#{fid}" for fid in fragment_ids)
                            + " como ejemplos ICL al tasar esta partida."
                        )
                        reasoning_for_trace = fragment_note + "\n\n" + reasoning_full
                    else:
                        reasoning_for_trace = reasoning_full

                    ai_res_obj = AIResolution(
                        selected_candidate=selected_cand_data,
                        reasoning_trace=reasoning_for_trace,
                        calculated_unit_price=final_price,
                        calculated_total_price=final_price * safe_quantity,
                        confidence_score=confidence,
                        is_estimated=needs_human_review,
                        needs_human_review=needs_human_review
                    )

                    # Flat alternatives (for 1:1)
                    alternatives = [c for c in candidates if c.get('id') != sel_id_flat]

                    # Fase 5.E — serializamos `unit_conversion_applied` a dict plano
                    # (si existe) para que Firestore + UI lo consuman sin pydantic.
                    conversion_payload = (
                        val.unit_conversion_applied.model_dump()
                        if val.unit_conversion_applied is not None
                        else None
                    )

                    partida = BudgetPartida(
                        id=str(uuid.uuid4()), order=global_order,
                        original_item=original_item_obj,
                        ai_resolution=ai_res_obj,
                        alternatives=alternatives,
                        code=safe_code, description=safe_description,
                        unit=safe_unit, quantity=safe_quantity, unitPrice=final_price,
                        totalPrice=final_price * safe_quantity,
                        isRealCost=not needs_human_review,
                        matchConfidence=confidence,
                        reasoning=reasoning_for_trace,
                        breakdown=breakdown_domain if breakdown_domain else None,
                        match_kind=val.match_kind,
                        unit_conversion_applied=conversion_payload,
                        applied_fragments=fragment_ids,
                    )
                    priced_partidas.append(partida)

                    self._emit(budget_id, 'item_resolved', {"type": "PARTIDA", "item": partida.model_dump()})
                    global_order += 1
                except Exception as item_err:
                    logger.error(
                        f"[pricing] Item {code} descartado por error de validación: {type(item_err).__name__}: {item_err}"
                    )
                    self._emit(budget_id, 'item_skipped', {
                        "code": code,
                        "reason": str(item_err),
                        "error_type": type(item_err).__name__,
                    })
                    continue
                
        self._emit(budget_id, 'batch_pricing_completed', {"query": "Swarm finalizado. Ensamblando Presupuesto Real..."})
        return priced_partidas

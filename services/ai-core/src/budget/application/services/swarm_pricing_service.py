import logging
import asyncio
import json
import os
import time
import uuid
import inspect
from typing import Awaitable, Callable, List, Dict, Any, Optional, Literal
from pydantic import BaseModel, Field

from src.budget.application.ports.ports import ILLMProvider, IVectorSearch, IGenerationEmitter
from src.budget.application.services.pdf_extractor_service import RestructuredItem
from src.budget.catalog.application.services.catalog_lookup_service import CatalogLookupService
from src.budget.catalog.application.services.hybrid_catalog_search import HybridCatalogSearch
from src.budget.catalog.application.ports.price_book_repository import IPriceBookRepository
from src.budget.catalog.domain.construction_dag import ConstructionDag
from src.budget.domain.entities import BudgetPartida, AIResolution, OriginalItem, BudgetBreakdownComponent, HeuristicFragment
from src.budget.application.services.reconciliation import reconcile_breakdown
from src.budget.application.services.breakdown_normalizer import normalize_breakdown_quantities
from src.budget.application.services.pricing_cache import PricingCache
from src.budget.application.services.calibration_service import (
    CalibrationService,
    normalize_chapter_key,
)
from src.budget.application.services.from_scratch_compositor import FromScratchCompositor
from src.budget.infrastructure.adapters.reranking.bge_reranker import (
    BgeReranker,
    is_enabled as _bge_is_enabled,
)
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

# S1-A-07 — concurrencia del swarm de pricing. Configurable vía
# ``SWARM_CONCURRENCY`` (default 8). El valor previo era 4, que el incidente
# 2026-05-18 demostró insuficiente (los 4 slots se atascaron en Pro/503).
# Con Flash como default (S1-A-01) + timeout (S1-A-06), 8 es seguro.
_DEFAULT_SWARM_CONCURRENCY: int = 8


def _read_swarm_concurrency() -> int:
    """Lee ``SWARM_CONCURRENCY`` del entorno; sanity [1, 64]; default 8."""
    raw = (os.environ.get("SWARM_CONCURRENCY") or "").strip()
    if not raw:
        return _DEFAULT_SWARM_CONCURRENCY
    try:
        v = int(raw)
        if v < 1 or v > 64:
            logger.warning(
                "SWARM_CONCURRENCY=%s fuera de rango [1,64]; usando default %d",
                raw, _DEFAULT_SWARM_CONCURRENCY,
            )
            return _DEFAULT_SWARM_CONCURRENCY
        return v
    except ValueError:
        logger.warning(
            "SWARM_CONCURRENCY=%s no es int válido; usando default %d",
            raw, _DEFAULT_SWARM_CONCURRENCY,
        )
        return _DEFAULT_SWARM_CONCURRENCY


def _env_truthy(value: Optional[str]) -> bool:
    """Helper to interpret env-var strings as boolean flags.

    Accepts the common conventions: "1", "true", "yes", "on" (case-insensitive)
    are truthy; everything else (including unset / empty) is falsy.
    """
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _resolve_pricing_model(
    suggested_tier: str,
    *,
    env: Optional[Dict[str, str]] = None,
) -> tuple[str, str]:
    """S1-A-01 — Sprint 1 hotfix: decide qué modelo Gemini ejecuta el pricing.

    Política post-incidente 2026-05-18:
      - **Default: Flash siempre.** Pro queda fuera del camino caliente.
      - Pro requiere opt-in EXPLÍCITO via env var ``ENABLE_PRO_PRICING=true``.
      - La env var legacy ``FORCE_FLASH_PRICING`` se mantiene como alias
        deprecado: cuando está set a truthy se ignora silenciosamente porque
        Flash ya es el default; cuando está set a falsy y ``ENABLE_PRO_PRICING``
        no está set, sigue mandando Flash (compat con configuración previa).
      - ``suggested_tier`` viene de ``_select_tier`` y se usa SOLO para
        telemetría — no para elegir el modelo real.

    Devuelve ``(model_id, reason)`` para que el caller pueda loggearlo.

    Args:
      suggested_tier: lo que la heurística ``_select_tier`` recomendaría.
        Usado solo para construir la razón (telemetría).
      env: mapping de env vars inyectable para tests. Default: ``os.environ``.

    Returns:
      Tupla ``(model_id, reason)``. ``model_id`` es uno de:
        - ``"gemini-2.5-flash"`` (default, casi siempre)
        - ``"gemini-2.5-pro"`` (solo con ENABLE_PRO_PRICING=true Y
          ``suggested_tier == "pro"``)
    """
    resolved_env: Dict[str, str] = dict(env) if env is not None else dict(os.environ)
    enable_pro = _env_truthy(resolved_env.get("ENABLE_PRO_PRICING"))
    force_flash_legacy = _env_truthy(resolved_env.get("FORCE_FLASH_PRICING"))

    if enable_pro:
        # Opt-in explícito a Pro. La heurística decide tier libremente.
        if suggested_tier == "pro":
            return MODEL_PRO, (
                "ENABLE_PRO_PRICING=true y suggested_tier=pro → Pro (opt-in)"
            )
        return MODEL_FLASH, (
            f"ENABLE_PRO_PRICING=true pero suggested_tier={suggested_tier} → Flash"
        )

    # Default post-hotfix: SIEMPRE Flash. Documentamos en la razón si la
    # heurística "habría querido" Pro para que la telemetría lo refleje.
    if force_flash_legacy:
        reason = (
            f"Flash forzado (default); suggested_tier={suggested_tier}; "
            f"FORCE_FLASH_PRICING=true (alias deprecado, redundante)"
        )
    else:
        reason = (
            f"Flash default post-hotfix; suggested_tier={suggested_tier}; "
            f"ENABLE_PRO_PRICING no activado"
        )
    return MODEL_FLASH, reason




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


# S1-A-05 — capítulos que NO aportan señal estructural y por tanto no se
# usan como filtro pre-vector (el filtro degradaría la cobertura del
# retrieval sin reducir ruido). Coincide con la lista que ``stabilize_chapter_name``
# considera alucinación o sin valor.
_LOW_CONFIDENCE_CHAPTERS: set = {
    "VARIOS",
    "VARIOS Y OTROS",
    "[UNKNOWN]",
    "SIN CAPÍTULO",
    "SIN CAPITULO",
    "OTROS",
    "GENERAL",
}


def _derive_structural_filters(item: RestructuredItem) -> Dict[str, Optional[str]]:
    """S1-A-05 — Construye filtros estructurales pre-vector para una partida.

    Reduce el espacio de búsqueda al BM25/vector limitándolos a:
      - el ``chapter`` cuando es confiable (no está en ``_LOW_CONFIDENCE_CHAPTERS``
        y no contiene marcadores de alucinación);
      - la ``unit_dimension`` cuando la partida la tiene clara.

    Ambos filtros son opcionales: cuando faltan, el retrieval cae al
    comportamiento original (sin filtro).
    """
    chapter_filter: Optional[str] = None
    raw_chapter = (item.chapter or "").strip()
    if raw_chapter:
        upper = raw_chapter.upper()
        is_hallucination = any(
            marker in upper
            for marker in ("[", "NOT FOUND", "NO ESPECIFICADO", "NO IDENTIFICADO",
                          "NO ENCONTRADO", "UNKNOWN", "UNDEFINED")
        )
        if not is_hallucination and upper not in _LOW_CONFIDENCE_CHAPTERS:
            chapter_filter = raw_chapter

    unit_dimension_filter: Optional[str] = item.unit_dimension or None
    return {
        "chapter_filter": chapter_filter,
        "unit_dimension_filter": unit_dimension_filter,
    }


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


# ---------------------------------------------------------------------------
# Sprint 1 (S1-B-01) — telemetry aggregators
#
# Pure helpers used by `evaluate_batch` to populate `job_metrics_final`. They
# accept the raw per-partida telemetry list (built by `partida_resolved_v2`
# emits) and return aggregates the admin UI consumes for cost/latency/quality
# KPIs. Kept at module level so the test suite can target them directly.
# ---------------------------------------------------------------------------
def _calc_cache_hit_rate(resolved_telemetry: List[Dict[str, Any]]) -> float:
    """Fraction of partidas whose pricing came from the cache (0.0..1.0).

    `cache_hit` may be None for entries emitted before Agent A's S1-A-04
    cache integration lands; those are excluded from both numerator and
    denominator so the rate is meaningful once data is available.
    """
    eligible = [t for t in resolved_telemetry if t.get('cache_hit') is not None]
    if not eligible:
        return 0.0
    hits = sum(1 for t in eligible if t.get('cache_hit') is True)
    return round(hits / len(eligible), 4)


def _calc_percentile(samples: List[float], pct: int) -> float:
    """Return the `pct` percentile (0-100) of `samples` using a linear
    interpolation between adjacent ranks. Empty input returns 0.0; degenerate
    `pct` is clamped to [0, 100]. Used to surface latency_p50/p95 in the
    `job_metrics_final` payload without pulling in numpy as a dependency.
    """
    if not samples:
        return 0.0
    pct = max(0, min(100, int(pct)))
    ordered = sorted(float(s or 0) for s in samples)
    if len(ordered) == 1:
        return round(ordered[0], 2)
    rank = (pct / 100.0) * (len(ordered) - 1)
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    fraction = rank - low
    value = ordered[low] + (ordered[high] - ordered[low]) * fraction
    return round(value, 2)


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
        price_book_repo: Optional[IPriceBookRepository] = None,
        hybrid_search: Optional[HybridCatalogSearch] = None,
        reranker: Optional[BgeReranker] = None,
        pricing_cache: Optional[PricingCache] = None,
        compositor: Optional[FromScratchCompositor] = None,
        calibration_service: Optional[CalibrationService] = None,
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
        # Phase 17.8 — Frente D: heredar breakdown del catálogo en match 1:1
        # cuando val.breakdown está vacío. Opcional para backward-compat con
        # tests; si ausente, no se hereda.
        self.price_book_repo = price_book_repo
        # S1-A-02 — Hybrid BM25+Vector+RRF. Opcional para backward-compat:
        # cuando es None, el swarm usa solo el vector search puro (path legacy);
        # cuando se inyecta, el swarm combina BM25 in-memory con el vector y
        # mezcla por RRF antes de reranquear.
        self.hybrid_search = hybrid_search
        # S1-A-03 — Cross-encoder reranker (BAAI/bge-reranker-v2-m3 local).
        # Opcional para tests offline; cuando es None, el rerank sigue siendo
        # vía Flash. En producción se inyecta vía `dependencies.py`.
        self.reranker = reranker
        # S1-A-04 — Caché de pricing por hash (descripción + unidad). Opcional;
        # cuando es None, el swarm no consulta ni persiste cache (camino legacy).
        self.pricing_cache = pricing_cache
        # Fase 2 — compositor de partidas from_scratch (labor_rates +
        # material_catalog). Opcional: cuando es None, from_scratch mantiene el
        # precio estimado por el LLM (camino legacy).
        self.compositor = compositor
        # Calibración (catálogo → constructor real). Opcional para
        # backward-compat: cuando es None, la calibración es no-op (factor 1.0)
        # y el pricer devuelve el PEM del catálogo sin escalar. Cuando se
        # inyecta, la tabla se carga UNA vez por batch (como pricing_cache) y se
        # aplica al PEM antes de bakear GG+BI.
        self.calibration_service = calibration_service

    async def _rerank_candidates(
        self,
        candidates: List[Dict[str, Any]],
        partida_description: str,
        partida_unit: Optional[str],
    ) -> List[Dict[str, Any]]:
        """Fase 9.4 — re-rank intermedio. Si hay ≥ 4 candidatos, llama al
        reranker para reducir a top-3.

        S1-A-03: si ``self.reranker`` (BgeReranker) está inyectado, se usa
        el cross-encoder local (~50-200ms, $0/partida). Si no, se cae al
        path con Gemini Flash (legacy, ~500ms-1s, $0.01/partida).

        S2-A-00: kill-switch via ``ENABLE_BGE_RERANK=false`` salta el
        rerank por completo y devuelve los top-3 del hybrid search
        directamente (asumiendo que ya viene ordenado por score). Si hay
        ≤ 3 candidatos: passthrough sin reranker (no aporta valor).
        Cualquier fallo: passthrough con los originales (no se rompe el pipeline).
        IDs inventados por el LLM se descartan defensivamente.
        """
        if len(candidates) <= 3:
            return candidates

        # S2-A-00 — kill-switch. Si BGE rerank está desactivado por env,
        # devolvemos los top-3 del hybrid search sin pasar por el LLM ni
        # por el cross-encoder. Útil para A/B y emergencias.
        if not _bge_is_enabled():
            logger.info(
                "[BgeReranker] disabled by ENABLE_BGE_RERANK=false; "
                "returning top-3 from hybrid search"
            )
            return candidates[:3]

        # S1-A-03 — cross-encoder local path.
        if self.reranker is not None:
            try:
                ranked = self.reranker.rerank(
                    query=f"{partida_description} ({partida_unit or '?'})",
                    candidates=candidates,
                    top_n=3,
                )
                # `ranked` es lista de (cand_dict, score). Reconstruimos solo
                # la secuencia ordenada de candidatos. Si vino vacía, fallback.
                reranked_cands = [c for c, _ in ranked]
                if reranked_cands:
                    return reranked_cands
            except Exception as e:
                logger.warning(
                    f"[BgeReranker] rerank crashed ({type(e).__name__}: {e}); "
                    f"falling back to Flash rerank."
                )
            # Cualquier fallo → caemos al path Flash.

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

        # Cambio #1 — la descripción CRUDA es SIEMPRE la query primaria.
        # Validado empíricamente (muestreo aleatorio, 5 proyectos): la
        # descripción completa gana o empata a la reformulación en el 93% de
        # las partidas (+0.07 de coseno de media) y evita la deriva de
        # capítulo que provoca la fragmentación en "oficios atómicos". Las
        # sub-queries atómicas se conservan SOLO como SUPLEMENTO para
        # descubrir componentes en partidas compuestas (1:N) — nunca
        # reemplazan a la cruda.
        raw_query = f"{item.description} {item.unit}"
        if res and res.queries and res.is_complex:
            supplements: List[str] = []
            for q in res.queries:
                if q and q != raw_query and q not in supplements:
                    supplements.append(q)
            return [raw_query, *supplements]
        return [raw_query]

    # --- 2. Enjambre Vectorial DB ---
    async def _firestore_vector_swarm(
        self,
        queries: List[str],
        partida_unit_dimension: Optional[str] = None,
        *,
        chapter_filter: Optional[str] = None,
    ) -> List[Dict]:
        """Resolver candidatos del catálogo por una o más subqueries.

        S1-A-02: si ``self.hybrid_search`` está inyectado, cada subquery se
        resuelve combinando BM25 in-memory + vector search + RRF
        (``HybridCatalogSearch.search``). Si no, fallback al vector search
        directo (path legacy, mantenido para backward-compat con tests que
        no inyectan hybrid).
        """
        if not queries:
            return []

        # Fase 9.6 — paralelizar embeddings + vector_search por subquery.
        # Antes (secuencial): 3 queries × (100ms embed + 100ms search) ~600ms.
        # Ahora (paralelo): max(...) ~200ms. Speedup ~3× en partidas con
        # múltiples sub-queries (típico en 1:N).
        async def _fetch_one(q: str) -> tuple[str, List[Dict]]:
            try:
                vector = await self.llm.get_embedding(q)
                if self.hybrid_search is not None:
                    # S1-A-02 — path híbrido: BM25 + vector + RRF.
                    cands = await self.hybrid_search.search(
                        query=q,
                        query_vector=vector,
                        top_k=15,
                        chapter_filter=chapter_filter,
                        unit_dimension_filter=partida_unit_dimension,
                    )
                else:
                    # Path legacy.
                    # S1-A-05 — propagamos chapter_filter al adapter legacy
                    # también; el adapter Firestore acepta `chapter_filters` (lista).
                    legacy_chapter_filters = (
                        [chapter_filter] if chapter_filter else None
                    )
                    res = self.vector_search.search_similar_items(
                        query_vector=vector,
                        query_text=q,
                        limit=4,
                        chapter_filters=legacy_chapter_filters,
                        partida_unit_dimension=partida_unit_dimension,
                    )
                    cands = await res if inspect.isawaitable(res) else (res or [])
                return q, cands or []
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
                cid = c.get('id') or c.get('code')
                if cid and cid not in seen_ids:
                    seen_ids.add(cid)
                    c["__query_origin"] = q
                    all_candidates.append(c)

        # Limitar para no saturar contextos enormes.
        all_candidates.sort(key=lambda x: x.get('matchScore', 0), reverse=True)
        return all_candidates[:15]

    # --- 3. Ejecución Orquestada de Pricing (Public Method) ---
    async def evaluate_batch(
        self,
        items: List[RestructuredItem],
        budget_id: str,
        metrics: Dict,
        *,
        resume_from: Optional[List[BudgetPartida]] = None,
        on_partida_resolved: Optional[Callable[[BudgetPartida], Awaitable[None]]] = None,
        cancellation_event: Optional[asyncio.Event] = None,
    ) -> List[BudgetPartida]:
        """Price every item in `items` against the swarm; return the resolved
        partidas.

        New (P4.b): checkpoint-aware resume. When called by
        `RunPipelineJobUseCase` after a retry, the caller passes:

          - `resume_from`: partidas already resolved by a prior attempt.
            Their `code`s are filtered out of `items` BEFORE any LLM call,
            saving the full Gemini cost.
          - `on_partida_resolved`: invoked once per newly-resolved partida
            so the use case can persist a Firestore checkpoint atomically.
            If it raises, the partida is still emitted; the caller is
            responsible for handling persistence failure.

        Calling without either kwarg preserves the legacy behaviour, so
        the existing extractor / NL UC paths are untouched.

        Sprint 1 (S1-B-01): emits `partida_resolved_v2` per resolved partida
        with tier/tokens/match_kind context and a `job_metrics_final` event
        in a `finally` block so the admin job-detail page always has KPIs
        even when the swarm partially fails. Hooks marked `# TODO: connect
        to S1-A-04` are placeholders for Agent A's per-partida cost/latency
        cache integration (separate iteration).
        """
        _start = time.monotonic()
        # Populated alongside each `partida_resolved_v2` emit so we can
        # compute aggregated KPIs (cache hit rate, p50/p95 latency, tier
        # counts) for `job_metrics_final` even on partial failure paths.
        _resolved_telemetry: List[Dict[str, Any]] = []
        # Per-chunk tier metadata captured inside the `evaluate_chunk`
        # closure (populated once the tier is selected) and read at
        # assembly time when we materialise BudgetPartida instances.
        _tier_per_code: Dict[str, Dict[str, str]] = {}

        try:
            return await self._evaluate_batch_inner(
                items=items,
                budget_id=budget_id,
                metrics=metrics,
                resume_from=resume_from or [],
                on_partida_resolved=on_partida_resolved,
                _resolved_telemetry=_resolved_telemetry,
                _tier_per_code=_tier_per_code,
                cancellation_event=cancellation_event,
            )
        finally:
            duration_seconds = time.monotonic() - _start
            try:
                self._emit(budget_id, 'job_metrics_final', {
                    'total_tokens_in': metrics.get('prompt', 0),
                    'total_tokens_out': metrics.get('completion', 0),
                    'total_cost_usd': metrics.get('cost', 0),
                    'duration_seconds': round(duration_seconds, 2),
                    'partidas_total': len(_resolved_telemetry),
                    'cache_hit_rate': _calc_cache_hit_rate(_resolved_telemetry),
                    'latency_p50': _calc_percentile(
                        [t.get('latency_ms', 0) for t in _resolved_telemetry], 50
                    ),
                    'latency_p95': _calc_percentile(
                        [t.get('latency_ms', 0) for t in _resolved_telemetry], 95
                    ),
                    'tier_flash_count': sum(
                        1 for t in _resolved_telemetry if t.get('tier_used') == 'flash'
                    ),
                    'tier_pro_count': sum(
                        1 for t in _resolved_telemetry if t.get('tier_used') == 'pro'
                    ),
                    'needs_review_count': sum(
                        1 for t in _resolved_telemetry if t.get('match_kind') == 'needs_review'
                    ),
                })
            except Exception as _final_err:
                # Never let telemetry break the swarm contract. Log and move on.
                logger.warning(
                    f"[telemetry] job_metrics_final emit failed: "
                    f"{type(_final_err).__name__}: {_final_err}"
                )

    async def _evaluate_batch_inner(
        self,
        items: List[RestructuredItem],
        budget_id: str,
        metrics: Dict,
        resume_from: List[BudgetPartida],
        on_partida_resolved: Optional[Callable[[BudgetPartida], Awaitable[None]]],
        _resolved_telemetry: List[Dict[str, Any]],
        _tier_per_code: Dict[str, Dict[str, str]],
        cancellation_event: Optional[asyncio.Event] = None,
    ) -> List[BudgetPartida]:
        """Original `evaluate_batch` body extracted verbatim. Wrapped by the
        public `evaluate_batch` so we can guarantee `job_metrics_final`
        emission via a `try`/`finally` even on partial failure. Two new
        keyword args (`_resolved_telemetry`, `_tier_per_code`) are populated
        as side effects for the outer aggregator.
        """
        # S2-A-01 — early-out: si el evento ya está set antes de empezar,
        # no quemamos ni tokens de extracción de candidates.
        if cancellation_event is not None and cancellation_event.is_set():
            self._emit(budget_id, 'cancellation_acknowledged', {
                "stage": "pricing_start",
                "items_total": len(items),
            })
            raise asyncio.CancelledError(
                "swarm_pricing: cancellation_event set before start"
            )

        # Calibración (catálogo → constructor real): la tabla se carga UNA vez
        # por batch (como pricing_cache), no por partida. Non-fatal / AI-First:
        # si el service no está inyectado o Firestore falla, `load()` cae a
        # code-defaults; si la tabla es None (service ausente), la calibración
        # es no-op (factor 1.0) partida a partida.
        calibration_table = None
        if self.calibration_service is not None:
            try:
                calibration_table = await self.calibration_service.load()
            except Exception as _cal_load_err:  # pragma: no cover - load ya es defensivo
                logger.warning(
                    f"[calibration] load failed ({type(_cal_load_err).__name__}: "
                    f"{_cal_load_err}); calibration disabled for this batch"
                )
                calibration_table = None

        resumed_codes = {p.code for p in resume_from if p.code}
        if resumed_codes:
            before = len(items)
            items = [i for i in items if (i.code or "") not in resumed_codes]
            skipped = before - len(items)
            if skipped > 0:
                logger.info(
                    f"Swarm resume: skipping {skipped}/{before} items already "
                    f"resolved in prior attempts."
                )
                self._emit(
                    budget_id,
                    'resume_from_checkpoints',
                    {"resumed_count": skipped, "remaining_count": len(items)},
                )

        # S1-A-04 — Cache lookup en lote ANTES del swarm.
        # Para cada item, intentamos un hit de cache; los que aciertan no
        # entran al swarm. Estado para enriquecer `item_resolved` después:
        cache_metadata_by_code: Dict[str, Dict[str, Any]] = {}
        cached_partidas: List[BudgetPartida] = []
        if self.pricing_cache is not None and items:
            remaining: List[RestructuredItem] = []
            for it in items:
                lookup_start = time.monotonic()
                try:
                    hit = await self.pricing_cache.lookup(
                        description=it.description, unit=it.unit,
                    )
                except Exception as e:
                    logger.warning(f"[cache] lookup crashed for {it.code}: {e}")
                    hit = None
                lookup_ms = int((time.monotonic() - lookup_start) * 1000)
                if hit is not None:
                    # Cache hit: short-circuit, no LLM call.
                    cache_metadata_by_code[it.code or ""] = {
                        "cache_hit": True,
                        "cost_usd": 0.0,
                        "latency_ms": lookup_ms,
                    }
                    # Reconstruimos un BudgetPartida desde el payload cacheado.
                    # `partida` viene como dict de `model_dump()` previo.
                    try:
                        partida = BudgetPartida.model_validate(hit.partida)
                        cached_partidas.append(partida)
                        self._emit(budget_id, 'pricing_cache_hit', {
                            "code": it.code,
                            "hash": hit.hash[:16],
                            "hits_count": hit.hits_count,
                            "confidence_score": hit.confidence_score,
                            "latency_ms": lookup_ms,
                        })
                    except Exception as build_err:
                        # Si el doc cacheado está corrupto, lo ignoramos y
                        # reprocesamos vía swarm (no rompemos el batch).
                        logger.warning(
                            f"[cache] hit for {it.code} no parsea como "
                            f"BudgetPartida: {build_err}; reprocesando."
                        )
                        remaining.append(it)
                else:
                    cache_metadata_by_code[it.code or ""] = {
                        "cache_hit": False,
                        "cost_usd": None,  # poblado tras el LLM swarm
                        "latency_ms": None,
                        "lookup_ms": lookup_ms,
                    }
                    remaining.append(it)
            items = remaining
            if cached_partidas:
                self._emit(budget_id, 'pricing_cache_batch_summary', {
                    "cache_hits": len(cached_partidas),
                    "cache_misses": len(items),
                    "hit_rate": (
                        len(cached_partidas)
                        / (len(cached_partidas) + len(items))
                        if (len(cached_partidas) + len(items)) > 0
                        else 0.0
                    ),
                })
                # Emitimos `item_resolved` para cada partida cacheada con
                # `cache_hit=True` para que Agent B pueda enriquecer
                # `partida_resolved_v2` con métricas reales. También invocamos
                # el callback `on_partida_resolved` para que el use case
                # persista checkpoint (mismo flujo que las resueltas vía LLM).
                for cached_partida in cached_partidas:
                    code = cached_partida.code or ""
                    meta = cache_metadata_by_code.get(code, {})
                    self._emit(budget_id, 'item_resolved', {
                        "type": "PARTIDA",
                        "item": cached_partida.model_dump(),
                        "pricing_metadata": {
                            "cache_hit": True,
                            "cost_usd": 0.0,
                            "latency_ms": meta.get("latency_ms", 0),
                            "match_kind": cached_partida.match_kind,
                        },
                    })

                    # Sprint 1 (S1-B-01 follow-up) — strongly-typed companion
                    # event for the cache-hit path so admin job-detail KPIs
                    # cuentan cache hits en su agregado (cache_hit_rate, latency).
                    _cached_telemetry = {
                        'code': cached_partida.code,
                        'tier_used': 'cache',
                        'tier_reason': 'cache_hit',
                        'tokens_in': 0,
                        'tokens_out': 0,
                        'cost_usd': 0.0,
                        'latency_ms': meta.get("latency_ms", 0),
                        'cache_hit': True,
                        'match_kind': cached_partida.match_kind,
                        'confidence_score': cached_partida.matchConfidence,
                    }
                    self._emit(budget_id, 'partida_resolved_v2', _cached_telemetry)
                    _resolved_telemetry.append(_cached_telemetry)

                    if on_partida_resolved is not None:
                        try:
                            await on_partida_resolved(cached_partida)
                        except Exception as cb_err:
                            logger.warning(
                                f"[pricing] on_partida_resolved callback failed "
                                f"for cached {cached_partida.code}: "
                                f"{type(cb_err).__name__}: {cb_err}"
                            )

        logger.info(f"Starting Swarm Pricing Phase for {len(items)} items...")
        self._emit(budget_id, 'vector_search_started', {"query": f"Invocando al cerebro Flash para romper {len(items)} partidas en queries atómicas..."})

        # S1-A-04 — snapshot per-item start time + pre-call cost para poder
        # calcular `cost_usd` y `latency_ms` por partida cuando el LLM la
        # resuelva. Para cache misses únicamente.
        item_start_times: Dict[str, float] = {}
        item_pre_call_cost: Dict[str, float] = {}
        for it in items:
            code = it.code or ""
            item_start_times[code] = time.monotonic()
            item_pre_call_cost[code] = float(metrics.get("cost") or 0.0)

        # Obtenemos candidatos masivos
        async def fetch_item_candidates(item: RestructuredItem):
            queries = await self._analyze_and_deconstruct(item, metrics)
            # S1-A-05 — Filtros estructurales pre-vector. Reducen el pool de
            # candidatos antes del retrieval, lo que ahorra coste en partidas
            # con `chapter` confiable (la mayoría tras `stabilize_chapter_name`).
            filters = _derive_structural_filters(item)
            chapter_filter = filters["chapter_filter"]
            unit_dim_filter = filters["unit_dimension_filter"]
            # Trazabilidad post-filter para validar la reducción de ≥30% que
            # menciona el plan. ``candidates`` ya viene filtrado por la propia
            # query; aquí solo emitimos los filtros aplicados.
            self._emit(budget_id, 'structural_filters_applied', {
                "code": item.code,
                "chapter_filter": chapter_filter,
                "unit_dimension_filter": unit_dim_filter,
            })
            candidates = await self._firestore_vector_swarm(
                queries,
                partida_unit_dimension=unit_dim_filter,
                chapter_filter=chapter_filter,
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

        # S2-A-00 — fast path: si tenemos BGE inyectado Y el kill-switch
        # está ON, hacemos un solo `batch_rerank` con TODOS los pairs
        # (partidas concurrentes × max 5 candidates c/u) en un solo
        # forward pass del cross-encoder. Speedup esperado: ~6-8x vs
        # 1 rerank por partida.
        use_batch_rerank = (
            self.reranker is not None
            and _bge_is_enabled()
            and len(items_with_cands) > 1
        )
        if use_batch_rerank:
            # Construimos la lista de (query, candidates) solo para las
            # partidas que pasan el threshold de >3 candidates (el resto
            # son passthrough sin rerank, igual que single-item path).
            rerankable: List[tuple[RestructuredItem, List[Dict[str, Any]]]] = []
            passthrough: List[tuple[RestructuredItem, List[Dict[str, Any]]]] = []
            for it, cs in items_with_cands:
                if len(cs) > 3:
                    rerankable.append((it, cs))
                else:
                    passthrough.append((it, cs))

            try:
                if rerankable:
                    queries_with_cands = [
                        (
                            f"{(it.description or '')} ({it.unit or '?'})",
                            cs,
                        )
                        for it, cs in rerankable
                    ]
                    # Llamada única — el cross-encoder hace batching nativo.
                    batched = await asyncio.to_thread(
                        self.reranker.batch_rerank,
                        queries_with_cands,
                        top_n=3,
                    )
                    reranked_pairs_batched: List[tuple[Any, List[Dict[str, Any]]]] = []
                    for (it, original_cs), ranked in zip(rerankable, batched):
                        reranked_cands = [c for c, _ in ranked] if ranked else original_cs[:3]
                        if not reranked_cands:
                            reranked_cands = original_cs[:3]
                        self._emit(budget_id, 'rerank_applied', {
                            "code": it.code,
                            "input_size": len(original_cs),
                            "output_size": len(reranked_cands),
                            "selected_ids": [c.get("id") for c in reranked_cands],
                            "batched": True,
                        })
                        reranked_pairs_batched.append((it, reranked_cands))
                    reranked_pairs = list(reranked_pairs_batched) + list(passthrough)
                else:
                    # Nada que rerankear: passthrough completo.
                    reranked_pairs = list(passthrough)
            except Exception as e:
                # Si el batch revienta, caemos al path uno-a-uno por
                # robustez. No queremos que un crash en batching tumbe
                # un job de 74 partidas.
                logger.warning(
                    f"[BgeReranker] batch_rerank failed ({type(e).__name__}: {e}); "
                    f"falling back to per-item rerank"
                )
                rerank_tasks = [_rerank_for_item(it, cs) for it, cs in items_with_cands]
                reranked_pairs = await asyncio.gather(*rerank_tasks)
        else:
            # Path legacy / single-item / kill-switch off: uno por uno.
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
        # S1-A-07 — concurrencia del swarm configurable. Default 8 (era 4
        # hardcodeado). Con Flash como default + timeout por llamada, 8 slots
        # son seguros y duplican el throughput sin saturar la API.
        swarm_concurrency = _read_swarm_concurrency()
        logger.info(f"[swarm] concurrency={swarm_concurrency}")
        self._emit(budget_id, 'swarm_concurrency_set', {"value": swarm_concurrency})
        semaphore_pricing = asyncio.Semaphore(swarm_concurrency)

        # Fase 14.B — PEM acumulado por capítulo, poblado tras la 1ª pasada
        # (no-medios) y leído por evaluate_chunk en la 2ª pasada (medios).
        # Se captura por referencia en el closure; medios se procesan en una
        # segunda pasada secuencial post-resto, con este dict ya poblado.
        chapter_pem_for_medios: Dict[str, float] = {}

        async def evaluate_chunk(chunk_idx: int, task_group: List[Dict]):
            async with semaphore_pricing:
                # S2-A-01 — cooperative cancellation check between partidas.
                # El runner crea un `asyncio.Event` y un poller que lo flipea
                # cuando Firestore tiene `cancellation_requested=true`. Aquí
                # checkeamos ANTES de cada partida nueva — si el event está
                # set, paramos limpio sin gastar más tokens.
                if cancellation_event is not None and cancellation_event.is_set():
                    self._emit(budget_id, 'cancellation_acknowledged', {
                        "stage": "pricing",
                        "code": task_group[0]["id"] if task_group else None,
                    })
                    raise asyncio.CancelledError(
                        "swarm_pricing: cancellation_event set; aborting chunk"
                    )

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
                #
                # S1-A-01 — `tier` ya NO selecciona el modelo: es solo
                # telemetría. El modelo real lo decide ``_resolve_pricing_model``
                # con default Flash y opt-in via ``ENABLE_PRO_PRICING=true``.
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
                # S1-A-01 — resolución real del modelo. La heurística queda
                # como hint para análisis post-mortem ("este caso ¿habría ido
                # a Pro si fuese opt-in?") pero el modelo concreto se decide
                # vía env vars para que el flip humano sea sin redeploy.
                model_to_use, model_reason = _resolve_pricing_model(tier)
                self._emit(budget_id, 'pricing_model_resolved', {
                    "code": first_code,
                    "model": model_to_use,
                    "suggested_tier": tier,
                    "reason": model_reason,
                })

                # S2-A-06 — fix tier display. Antes este populate inicial
                # guardaba `tier=suggested_tier` (lo que la heurística
                # recomendaría), no el modelo REAL ejecutado. Resultado:
                # el panel admin reportaba "Pro: 74" cuando todos fueron
                # Flash (coste $0.05 confirmaba el bug). Ahora guardamos:
                #   - `tier`: modelo REAL que se va a ejecutar (flash o
                #     pro según `_resolve_pricing_model`).
                #   - `suggested_tier`: lo que la heurística recomendaría
                #     (telemetry/análisis post-mortem).
                #   - `reason`: razón conjunta (model_reason + tier_reason).
                #
                # Si más adelante hay escalation Flash→Pro (ENABLE_PRO_PRICING
                # + needs_human_review), el populate de la rama de
                # escalation sobreescribe `tier="pro"` ahí.
                actual_tier = "pro" if model_to_use == MODEL_PRO else "flash"
                for _task in task_group:
                    _tier_per_code[_task["id"]] = {
                        "tier": actual_tier,
                        "suggested_tier": tier,
                        "reason": (
                            f"{model_reason}; heuristic suggested={tier}: {tier_reason}"
                        ),
                    }

                # Respetando cuota
                await asyncio.sleep(1.0)
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
                #
                # S1-A-01 — la escalation a Pro ahora SOLO se ejecuta cuando
                # ``ENABLE_PRO_PRICING=true``. Sin opt-in mantenemos el
                # resultado de Flash (puede traer ``needs_human_review`` para
                # que el editor lo marque manualmente) y emitimos un evento
                # ``tier_escalation_suppressed`` para análisis post-mortem.
                needs_escalation = False
                if model_to_use == MODEL_FLASH and eval_res and eval_res.results:
                    val = eval_res.results[0].valuation
                    if val.match_kind == "from_scratch" or val.needs_human_review:
                        needs_escalation = True

                if needs_escalation:
                    if _env_truthy(os.environ.get("ENABLE_PRO_PRICING")):
                        self._emit(budget_id, 'tier_escalated', {
                            "code": first_code,
                            "from_tier": "flash",
                            "to_tier": "pro",
                            "reason": (
                                f"flash devolvió match_kind={eval_res.results[0].valuation.match_kind} "
                                f"needs_review={eval_res.results[0].valuation.needs_human_review} "
                                f"→ re-tasando con Pro (ENABLE_PRO_PRICING=true)"
                            ),
                        })
                        # Sprint 1 (S1-B-01) — reflect the escalation in the
                        # tier map so the final telemetry attributes the partida
                        # to Pro (the model that actually produced the result).
                        # S2-A-06 — preservamos `suggested_tier="flash"` (lo que
                        # la heurística pensaba originalmente) y marcamos
                        # `tier="pro"` (lo que realmente se ejecutó tras escalation).
                        for _task in task_group:
                            _tier_per_code[_task["id"]] = {
                                "tier": "pro",
                                "suggested_tier": "flash",
                                "reason": f"escalated from flash to pro: {tier_reason}",
                            }
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
                    else:
                        # Sin opt-in, dejamos el resultado de Flash con su
                        # ``needs_human_review`` para que el editor lo revise.
                        self._emit(budget_id, 'tier_escalation_suppressed', {
                            "code": first_code,
                            "would_be_escalated_to": "pro",
                            "match_kind": eval_res.results[0].valuation.match_kind,
                            "needs_review": eval_res.results[0].valuation.needs_human_review,
                            "reason": (
                                "ENABLE_PRO_PRICING no activado; "
                                "Flash resultado conservado para revisión manual"
                            ),
                        })

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
        # S2-A-01 — si alguno raiseó CancelledError, propagamos para
        # abortar limpio. Los gather() con return_exceptions=True devuelven
        # CancelledError como objeto en la lista (no lo re-raisean).
        for res in non_medios_results:
            if isinstance(res, asyncio.CancelledError):
                raise res
        for (idx, _), res in zip(non_medios_indexed, non_medios_results):
            results_group[idx] = res

        # Calcular PEM acumulado por capítulo desde resultados pass 1.
        if medios_indexed:
            for res in non_medios_results:
                if isinstance(res, (Exception, asyncio.CancelledError)):
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
            # S2-A-01 — misma protección que pass 1.
            for res in medios_results:
                if isinstance(res, asyncio.CancelledError):
                    raise res
            for (idx, _), res in zip(medios_indexed, medios_results):
                results_group[idx] = res

        # Ensamblaje final de Pydantic Entities
        priced_partidas = []
        global_order = 1

        for chunk_idx, res in enumerate(results_group):
            # S2-A-01 — CancelledError no es subclase de Exception, lo
            # tratamos explícitamente igual que cualquier error.
            if isinstance(res, (Exception, asyncio.CancelledError)) or res is None:
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

                    # Fase 2 — from_scratch: reemplazar el precio ADIVINADO por el
                    # LLM por una composición AUDITABLE (labor_rates +
                    # material_catalog, precios reales). from_scratch va SIEMPRE a
                    # review; el borrador compuesto es el punto de partida.
                    composed_result = None
                    if val.match_kind == "from_scratch" and self.compositor is not None:
                        try:
                            composed_result = await self.compositor.compose(
                                description=safe_description, unit=safe_unit,
                                quantity=safe_quantity,
                            )
                            if composed_result and composed_result.unit_price > 0:
                                final_price = composed_result.unit_price
                            needs_human_review = True
                            self._emit(budget_id, "from_scratch_composed", {
                                "code": safe_code,
                                "unit_price": round(final_price, 2),
                                "components": len(composed_result.breakdown) if composed_result else 0,
                                "is_equipment": (composed_result.plan.is_equipment_supply if composed_result else False),
                                "dimensions": (composed_result.plan.dimensions if composed_result else None),
                                "notes": composed_result.notes if composed_result else [],
                            })
                        except Exception as ce:
                            logger.warning(f"[compositor] compose failed for {safe_code}: {ce}")
                            composed_result = None

                    # ===== Calibración (catálogo → constructor real) =====
                    # Se aplica al PEM (pre-markup) tras asentar `final_price`
                    # (LLM o compositor) y ANTES de la reconciliación de
                    # breakdown (línea ~1827) y del bake GG+BI (order §2):
                    #   PVP = catálogo × calibración × markup × IVA
                    # Excluidos (factor 1.0, pero se registra pre/factor para
                    # transparencia §8):
                    #   - `from_scratch`: su base son tarifas compuestas, no catálogo.
                    #   - BC3 active-source: el precio activo es el del BC3, no la
                    #     estimación IA; no se calibra ni se cosecha corrección.
                    #   - sin tabla inyectada (backward-compat / tests).
                    cal_key = normalize_chapter_key(safe_chapter)
                    cal_pre_price = final_price
                    cal_factor = 1.0
                    cal_source = "none"
                    cal_sample_count = 0
                    _cal_bc3_price = getattr(item, "bc3_unit_price", None)
                    if calibration_table is None:
                        cal_source = "disabled"
                    elif val.match_kind == "from_scratch":
                        cal_source = "excluded:from_scratch"
                    elif _cal_bc3_price is not None:
                        cal_source = "excluded:bc3"
                    else:
                        _eff = calibration_table.effective_factor(cal_key)
                        cal_factor = _eff.factor
                        cal_source = _eff.source
                        cal_sample_count = _eff.sample_count
                        if cal_factor != 1.0 and final_price and final_price > 0:
                            final_price = round(cal_pre_price * cal_factor, 2)
                            # Escala el breakdown del LLM por el mismo factor para
                            # que `reconcile_breakdown` (línea ~1827) no marque una
                            # divergencia falsa. price×yield=total se preserva.
                            if val.breakdown:
                                for _cb in val.breakdown:
                                    if _cb.price is not None:
                                        _cb.price = _cb.price * cal_factor
                                    if _cb.total is not None:
                                        _cb.total = _cb.total * cal_factor
                            self._emit(budget_id, 'calibration_applied', {
                                "code": safe_code,
                                "chapter": cal_key,
                                "factor": cal_factor,
                                "source": cal_source,
                                "sample_count": cal_sample_count,
                                "match_kind": val.match_kind,
                                "price_before": round(cal_pre_price, 2),
                                "price_after": final_price,
                            })

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
                    if val.breakdown and final_price > 0 and composed_result is None:
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

                    if composed_result is not None and composed_result.breakdown:
                        # Fase 2 — breakdown compuesto (labor_rates + material_catalog).
                        for b in composed_result.breakdown:
                            is_pct = (b.get("code") == "%" or b.get("unit") == "%")
                            # El entity no tiene `unit`; el aux '%' se aplana a
                            # componente plano (price=importe, yield=1) para que
                            # price×yield = total sin la convención '%'.
                            b_price = b.get("total", 0.0) if is_pct else b.get("price", 0.0)
                            b_yield = 1.0 if is_pct else (b.get("yield") or b.get("quantity") or 1.0)
                            breakdown_domain.append(BudgetBreakdownComponent(
                                code=b.get("code"),
                                concept=b.get("concept", ""),
                                type=b.get("type", "OTHER"),
                                price=b_price,
                                yield_amount=b_yield,
                                total=b.get("total", 0.0),
                                isSubstituted=False,
                                alternativeComponents=[],
                                is_variable=b.get("is_variable", False),
                            ))
                    elif val.breakdown and len(val.breakdown) > 0:
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

                    # Phase 17.8 — Frente D: si match_kind=='1:1' y el agente NO devolvió
                    # breakdown propio, heredamos el descompuesto del candidato del catálogo.
                    # Esto evita el caso 02.02 (Pintura plástica matched RFP010 sin breakdown).
                    if (
                        not breakdown_domain
                        and val.match_kind == '1:1'
                        and self.price_book_repo is not None
                    ):
                        # Localizar el candidato seleccionado para obtener su code (no `id`).
                        cand_data = next((c for c in candidates if c.get('id') == sel_id_flat), None)
                        cand_code = (cand_data or {}).get('code') or sel_id_flat
                        try:
                            if cand_code:
                                catalog_breakdowns = await self.price_book_repo.find_breakdowns_by_parent(cand_code)
                                if catalog_breakdowns:
                                    for bk in catalog_breakdowns:
                                        # Calibración: el breakdown heredado del
                                        # catálogo es RAW; se escala por el factor
                                        # (no-op si 1.0) para no divergir del
                                        # `final_price` ya calibrado en reconcile.
                                        breakdown_domain.append(BudgetBreakdownComponent(
                                            code=bk.code,
                                            concept=bk.description,
                                            type="OTHER",
                                            price=bk.price_unit * cal_factor,
                                            yield_amount=bk.quantity,
                                            total=bk.price * cal_factor,  # bk.price = price_unit × quantity (catálogo lo precomputa)
                                            isSubstituted=False,
                                            alternativeComponents=[],
                                            is_variable=bk.is_variable,
                                        ))
                                    self._emit(budget_id, 'breakdown_inherited_1to1', {
                                        "code": safe_code,
                                        "candidate_code": cand_code,
                                        "n_components": len(catalog_breakdowns),
                                    })
                        except Exception as inherit_err:
                            logger.warning(
                                f"[inherit-1:1] {safe_code}: error cargando breakdown del catálogo "
                                f"({cand_code or '?'}): {inherit_err}"
                            )

                    # Phase 17.8 — normalizar yield_amount para que cumpla la invariante
                    # quantity × price ≈ total ANTES de reconciliar. Cubre el caso de
                    # dimensionamiento oculto donde el agente persiste total con
                    # multiplicadores embedded (× dim × ICL) sin propagar al yield.
                    norm = normalize_breakdown_quantities(breakdown_domain)
                    if norm.fixed_count > 0:
                        logger.info(
                            f"[normalize] Partida {safe_code}: {norm.fixed_count} componente(s) "
                            f"con yield derivado de total/price. Códigos: {norm.suspicious_codes}"
                        )
                        self._emit(budget_id, 'breakdown_quantity_derived', {
                            "code": safe_code,
                            "fixed_count": norm.fixed_count,
                            "suspicious_codes": norm.suspicious_codes,
                        })

                    # Phase 17 — reconciliación post-LLM. Si la divergencia entre
                    # sum(breakdown.total) y final_price es < 2%, escalamos
                    # silenciosamente (rounding/ruido del LLM). Si es >= 2%,
                    # persistimos raw + flag para revisión humana en el editor.
                    recon = reconcile_breakdown(final_price, breakdown_domain)
                    breakdown_domain = recon.breakdown
                    if recon.needs_review:
                        logger.warning(
                            f"[reconcile] Partida {safe_code} divergence "
                            f"{recon.divergence_pct:.2%} (€{recon.divergence_amount:+.2f})"
                        )
                        self._emit(budget_id, 'partida_needs_reconciliation', {
                            "code": safe_code,
                            "divergence_pct": round(recon.divergence_pct, 4),
                            "divergence_amount": round(recon.divergence_amount, 2),
                            "unit_price": final_price,
                            "sum_breakdown": round(final_price + recon.divergence_amount, 2),
                        })

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
                        needs_human_review=needs_human_review,
                        # Calibración §3/§8: PEM antes de calibrar + factor
                        # aplicado (1.0 = sin calibración / excluida). El loop de
                        # aprendizaje compara corrected_raw / pre_calibration.
                        pre_calibration_unit_price=cal_pre_price,
                        applied_calibration_factor=cal_factor,
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

                    # BC3 doble precio: si la partida trae precio del propio BC3,
                    # ese es el precio ACTIVO por defecto (importar tal cual); la
                    # estimación IA (final_price) queda guardada para comparar.
                    _bc3_price = getattr(item, 'bc3_unit_price', None)
                    _measurements = getattr(item, 'measurements', None)
                    _active_source = 'bc3' if _bc3_price is not None else 'ai'
                    _active_price = _bc3_price if _active_source == 'bc3' else final_price
                    # La reconciliación (breakdown IA vs unitPrice) sólo aplica
                    # cuando el precio activo ES el de la IA.
                    _recon_active = (_active_source == 'ai') and recon.needs_review

                    partida = BudgetPartida(
                        id=str(uuid.uuid4()), order=global_order,
                        original_item=original_item_obj,
                        ai_resolution=ai_res_obj,
                        alternatives=alternatives,
                        code=safe_code, description=safe_description,
                        unit=safe_unit, quantity=safe_quantity, unitPrice=_active_price,
                        totalPrice=_active_price * safe_quantity,
                        isRealCost=not needs_human_review,
                        matchConfidence=confidence,
                        reasoning=reasoning_for_trace,
                        breakdown=breakdown_domain if breakdown_domain else None,
                        match_kind=val.match_kind,
                        unit_conversion_applied=conversion_payload,
                        applied_fragments=fragment_ids,
                        # BC3 — doble precio + mediciones estructuradas.
                        bc3_unit_price=_bc3_price,
                        ai_unit_price=final_price,
                        active_price_source=_active_source,
                        measurements=_measurements,
                        # Phase 17 — flags de reconciliación (sólo si el activo es IA).
                        needs_reconciliation=_recon_active,
                        divergence_pct=recon.divergence_pct if _recon_active else None,
                        divergence_amount=recon.divergence_amount if _recon_active else None,
                    )
                    priced_partidas.append(partida)

                    # S1-A-04 — calcular y exponer pricing_metadata por partida.
                    # ``cost_usd`` se aproxima por diferencia del coste total
                    # acumulado entre antes y después de procesar este item.
                    # ``latency_ms`` desde que se inició la fase de pricing
                    # para esta partida. Ambos best-effort: el coste real
                    # depende de paralelismo de Gemini y puede ser ruidoso.
                    pricing_metadata: Dict[str, Any] = {
                        "cache_hit": False,
                        "cost_usd": max(
                            0.0,
                            float(metrics.get("cost") or 0.0)
                            - item_pre_call_cost.get(safe_code, 0.0),
                        ),
                        "latency_ms": int(
                            (time.monotonic() - item_start_times.get(safe_code, time.monotonic()))
                            * 1000
                        ),
                        "match_kind": val.match_kind,
                        "confidence_score": confidence,
                    }

                    # Persistir en caché si confidence >= threshold.
                    if self.pricing_cache is not None and not needs_human_review:
                        try:
                            persisted = await self.pricing_cache.persist(
                                description=item.description,
                                unit=item.unit,
                                partida=partida.model_dump(),
                                confidence_score=float(confidence) / 100.0 if confidence > 1 else float(confidence),
                                match_kind=val.match_kind or "1:1",
                            )
                            if persisted:
                                self._emit(budget_id, 'pricing_cache_persisted', {
                                    "code": safe_code,
                                    "confidence_score": float(confidence),
                                })
                        except Exception as cache_err:
                            logger.warning(
                                f"[cache] persist failed for {safe_code}: {cache_err}"
                            )

                    self._emit(budget_id, 'item_resolved', {
                        "type": "PARTIDA",
                        "item": partida.model_dump(),
                        "pricing_metadata": pricing_metadata,
                    })

                    # Sprint 1 (S1-B-01) — strongly-typed companion event the
                    # admin job-detail page consumes for cost/latency/quality
                    # KPIs. Kept additive next to the legacy `item_resolved`.
                    # cost_usd/latency_ms/cache_hit ahora vienen reales de S1-A-04.
                    _chunk_usage = usage or {}
                    _tier_meta = _tier_per_code.get(safe_code, {})
                    # S2-A-06 — `tier_used` ahora refleja el modelo REAL
                    # ejecutado (flash o pro). `suggested_tier` es lo que la
                    # heurística recomendaba (telemetría/análisis). Ambos
                    # llegan al panel admin para que pueda mostrar
                    # "Flash:74 (heurística sugería Pro:30)" en lugar del
                    # bug previo que mostraba "Pro:74" cuando todos fueron Flash.
                    _partida_telemetry = {
                        'code': partida.code,
                        'tier_used': _tier_meta.get('tier'),
                        'suggested_tier': _tier_meta.get('suggested_tier'),
                        'tier_reason': _tier_meta.get('reason'),
                        'tokens_in': _chunk_usage.get('promptTokenCount', 0),
                        'tokens_out': _chunk_usage.get('candidatesTokenCount', 0),
                        'cost_usd': pricing_metadata['cost_usd'],
                        'latency_ms': pricing_metadata['latency_ms'],
                        'cache_hit': pricing_metadata['cache_hit'],
                        'match_kind': val.match_kind if val else None,
                        'confidence_score': confidence,
                    }
                    self._emit(budget_id, 'partida_resolved_v2', _partida_telemetry)
                    _resolved_telemetry.append(_partida_telemetry)
                    # P4.b — checkpoint hook. The use case persists the
                    # partida to Firestore so a retry can resume from here.
                    # Errors are logged but do NOT abort the swarm; the
                    # next attempt may simply re-resolve this partida.
                    if on_partida_resolved is not None:
                        try:
                            await on_partida_resolved(partida)
                        except Exception as cb_err:
                            logger.warning(
                                f"[pricing] on_partida_resolved callback failed for "
                                f"{partida.code}: {type(cb_err).__name__}: {cb_err}"
                            )
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
        # Caller sees the full picture: resumed partidas (from prior attempts)
        # concatenated with newly resolved ones. Order: resumed first, then
        # cached (S1-A-04, no LLM cost), then newly resolved via LLM.
        return resume_from + cached_partidas + priced_partidas

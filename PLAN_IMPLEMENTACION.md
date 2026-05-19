# Plan de implementación — Sprints 1 + 2 + 3

> **Versión:** 1.0 · 2026-05-19
> **Estado:** aprobado, listo para ejecución por agentes paralelos
> **Sprints incluidos:**
> - **Sprint 1** — Viabilidad económica (coste + tiempo) — 1 semana
> - **Sprint 2** — Robustez operacional — 1-2 semanas
> - **Sprint 3** — Calidad sostenida y data ownership — 2-3 semanas
>
> Este documento es **autoejecutable**: cada tarea tiene paths exactos,
> criterios de aceptación verificables y dependencias. Un agente puede
> trabajar leyendo solo esta sección, sin contexto previo de
> conversación.

---

## 0. Contexto operacional

### Sistema actual (recordatorio rápido)

- **Frontend**: Next.js 15 App Router en Vercel (`src/`)
- **Backend Python crítico**: `services/ai-core/` desplegado en GCP Cloud Run (Service `ai-core` + Job `ai-core-worker`, región `europe-southwest1`, proyecto `grupo-rg-a9929`)
- **Persistencia**: Firestore (admin SDK desde Next + Python) + Storage para PDFs
- **Pipeline crítico**: PDF/NL → `RestructureBudgetUseCase` o `GenerateBudgetFromNlUseCase` → `SwarmPricingService` → `Budget` final
- **Catálogo**: 1,661 items + 10,537 breakdowns = 12,198 docs en `price_book_2025` (vector search SOLO sobre `kind='item'`)

### Decisiones de modelo confirmadas

| Componente | Modelo |
|---|---|
| Pricing evaluator | Gemini 2.5 Flash (Pro queda solo experimental via env var `ENABLE_PRO_PRICING=true`) |
| Architect (NL→tasks) | Gemini 2.5 Flash (mantener) |
| Bi-encoder embeddings (Sprint 3) | `BAAI/bge-m3` fine-tuneable, MIT license, vive en el worker |
| Cross-encoder reranker (Sprint 1 base, Sprint 3 fine-tuned) | `BAAI/bge-reranker-v2-m3` MIT license, vive en el worker |
| BM25 (Sprint 1) | `rank-bm25` Python, in-memory, 1,661 items |
| PDF extraction (visual/ANNEXED) | Gemini 2.5 Flash con temperatura 0.0 |
| PDF extraction (nativo) | pdfplumber-first, LLM fallback (Sprint 3) |

### Hotfix pendiente de deploy

`FORCE_FLASH_PRICING` env var ya implementado en
`services/ai-core/src/budget/application/services/swarm_pricing_service.py:188-205`.
Está pendiente de hacer `gcloud builds submit` + setear la env var en el
Job. Esto se hace **antes** de empezar Sprint 1 como salvaguarda.

### Comandos clave de deploy

```powershell
# Build + deploy ai-core
$env:CLOUDSDK_PYTHON = "C:\Users\Usuario\AppData\Local\Google\Cloud SDK\google-cloud-sdk\platform\bundledpython\python.exe"
gcloud builds submit --config services/ai-core/cloudbuild.yaml services/ai-core

# Activar/desactivar override Pro→Flash
gcloud run jobs update ai-core-worker --region=europe-southwest1 --update-env-vars=FORCE_FLASH_PRICING=true
gcloud run jobs update ai-core-worker --region=europe-southwest1 --remove-env-vars=FORCE_FLASH_PRICING

# Configurar max-retries
gcloud run jobs update ai-core-worker --region=europe-southwest1 --max-retries=0
```

---

## 1. Asignación a agentes paralelos

El plan se ejecuta con **dos agentes en paralelo** (worktrees git separados):

- **Agent A — "Retrieval & Pricing Engineer"**: trabajo en `services/ai-core/`. Foco: optimización del retrieval, pricing, extracción PDF, swarm. Branch sugerido: `sprint/retrieval-pricing`.
- **Agent B — "Orchestration & UX Engineer"**: trabajo en `src/` (Next.js + cron + UI) + tareas operacionales en `services/ai-core/`. Foco: capa operacional, paneles admin, observabilidad. Branch sugerido: `sprint/orchestration-ux`.

### Reglas para evitar conflictos

1. **Agent A** SOLO toca: `services/ai-core/**` (excepto cuando se indique explícitamente lo contrario en una tarea).
2. **Agent B** SOLO toca: `src/**`, `vercel.json`, `firestore.rules` y los archivos de `services/ai-core/` listados en sus tareas.
3. Si hay un archivo compartido entre tareas (raro), prevalece el agente cuya tarea lo modifique primero. El segundo merge resuelve conflicto.
4. Ninguno toca `WHITEPAPER.md` ni este `PLAN_IMPLEMENTACION.md`.
5. Cada agente crea un commit por tarea completada (`feat(sprint-N): TASK-ID — descripción`).

### Sincronización

- Antes de empezar Sprint 2, ambos agentes deben haber completado todas sus tareas de Sprint 1.
- Sprint 3 espera a que Sprints 1 y 2 estén mergeados y validados.

---

## SPRINT 1 — Viabilidad económica (1 semana)

**Objetivo de negocio**: bajar coste por PDF de $20-150 → <$1 · bajar tiempo de 2 h+ → <15 min · mantener calidad >85 %.

### Tarea S1-A-01 [Agent A] · Forzar Flash en pricing

**Path**: `services/ai-core/src/budget/application/services/swarm_pricing_service.py`

**Descripción**: actualmente la heurística `_select_tier` puede devolver `"pro"` (línea 247). Sustituir la lógica para que **siempre devuelva `"flash"` salvo que la env var `ENABLE_PRO_PRICING=true` esté activa**. La env var actual `FORCE_FLASH_PRICING` se mantiene como deprecada (lo opuesto a la nueva).

**Cambios concretos**:
1. Renombrar/clarificar la lógica de `_resolve_pricing_model` para que la **decisión por defecto sea Flash**. Pro requiere opt-in explícito.
2. Eliminar las dos llamadas a `MODEL_PRO` no protegidas por el override.
3. `_select_tier` puede seguir existiendo (devuelve "flash"/"pro" en su análisis) pero su salida NO se usa para elegir modelo — solo para telemetría.
4. Loggear `tier_decided=flash, reason=…, original_tier_suggestion=pro` para poder reconstruir lo que el sistema "hubiera elegido".

**Criterio de aceptación**:
- Test: con `ENABLE_PRO_PRICING` no set, todas las llamadas LLM al evaluator usan `gemini-2.5-flash`.
- Test: con `ENABLE_PRO_PRICING=true`, vuelve al comportamiento anterior.
- Telemetría conserva `tier_assigned` y `tier_escalated` para análisis pero el modelo real usado se loggea separado.

**Dependencias**: ninguna.

---

### Tarea S1-A-02 [Agent A] · Hybrid BM25 + Vector con RRF

**Paths**:
- Nuevo: `services/ai-core/src/budget/catalog/application/services/hybrid_catalog_search.py`
- Modificar: `services/ai-core/requirements.txt` (añadir `rank-bm25==0.2.2`)
- Modificar: `services/ai-core/src/budget/application/services/swarm_pricing_service.py` (sustituir el vector search puro por el hybrid)
- Modificar: `services/ai-core/src/core/http/dependencies.py` (wire del nuevo service)

**Descripción**: crear `HybridCatalogSearch` que combine BM25 in-memory + vector search existente con Reciprocal Rank Fusion (RRF).

**Estructura del componente**:

```python
class HybridCatalogSearch:
    def __init__(
        self,
        catalog_items: list[CatalogItem],   # los 1,661 items
        vector_search: IVectorSearch,
        rrf_k: int = 60,
    ):
        # tokenización española con stemming ligero
        tokenized = [tokenize_es(i.description + " " + i.unit_raw) for i in catalog_items]
        self.bm25 = BM25Okapi(tokenized)
        self.items_by_idx = {i: item for i, item in enumerate(catalog_items)}
        self.vector_search = vector_search

    async def search(
        self,
        query: str,
        query_vector: list[float],
        chapter_filter: Optional[str] = None,
        unit_dimension_filter: Optional[str] = None,
        top_k: int = 15,
    ) -> list[CatalogItem]:
        # 1. BM25 top-30 (con filtro estructural opcional)
        # 2. Vector top-30 (con filtro estructural opcional)
        # 3. RRF fusion
        # 4. Devolver top_k items con score combinado
```

**Cargado del catálogo en memoria**: al boot del worker (en `_build_use_case_from_env`), cargar los 1,661 items desde Firestore una sola vez. Cachear en singleton.

**Criterio de aceptación**:
- Tests unitarios sobre dataset sintético de 50 items:
  - Query exacta de keyword técnica → BM25 lo coloca top-1
  - Query semántica suelta → Vector lo coloca top-1
  - Query mixta → ambos contribuyen y RRF lo coloca top-1
- Latencia de búsqueda <100 ms para 1,661 items.
- Integration test con un PDF de 5 partidas: precision@5 ≥ 0.8.

**Dependencias**: ninguna.

---

### Tarea S1-A-03 [Agent A] · Cross-encoder reranker BGE local

**Paths**:
- Nuevo: `services/ai-core/src/budget/infrastructure/adapters/reranking/bge_reranker.py`
- Modificar: `services/ai-core/requirements.txt` (añadir `sentence-transformers==3.0.1` y `torch==2.3.0` CPU-only)
- Modificar: `services/ai-core/Dockerfile` (descargar el modelo BGE durante el build para evitar cold-start lento)
- Modificar: `services/ai-core/src/budget/application/services/swarm_pricing_service.py` (sustituir `_rerank_candidates` actual por la nueva clase)

**Descripción**: reemplazar el rerank con Gemini Flash por un cross-encoder local
`BAAI/bge-reranker-v2-m3` (~280 MB). Recibe `(query, candidate)` pairs y
devuelve score 0-1.

**Implementación clave**:

```python
from sentence_transformers import CrossEncoder

class BgeReranker:
    _instance = None

    def __init__(self):
        # Single global instance — se carga una vez al boot
        self.model = CrossEncoder('BAAI/bge-reranker-v2-m3', max_length=512)

    @classmethod
    def get(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def rerank(
        self,
        query: str,
        candidates: list[CatalogItem],
        top_n: int = 3,
    ) -> list[tuple[CatalogItem, float]]:
        pairs = [(query, c.description) for c in candidates]
        scores = self.model.predict(pairs)
        ranked = sorted(zip(candidates, scores), key=lambda x: -x[1])
        return ranked[:top_n]
```

**Dockerfile change**: añadir antes del `CMD` final:

```dockerfile
# Pre-descargar el modelo cross-encoder para evitar cold-start de ~30s
RUN python -c "from sentence_transformers import CrossEncoder; CrossEncoder('BAAI/bge-reranker-v2-m3')"
```

**Criterio de aceptación**:
- Test unitario con 5 pairs sintéticos: el ranking es estable.
- Latencia de rerank de 20 candidatos: <500 ms en CPU del worker (2 cores).
- El swarm ya no llama a `_rerank_candidates` con LLM Flash. Eliminado.

**Dependencias**: S1-A-02 (necesita el output de Hybrid para reranquear).

---

### Tarea S1-A-04 [Agent A] · Caché de pricing por hash

**Paths**:
- Nuevo: `services/ai-core/src/budget/application/services/pricing_cache.py`
- Modificar: `services/ai-core/src/budget/application/services/swarm_pricing_service.py` (consultar caché antes del swarm; persistir tras resolver)
- Modificar: `firestore.rules` (añadir colección `partida_pricing_cache` admin-SDK-only)

**Descripción**: caché Firestore por hash(`normalize(description) + normalize(unit)`). TTL 90 días.

**Esquema del documento Firestore** (`partida_pricing_cache/{hash}`):

```json
{
  "hash": "sha256(...)",
  "normalized_description": "solera hormigon fratasada hm20 e15cm",
  "normalized_unit": "m2",
  "resolved_partida": { /* BudgetPartida serializada */ },
  "match_kind": "1:1",
  "confidence_score": 0.91,
  "hits_count": 12,
  "first_seen": "2026-05-20T...",
  "last_used": "2026-05-22T...",
  "expires_at": "2026-08-22T..."
}
```

**Política**:
- Lookup antes del swarm: si hit con `confidence_score >= 0.85` Y `expires_at > now`, devolver del caché y emit `pricing_cache_hit` event.
- Si miss o low-confidence, ejecutar swarm normal. Al resolver, guardar en caché con `confidence_score = match_score del cross-encoder`.
- Incrementar `hits_count` y actualizar `last_used` en cada hit.
- Cron Vercel separado puede limpiar entradas expiradas (lo dejo para Sprint 2).

**Criterio de aceptación**:
- Test: dos PDFs distintos con la misma partida → segundo PDF tiene cache hit, no llama al LLM.
- Test: lookup con hash de 1 millón de docs < 100 ms (Firestore con índice).
- Métrica `cache_hit_rate` emitida con cada job.

**Dependencias**: ninguna (puede correr en paralelo a S1-A-02 y S1-A-03).

---

### Tarea S1-A-05 [Agent A] · Filtro estructural pre-vector

**Path**: `services/ai-core/src/budget/application/services/swarm_pricing_service.py`

**Descripción**: antes del `HybridCatalogSearch.search(...)`, derivar dos filtros estructurales que reducen el espacio de búsqueda:

1. **`chapter_filter`**: si el `RestructuredItem.chapter` ha sido normalizado con confianza alta (no es `[UNKNOWN]` ni similar), pasarlo como filtro. El catálogo está indexado por capítulo.
2. **`unit_dimension_filter`**: si `RestructuredItem.unit_dimension` está claro (e.g. `m2`, `m3`, `ud`), pasarlo. Items del catálogo con dimensión incompatible se excluyen.

**Lógica**:

```python
def derive_filters(item: RestructuredItem) -> dict:
    chapter = stabilize_chapter_name(item.chapter)
    has_confident_chapter = (
        chapter and chapter not in {"VARIOS", "[UNKNOWN]", "SIN CAPÍTULO"}
    )
    return {
        "chapter_filter": chapter if has_confident_chapter else None,
        "unit_dimension_filter": item.unit_dimension if item.unit_dimension else None,
    }
```

El `HybridCatalogSearch` (de S1-A-02) ya acepta estos parámetros. Aquí
simplemente se invoca con ellos.

**Criterio de aceptación**:
- Métrica `candidates_pre_filter_count` vs `candidates_post_filter_count` en cada partida — debe verse reducción ≥30 % en partidas con chapter conocido.
- Test: una partida de "DEMOLICIONES" no recibe candidatos de "PINTURA".

**Dependencias**: S1-A-02.

---

### Tarea S1-A-06 [Agent A] · Timeout por llamada LLM

**Path**: `services/ai-core/src/budget/infrastructure/adapters/ai/gemini_adapter.py`

**Descripción**: el adapter actual de Gemini hace retries internos sin timeout por intento. Solo hay `httpx timeout = 300s` total. Bug del incidente: un retry-loop bloquea un slot del semaphore indefinidamente.

**Cambios**:
1. Envolver `llm.generate_structured(...)` con `asyncio.wait_for(call, timeout=60s)`.
2. Si timeout → capturar `asyncio.TimeoutError` y degradar a un retry con Flash (si era Pro) o devolver `None` con `match_kind='from_scratch'` (si ya era Flash).
3. Loggear `llm_call_timeout` con el modelo y el tiempo real transcurrido.

**Configurable**:
- Env var `LLM_CALL_TIMEOUT_SECONDS` (default 60).
- Env var `LLM_CALL_MAX_RETRIES` (default 2, ya implícito en Genkit, hacerlo explícito).

**Criterio de aceptación**:
- Test con mock que simula Gemini 60s+ → la call es cancelada y se degrada.
- Métrica `llm_timeout_rate` por modelo.

**Dependencias**: ninguna.

---

### Tarea S1-A-07 [Agent A] · Subir Semaphore a 8

**Path**: `services/ai-core/src/budget/application/services/swarm_pricing_service.py`

**Descripción**: cambiar línea `Semaphore(4)` → `Semaphore(8)`. Hacer configurable via env var `SWARM_CONCURRENCY` (default 8).

**Criterio de aceptación**: trivial, smoke test de un job pequeño confirma que 8 partidas se procesan en paralelo.

**Dependencias**: ninguna.

---

### Tarea S1-A-08 [Agent A] · Tests unitarios + integración Sprint 1

**Paths**:
- Nuevos: `services/ai-core/tests/test_hybrid_catalog_search.py`, `tests/test_bge_reranker.py`, `tests/test_pricing_cache.py`, `tests/test_llm_timeout.py`
- Modificar: `services/ai-core/tests/test_swarm_pricing_boundary.py` para reflejar el nuevo flow

**Descripción**: cobertura mínima 70 % en archivos nuevos. Tests deben correr con `pytest services/ai-core/tests/ -m "not firestore"` sin emulator.

**Criterio de aceptación**:
- `pytest services/ai-core/tests/` pasa con 0 fallos.
- Coverage report >70 % en módulos nuevos.

**Dependencias**: S1-A-02, S1-A-03, S1-A-04, S1-A-06.

---

### Tarea S1-B-01 [Agent B] · Métricas de validación en UI

**Paths**:
- Modificar: `services/ai-core/src/pipeline_telemetry/domain/entities.py` (añadir event types nuevos)
- Modificar: `services/ai-core/src/budget/application/services/swarm_pricing_service.py` (emit eventos nuevos)
- Nuevo: `src/app/[locale]/dashboard/admin/jobs/[jobId]/page.tsx` (placeholder mínimo, completar en Sprint 2)
- Nuevo: `src/actions/admin/get-job-metrics.action.ts`

**Descripción**: añadir telemetría granular para poder validar coste/latencia/calidad por job.

**Event types nuevos** a emitir desde el swarm:

```python
# Por partida resuelta
emit_event("partida_resolved_v2", {
    "code": partida.code,
    "tier_used": "flash",  # flash | pro
    "tokens_in": usage.promptTokenCount,
    "tokens_out": usage.candidatesTokenCount,
    "cost_usd": calculated_cost,
    "latency_ms": latency,
    "cache_hit": False,
    "match_kind": partida.match_kind,
    "confidence_score": score,
})

# Al cerrar el job
emit_event("job_metrics_final", {
    "total_tokens_in": ...,
    "total_tokens_out": ...,
    "total_cost_usd": ...,
    "duration_seconds": ...,
    "partidas_total": ...,
    "cache_hit_rate": ...,
    "latency_p50": ...,
    "latency_p95": ...,
    "tier_flash_count": ...,
    "tier_pro_count": ...,
    "needs_review_count": ...,
})
```

**UI**: vista mínima `/dashboard/admin/jobs/{jobId}` que muestra los `job_metrics_final` en cards. Se completa en Sprint 2 con la vista global. Por ahora solo el detalle.

**Criterio de aceptación**:
- Tras procesar un PDF, en `/dashboard/admin/jobs/{jobId}` el operador ve cost, duration, cache_hit_rate, ratio flash/pro.
- Server action `getJobMetricsAction(jobId)` con auth admin.

**Dependencias**: ninguna del lado UI. Coordinar con Agent A para que emita los eventos.

---

### Tarea S1-DEPLOY-01 [Devops/manual] · Deploy + smoke

**Owner**: humano (tú o el owner).

**Acciones**:
1. `gcloud builds submit --config services/ai-core/cloudbuild.yaml services/ai-core` (build + deploy ai-core)
2. `gcloud run jobs update ai-core-worker --region=europe-southwest1 --update-env-vars=SWARM_CONCURRENCY=8,LLM_CALL_TIMEOUT_SECONDS=60`
3. `gcloud run jobs update ai-core-worker --region=europe-southwest1 --max-retries=0` (preventivo, también para S2)
4. Lanzar un PDF interno pequeño (~30 partidas) y verificar:
   - Cache miss inicial
   - Hybrid search funciona (logs `hybrid_search_results`)
   - Cross-encoder rerankea (logs `bge_rerank_completed`)
   - Coste total <$0.20
   - Tiempo total <3 min
5. Lanzar el PDF de 876 partidas del incidente (con FORCE_FLASH_PRICING activo si conviene) y verificar:
   - Coste total <$1.50
   - Tiempo total <20 min
   - `cache_hit_rate` >0 si se ha repetido

**Criterio de aceptación**: ambos smoke tests pasan con métricas dentro de target.

**Dependencias**: S1-A-01..08, S1-B-01.

---

### Tarea S1-VAL-01 [Owner + humano] · Validación con 5-10 PDFs reales

**Owner**: tú/el owner.

**Descripción**: procesar 5-10 PDFs reales (casos típicos del negocio). Por cada uno, registrar en una hoja:

| PDF | Páginas | Partidas | Coste $ | Tiempo min | Cache hit % | Revisión manual % | Observaciones |
|---|---|---|---|---|---|---|---|

**Criterio de éxito del Sprint 1**:
- Coste medio < $2 por PDF de 250 partidas equivalentes
- Tiempo medio < 20 min por PDF de 250 partidas equivalentes
- % revisión manual < 15 %

**Dependencias**: S1-DEPLOY-01.

---

## SPRINT 2 — Robustez operacional (1-2 semanas)

**Objetivo**: el sistema es **operable por un solo admin**, sin zombis indetectados, con panel de jobs y observabilidad. Resuelve los bugs §15.1 del whitepaper.

### Tarea S2-A-01 [Agent A] · Cancellation cooperativa real en swarm

**Path**: `services/ai-core/src/budget/application/services/swarm_pricing_service.py`

**Descripción**: pasar `cancellation_event: asyncio.Event` al `evaluate_batch` y checkearlo entre cada partida resuelta. Si `event.is_set()`, raisear `asyncio.CancelledError`.

**Cambios**:
1. Signature: `evaluate_batch(items, budget_id, metrics, *, resume_from=None, on_partida_resolved=None, cancellation_event=None)`
2. En el loop principal, entre partidas: `if cancellation_event and cancellation_event.is_set(): raise asyncio.CancelledError("user cancelled")`
3. El runner (`budget_pipeline_runner.py`) ya recibe el event — solo hace falta propagarlo al swarm.

**Criterio de aceptación**:
- Test: simular cancel a los 5s, la cancelación se materializa en <10s (no espera al batch entero).
- Métrica `cancellation_latency_ms` (time from request to terminal state).

**Dependencias**: ninguna.

---

### Tarea S2-A-02 [Agent A] · Circuit breaker automático Flash↔fallback

**Path**: `services/ai-core/src/budget/infrastructure/adapters/ai/gemini_adapter.py`

**Descripción**: contador en memoria de errores 503 + timeouts en ventana móvil. Si >3 fallos en 5 min:
- Pasar el adapter a estado `degraded`.
- Devolver `None` con `from_scratch` directamente sin intentar la llamada (durante 2 min).
- Log `circuit_breaker_open`.
- Tras 2 min, intentar una call de prueba; si OK → estado `healthy`.

**Estructura**:

```python
class GoogleGenerativeAIAdapter:
    def __init__(self):
        self._failure_window = collections.deque(maxlen=20)  # timestamps
        self._circuit_open_until: Optional[datetime] = None

    async def generate_structured(self, ...):
        if self._is_circuit_open():
            return _empty_response_with_flag("circuit_breaker_open")
        try:
            result = await asyncio.wait_for(self._call(...), timeout=...)
            self._record_success()
            return result
        except (Exception, asyncio.TimeoutError) as e:
            self._record_failure()
            if self._should_open_circuit():
                self._open_circuit_for(timedelta(minutes=2))
            raise
```

**Criterio de aceptación**:
- Test con mock que falla 4 veces seguidas → 5ª call NO se hace (circuit abierto).
- Test: tras 2 min de circuit abierto, próxima call SÍ se hace.
- Métrica `circuit_state` y `circuit_open_count` emitidas.

**Dependencias**: S1-A-06 (timeout) ya hecho.

---

### Tarea S2-A-03 [Agent A] · Determinismo de la extracción PDF

**Paths**:
- `services/ai-core/src/budget/application/services/pdf_extractor_service.py`
- Tests en `services/ai-core/tests/test_pdf_extractor_determinism.py`

**Descripción**: garantizar que mismo PDF → mismos `code` siempre, condición previa para que el resume desde checkpoints funcione.

**Cambios**:
1. Bajar `temperature=0.0` en `InlinePdfExtractorService` y `AnnexedPdfExtractorService`.
2. **Post-process determinista**: tras extraer la lista de `RestructuredItem`, ordenar por `(page_number, position_y_normalized, position_x_normalized)`. Si el LLM no devuelve posición, usar el orden de aparición en el output.
3. **Generación de code fallback**: si el LLM no devolvió `code` o devolvió uno mal formado, generar `code = f"AUTO-{page:03d}-{idx:03d}-{slug(description)[:20]}"`. Determinista para mismo PDF.
4. **Test de determinismo**: extraer el mismo PDF 3 veces, comparar arrays de `code` — deben ser idénticos.

**Criterio de aceptación**:
- Test de determinismo pasa: 3 extracciones del mismo PDF dan idénticos `code` arrays.
- Resume desde checkpoints funciona end-to-end: cancelar un PDF a mitad, reintentar, los 457 checkpoints se materializan.

**Dependencias**: ninguna.

---

### Tarea S2-A-04 [Agent A + Agent B coordinado] · Cap de partidas + chunking adaptativo

**Paths**:
- `services/ai-core/src/pipeline_jobs/domain/entities.py` (añadir `parent_job_id`, `chunk_index`, `chunk_total`)
- `services/ai-core/src/pipeline_jobs/application/use_cases/run_pipeline_job_uc.py` (lógica de split)
- `services/ai-core/src/pipeline_jobs/infrastructure/budget_pipeline_runner.py` (orquestación de sub-jobs)
- `services/ai-core/src/core/http/dispatch_router.py` (endpoint nuevo `/dispatch-chunked` o lógica interna)
- **Agent B coordina**: `src/components/budget/PipelineJobControls.tsx` y `usePipelineJob.ts` para mostrar sub-jobs como uno solo en UI.

**Descripción**: aplicar la estrategia de chunking del Pricing por capítulo, NO del PDF físico.

**Algoritmo**:

```python
async def execute(self, job_id, attempt_id):
    job = await repo.get_by_id(job_id)
    # Fase 1: extraction siempre completa (no chunkeable)
    extracted_items = await self.runner.extract(job)

    MAX_PARTIDAS_PER_CHUNK = 500
    if len(extracted_items) <= MAX_PARTIDAS_PER_CHUNK:
        # camino actual: pricing en 1 job
        return await self.runner.price(extracted_items, ...)

    # camino nuevo: pricing dividido en sub-jobs
    chunks = group_by_chapter(extracted_items, max_size=MAX_PARTIDAS_PER_CHUNK)
    sub_job_ids = []
    for idx, chunk in enumerate(chunks):
        sub_job = create_sub_job(
            parent_job_id=job_id,
            chunk_index=idx,
            chunk_total=len(chunks),
            payload={"items": chunk}
        )
        sub_job_ids.append(sub_job.id)
        await self.executor.run_execution(...)

    # Esperar a que todos los sub-jobs completen
    await wait_for_all_sub_jobs(sub_job_ids)

    # Assembly final
    all_partidas = collect_from_all_sub_jobs(sub_job_ids)
    return await self.runner.assemble_and_save(all_partidas, ...)
```

**Cap absoluto**: si `len(extracted_items) > 2000`, fallar el job con error claro: "PDF demasiado grande (>2000 partidas). Divídelo manualmente."

**Reglas de chunking por capítulo**:
1. Agrupar partidas por `chapter` normalizado.
2. Si un capítulo tiene >500 partidas, subdividirlo en bloques de 200 consecutivos.
3. Partidas con chapter `[UNKNOWN]` o `VARIOS` van a un sub-job especial "uncategorized" que se procesa al final.

**Criterio de aceptación**:
- Test con PDF mock de 600 partidas en 3 capítulos: se generan 3 sub-jobs.
- Test con PDF de 1200 partidas en 2 capítulos: capítulo grande se sub-subdivide.
- Test con PDF de 100 partidas: NO se chunkea (camino simple).
- UI muestra "Procesando: 2/3 capítulos completados".

**Dependencias**: ninguna (es feature nueva).

---

### Tarea S2-A-05 [Agent A] · Tests Sprint 2 backend Python

**Paths**: nuevos test files
- `services/ai-core/tests/test_cancellation_responsive.py`
- `services/ai-core/tests/test_circuit_breaker.py`
- `services/ai-core/tests/test_pdf_extractor_determinism.py`
- `services/ai-core/tests/test_chunked_pricing.py`

**Criterio de aceptación**: cobertura >70 % de los módulos modificados. `pytest` verde.

**Dependencias**: S2-A-01..04.

---

### Tarea S2-B-01 [Agent B] · Vista global de jobs

**Paths**:
- Nuevo: `src/app/[locale]/dashboard/admin/jobs/page.tsx`
- Nuevo: `src/components/admin/jobs/jobs-table.tsx`
- Nuevo: `src/actions/admin/list-all-jobs.action.ts`

**Descripción**: tabla `/dashboard/admin/jobs` con todos los `PipelineJob` (todos los estados).

**Funcionalidad**:
- Columnas: ID corto, jobType (badge), status (badge color por estado), createdAt, attempts, resolvedPartidaCount, duration, error (si failed), acciones.
- Filtros: status (multi-select), jobType (multi-select), rango de fechas.
- Búsqueda por jobId / leadId / budgetId.
- Paginación cliente (heredada del estilo de `BudgetsTable.tsx`).
- Acciones por fila: Ver detalle, Cancelar (si running), Reintentar (si failed/canceled).

**Server action `listAllJobsAction`**:
- `verifyAuth(true)` admin
- Query Firestore `pipeline_jobs` ordenado por `createdAt desc`
- Filtrado por estados pasados como parámetro
- Devuelve `JobView[]` (mismo shape que el de la API ai-core)

**Criterio de aceptación**:
- Admin accede a `/dashboard/admin/jobs`, ve los últimos 50 jobs, puede filtrar.
- Pulsar "Cancelar" en un job running llama a `/api/v1/jobs/{id}/cancel` y actualiza la fila.
- Pulsar "Reintentar" en uno failed llama a `/retry`.

**Dependencias**: ninguna.

---

### Tarea S2-B-02 [Agent B] · Detalle de job

**Paths**:
- Modificar: `src/app/[locale]/dashboard/admin/jobs/[jobId]/page.tsx` (placeholder de S1-B-01, ahora completo)
- Nuevo: `src/components/admin/jobs/job-detail.tsx`
- Nuevo: `src/components/admin/jobs/job-timeline.tsx`

**Funcionalidad**:
- Header: jobId, status badge, jobType, createdAt, duration.
- Sección "Métricas finales" (si `job_metrics_final` event existe): cost, latency p50/p95, cache hit rate, ratio flash/pro.
- Sección "Timeline de eventos" (collapsable): cronología de `pipeline_telemetry/{jobId}/events`. Filtros por event type.
- Sección "Attempts" (collapsable): lista de attempts con su outcome.
- Sección "Checkpoints" (collapsable, paginada si >100): partidas resueltas con `code`, `match_kind`, `confidence_score`.
- Botones: Cancelar (si running), Reintentar (si failed/canceled), Force-fail (admin override).

**Criterio de aceptación**:
- Admin abre un job concluido y ve toda la trazabilidad sin entrar a GCP Console.
- Reload preserva el estado (URL contiene `jobId`).

**Dependencias**: S2-B-01.

---

### Tarea S2-B-03 [Agent B] · Persistencia del wizard chat en Firestore

**Paths**:
- Nuevo: `src/backend/budget/domain/wizard-session.ts`
- Nuevo: `src/backend/budget/infrastructure/firestore-wizard-session-repository.ts`
- Modificar: `src/components/budget/wizard/BudgetWizardChat.tsx`, `useBudgetWizard.ts`
- Modificar: `firestore.rules` (añadir colección `wizard_sessions` con uid match)

**Descripción**: cada sesión del wizard (con sus mensajes + estado) se persiste en `wizard_sessions/{sessionId}`. Al hacer reload, el wizard puede recargar la sesión por URL `?session=X`.

**Schema**:

```typescript
interface WizardSession {
  id: string;
  uid: string;          // owner (Firebase user)
  leadId: string | null;
  budgetId: string | null;
  lastJobId: string | null;
  messages: WizardMessage[];
  state: 'idle' | 'collecting' | 'review' | 'generating' | 'generated';
  requirements: Partial<BudgetRequirement>;
  clientName?: string;
  budgetTitle?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

**UX**:
- Al iniciar un job, persiste `lastJobId` en la sesión.
- Al hacer reload, leer `localStorage.lastSessionId` y `/dashboard/budget-wizard?session={id}` recarga.
- Banner "Tienes un job activo desde hace 12 min — [Ver progreso]" si hay `lastJobId` con status `running`.

**Criterio de aceptación**:
- Reload en mitad de un job mantiene el contexto visual.
- Owner cierra browser, vuelve 1 h después, el banner aparece y le lleva al job.

**Dependencias**: ninguna.

---

### Tarea S2-B-04 [Agent B] · Cron de detección de zombi

**Paths**:
- Nuevo: `src/app/api/cron/detect-zombie-jobs/route.ts`
- Modificar: `vercel.json` (añadir cron `*/5 * * * *`)
- Modificar: `src/backend/marketing/infrastructure/messaging/resend-email.provider.ts` (reutilizar para email al admin)

**Descripción**: cada 5 min, query Firestore `pipeline_jobs` donde `status='running' AND updatedAt < now - 5min`. Para cada zombi detectado:

1. Comparar `resolvedPartidaCount` con el snapshot anterior (guardado en `zombie_alert_state`).
2. Si NO ha cambiado (zombi confirmado), enviar email + Slack al admin con: jobId, duration, last activity, link al detalle.
3. Si ha cambiado (estaba lento pero vivo), actualizar el snapshot.
4. Si el zombi lleva >30 min sin actividad, **proponer auto-cancel** (no ejecutar, solo proponer en el mensaje).

**Criterio de aceptación**:
- Test simulado: job sin updatedAt por 6 min dispara alerta.
- Job que progresa lentamente NO dispara alerta.

**Dependencias**: ninguna.

---

### Tarea S2-B-05 [Agent B] · Endpoints REST administrativos

**Paths**:
- Nuevos:
  - `src/app/api/admin/jobs/[jobId]/force-cancel/route.ts`
  - `src/app/api/admin/jobs/[jobId]/force-retry/route.ts`
  - `src/app/api/admin/jobs/[jobId]/force-fail/route.ts`

**Descripción**: endpoints REST autenticados con `verifyAuth(true)` admin para operar jobs desde curl/Postman/scripts sin pasar por la UI.

**Cada endpoint**:
- Valida auth admin
- Llama a ai-core REST equivalente con `INTERNAL_WORKER_TOKEN`
- Devuelve el JobView actualizado

**Criterio de aceptación**:
- Smoke con curl: `curl -X POST .../api/admin/jobs/{id}/force-cancel -H "Authorization: Bearer admin_session_cookie"` cancela el job.

**Dependencias**: ninguna.

---

### Tarea S2-B-06 [Agent B] · Métricas Cloud Monitoring custom

**Paths**:
- Modificar: `services/ai-core/src/pipeline_telemetry/infrastructure/cloud_monitoring_emitter.py` (nuevo)
- Modificar: `services/ai-core/src/pipeline_telemetry/application/use_cases/emit_telemetry_uc.py` (integrar)
- Documentación: `services/ai-core/MONITORING.md` (nuevo, instrucciones de configurar alerts)

**Descripción**: emitir métricas custom a Cloud Monitoring vía `google-cloud-monitoring` Python SDK.

**Métricas a emitir**:
- `pipeline_job_duration_seconds` (gauge, label: jobType, finalStatus)
- `pipeline_job_total_cost_usd` (gauge, label: jobType)
- `pipeline_job_failure_rate` (rate, label: error_type)
- `pipeline_job_fallback_rate` (rate, ratio of pro→flash fallback)
- `cache_hit_rate` (gauge)
- `circuit_breaker_open_count` (counter)
- `llm_timeout_count` (counter, label: model)

**Documentación**: incluir `gcloud` commands para crear alerting policies (job duration > 60 min, failure rate > 10%/h, etc.).

**Criterio de aceptación**:
- Tras un job, las métricas aparecen en Cloud Monitoring console.
- Alerting policy creada que dispara email si `pipeline_job_failure_rate > 0.2` durante 5 min.

**Dependencias**: ninguna.

---

### Tarea S2-DEPLOY-01 [Devops/manual] · Deploy + smoke Sprint 2

**Owner**: humano.

**Acciones**:
1. Mergear ambos branches (Agent A y Agent B) a `main`.
2. `gcloud builds submit` para nueva imagen de ai-core.
3. Vercel deploya automáticamente al push.
4. Smoke: cancelar manualmente un PDF a mitad → verificar que se cancela en <10s.
5. Smoke: introducir un job en estado "ghost" (forzando updatedAt antiguo) → verificar que el cron lo detecta.
6. Smoke: abrir `/dashboard/admin/jobs` → ver tabla con últimos jobs.

**Criterio de aceptación**: los 3 smokes pasan.

**Dependencias**: todas las tareas S2.

---

## SPRINT 3 — Calidad sostenida y data ownership (2-3 semanas)

**Objetivo**: sistema que **mejora con cada PDF procesado**. Independencia parcial de Gemini para retrieval. Calidad superior al baseline en dominio construcción.

### Tarea S3-01 [Agent A] · Auditoría data quality del catálogo COAATMCA

**Paths**:
- Nuevo: `services/ai-core/scripts/audit_catalog_data_quality.py`
- Salida: `audit_catalog_report.csv`

**Descripción**: script que escanea los 1,661 items + 10,537 breakdowns y detecta:
1. `unit_normalized` con valores raros o vacíos.
2. Descripciones duplicadas pero `code` diferente.
3. Descripciones muy similares (Levenshtein <5) que deberían fusionarse.
4. `chapter` no listado en `construction_dag_2025.json` (huérfanos).
5. Items sin breakdowns (priceTotal sin componentes).
6. Items con `priceTotal` ≠ `sum(breakdown.total)` (inconsistencia matemática).

**Output**: CSV con columnas `issue_type`, `code`, `description`, `current_value`, `suggested_fix`, `severity`.

**Criterio de aceptación**: el script corre en <2 min sobre el catálogo completo y produce un reporte revisable.

**Dependencias**: ninguna.

---

### Tarea S3-02 [Humano + Agent A] · Datafix del catálogo

**Owner**: humano + Agent A (semiautomático).

**Descripción**: revisar `audit_catalog_report.csv`, aplicar correcciones via script que:
1. Lee el CSV con correcciones aprobadas.
2. Actualiza Firestore `price_book_2025` con los nuevos valores.
3. Re-ingiere los embeddings de los items modificados (nueva versión).

**Criterio de aceptación**: post-fix, una segunda corrida del audit reporta <5 % de incidencias originales.

**Dependencias**: S3-01.

---

### Tarea S3-03 [Agent A] · Generación de dataset sintético para fine-tune

**Paths**:
- Nuevo: `services/ai-core/scripts/generate_synthetic_pairs.py`
- Salida: `coaatmca_synthetic_pairs.jsonl` (~33k pares)

**Descripción**: script que por cada uno de los 1,661 items pide a Gemini 2.5 Pro (one-shot, ~$300-500 total):
- 10 paráfrasis positivas (cómo un aparejador escribiría la misma partida)
- 10 hard negatives (partidas similares pero NO equivalentes, del mismo capítulo)

**Formato del output**:

```jsonl
{"anchor": "Solera de hormigón HM-20 fratasado e=15cm", "positive": "Pavimento hormigón HM-20 acabado fratasado 15cm espesor", "negative": null}
{"anchor": "Solera de hormigón HM-20 fratasado e=15cm", "positive": null, "negative": "Solera hormigón HA-25 espesor 20cm"}
...
```

**Criterio de aceptación**: 33k pares generados, sample manual de 100 muestra calidad razonable (>80% pairs correctos).

**Dependencias**: S3-02 (catálogo fixed).

---

### Tarea S3-04 [Agent A] · Fine-tune bi-encoder de embeddings

**Paths**:
- Nuevo: `services/ai-core/scripts/finetune_bi_encoder.py`
- Salida: modelo serializado en `models/coaatmca_bi_encoder_v1/` (carpeta con pesos, subir a Cloud Storage)
- Modificar: `services/ai-core/src/budget/infrastructure/adapters/databases/firestore_price_book.py` (usar el bi-encoder local para query embedding)

**Descripción**: entrenar bi-encoder a partir de `BAAI/bge-m3` con `MultipleNegativesRankingLoss` sobre `coaatmca_synthetic_pairs.jsonl`.

**Hyperparams**:
- Epochs: 3
- Batch size: 16
- LR: 2e-5
- Warmup: 10%
- Max seq length: 256

**Validación**:
- Holdout: 10% de los pares.
- Métrica: `cos_sim(anchor, positive) > cos_sim(anchor, negative)` en ≥95% del holdout.

**Deployment**:
- Modelo se carga en el worker al boot (~500MB RAM extra).
- Env var `EMBEDDING_MODEL_VERSION=coaatmca_v1` selecciona el modelo (default queda Gemini hasta confirmar mejora en producción).

**Criterio de aceptación**: A/B contra Gemini-001 sobre un golden set de 100 pares reales: recall@10 mejora ≥15%.

**Dependencias**: S3-03.

---

### Tarea S3-05 [Agent A] · Fine-tune cross-encoder reranker

**Paths**:
- Nuevo: `services/ai-core/scripts/distill_cross_encoder.py`
- Salida: modelo en `models/coaatmca_cross_encoder_v1/`

**Descripción**: distillation desde Gemini Pro como judge. Para 5,000 pares (query del histórico, candidate del catálogo), Gemini Pro emite score 0-1. Entrenamos cross-encoder `BAAI/bge-reranker-v2-m3` para reproducir.

**Coste de generación**: $300-600 one-shot.

**Hyperparams**:
- Epochs: 2
- Batch size: 8
- LR: 1e-5

**Criterio de aceptación**: A/B contra BGE base sobre golden set: NDCG@5 mejora ≥10%.

**Dependencias**: histórico de queries (al menos 1000 PDFs procesados o synthetic queries del paso S3-03).

---

### Tarea S3-06 [Agent A] · Layout-aware parser para PDFs nativos

**Paths**:
- Modificar: `services/ai-core/src/budget/application/services/pdf_extractor_service.py`
- Reforzar: `try_heuristic_extraction()` existente (parece estar parcialmente implementado).

**Descripción**: si el PDF tiene texto extraíble (no escaneado), priorizar `pdfplumber` para extraer tablas estructuradas y partidas. LLM vision SOLO si pdfplumber falla o devuelve resultados pobres.

**Algoritmo**:
1. Test rápido: `pdfplumber.open(pdf_bytes).pages[0].extract_text()` — ¿devuelve texto significativo?
2. Si sí: extraer tablas con `pdfplumber.extract_tables()`. Heurística para identificar columnas (code, description, unit, quantity).
3. Si la heurística produce ≥80% de las partidas esperadas (cross-check contra estadísticas: filas con código y unidad reconocida), usar este resultado.
4. Si no, fallback a LLM vision (camino actual).

**Coste reducido**: PDFs nativos pasan de ~250 llamadas LLM a 0-5 llamadas (solo páginas problemáticas).

**Criterio de aceptación**:
- Test con un PDF nativo de 80 partidas: pdfplumber extrae ≥75 correctamente, sin llamar al LLM.
- Test con un PDF escaneado: cae correctamente a LLM vision.

**Dependencias**: S2-A-03 (determinismo) para que el ordenamiento sea consistente.

---

### Tarea S3-07 [Agent B] · Loop RLHF desde editor manual

**Paths**:
- Modificar: `src/components/budget-editor/EditableCell.tsx` (registrar correcciones)
- Nuevo: `src/actions/admin/log-correction-pair.action.ts`
- Nuevo: colección Firestore `correction_pairs/{id}` (admin-SDK-only)
- Nuevo: `services/ai-core/scripts/retrain_from_corrections.py` (cron mensual)

**Descripción**: cada vez que un humano corrige una partida en el editor, persiste el par `(query_original, partida_propuesta_IA, partida_elegida_humano)`. Cron mensual re-fine-tunea el cross-encoder con estos pares reales.

**Schema** (`correction_pairs/{id}`):

```typescript
{
  id: string;
  budgetId: string;
  query_text: string;       // descripción del PDF
  ai_proposed: {
    code: string;
    description: string;
    confidence: number;
  };
  human_chosen: {
    code: string;
    description: string;
  };
  correction_type: 'mismatch' | 'no_match_then_match' | 'unit_fix';
  corrected_at: Date;
  corrected_by: string;     // uid
}
```

**Cron mensual** (Vercel `0 0 1 * *`): si hay ≥500 pares nuevos desde el último entreno, regenera el dataset y re-fine-tunea via script.

**Criterio de aceptación**:
- Test: cambiar el `code` de una partida en el editor → se persiste el correction pair.
- Métrica `corrections_per_month` visible en dashboard.

**Dependencias**: S3-05 (cross-encoder existente).

---

### Tarea S3-08 [Agent B] · Versionado de modelos

**Paths**:
- Nuevo: `services/ai-core/src/budget/infrastructure/models/model_registry.py`
- Modificar: `cloudbuild.yaml` (subir modelos a Cloud Storage durante el build)

**Descripción**: cada bi-encoder y cross-encoder tiene `version` en Cloud Storage `gs://grupo-rg-a9929-ai-models/`. Worker lee `MODEL_VERSION_EMBEDDING` y `MODEL_VERSION_RERANKER` env vars y descarga los pesos al boot.

**Estructura**:
```
gs://grupo-rg-a9929-ai-models/
├── embedding/
│   ├── v1/  (bge-m3 base)
│   ├── coaatmca_v1/  (fine-tuned)
│   └── latest -> coaatmca_v1
└── reranker/
    ├── v1/  (bge-reranker base)
    ├── coaatmca_v1/  (distilled from Pro)
    └── latest -> coaatmca_v1
```

**Rollback**: cambiar env var `MODEL_VERSION_EMBEDDING=v1` → restart del worker → modelo viejo en uso. Sin redeploy.

**Criterio de aceptación**: rollback funciona en <2 min.

**Dependencias**: S3-04, S3-05.

---

### Tarea S3-09 [Agent B] · Dashboard de salud del modelo

**Paths**:
- Nuevo: `src/app/[locale]/dashboard/admin/model-health/page.tsx`
- Nuevo: `src/actions/admin/get-model-health.action.ts`

**Descripción**: vista admin que muestra:
- Recall@10 último mes (calculado contra golden set + correction_pairs)
- Latencia p50/p95 del bi-encoder y del cross-encoder
- % de partidas con `needs_human_review`
- Tasa de correcciones humanas por capítulo (heatmap)
- Modelo activo (embedding + reranker versions)
- Histórico de despliegues de modelos

**Criterio de aceptación**: admin abre la vista y entiende en 1 min el estado del sistema.

**Dependencias**: S3-07 (correction_pairs colección).

---

### Tarea S3-10 [Tú / ML] · Documentación `MODELS.md`

**Path**: `services/ai-core/MODELS.md`

**Contenido**:
- Cómo entrenar bi-encoder y cross-encoder
- Cómo desplegar a Cloud Storage
- Cómo hacer rollback
- Qué métricas monitorizar
- Threshold de cuándo re-entrenar (mensual + on-demand si recall@10 cae <0.7)
- Cómo añadir nuevo modelo / versión

**Criterio de aceptación**: cualquier ingeniero puede leer el doc y reproducir el entreno + deploy.

**Dependencias**: S3-04, S3-05, S3-08.

---

## 2. Resumen de paralelización Sprints 1 + 2

### Agent A — Retrieval & Pricing Engineer (Python ai-core)

**Sprint 1** (5-6 días):
- S1-A-01 — Forzar Flash en pricing
- S1-A-02 — Hybrid BM25 + Vector con RRF
- S1-A-03 — Cross-encoder reranker BGE local
- S1-A-04 — Caché de pricing por hash
- S1-A-05 — Filtro estructural pre-vector
- S1-A-06 — Timeout por llamada LLM
- S1-A-07 — Subir Semaphore a 8
- S1-A-08 — Tests Sprint 1

**Sprint 2** (4-5 días):
- S2-A-01 — Cancellation cooperativa en swarm
- S2-A-02 — Circuit breaker
- S2-A-03 — Determinismo extracción PDF
- S2-A-04 — Cap + chunking adaptativo (coordina con Agent B)
- S2-A-05 — Tests Sprint 2

### Agent B — Orchestration & UX Engineer (Next.js + cron + UI + ops)

**Sprint 1** (2-3 días):
- S1-B-01 — Métricas de validación en UI (placeholder mínimo)

**Sprint 2** (5-6 días):
- S2-B-01 — Vista global de jobs
- S2-B-02 — Detalle de job
- S2-B-03 — Persistencia del wizard chat en Firestore
- S2-B-04 — Cron de detección de zombi
- S2-B-05 — Endpoints REST administrativos
- S2-B-06 — Métricas Cloud Monitoring custom

### Humano / Devops

- S1-DEPLOY-01 — Deploy + smoke Sprint 1
- S1-VAL-01 — Validación con 5-10 PDFs reales
- S2-DEPLOY-01 — Deploy + smoke Sprint 2

---

## 3. Cronograma estimado

```
Día  1   2   3   4   5   6   7   8   9  10  11  12  13  14
─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ───

Agent A (Sprint 1)     ████████████████
Agent A (Sprint 2)                          ████████████████

Agent B (Sprint 1)     ██████
Agent B (Sprint 2)                          ██████████████████

Deploy + smoke S1                  ▓
Validación S1                          ▓▓▓▓▓▓▓▓
Deploy + smoke S2                                              ▓
```

**Sprint 3** arranca después del día 14, no incluido en el diagrama por escala.

---

## 4. Cómo lanzar los agentes (post-compact)

En la nueva sesión tras el `/compact`, ejecutar (yo lo hago con `Agent` tool):

```
Lanzar EN PARALELO (mismo mensaje, 2 tool calls):

Agent A:
  description: "Sprint 1+2 Retrieval & Pricing"
  subagent_type: general-purpose
  isolation: worktree
  prompt: "Lee PLAN_IMPLEMENTACION.md y ejecuta TODAS las tareas
           marcadas [Agent A] del Sprint 1 (S1-A-01 a S1-A-08).
           No tocar archivos fuera de services/ai-core/.
           Commit por tarea con mensaje 'feat(sprint-1): S1-A-NN — desc'.
           Al terminar Sprint 1, espera confirmación humana antes de Sprint 2.
           Reporta progreso cada 2 tareas completadas."

Agent B:
  description: "Sprint 1+2 Orchestration & UX"
  subagent_type: general-purpose
  isolation: worktree
  prompt: "Lee PLAN_IMPLEMENTACION.md y ejecuta TODAS las tareas
           marcadas [Agent B] del Sprint 1 (S1-B-01).
           Trabajar solo en src/, vercel.json, firestore.rules.
           Al terminar Sprint 1, espera confirmación humana antes de Sprint 2.
           Reporta progreso cada tarea completada."
```

Cuando ambos terminen, el humano (tú/owner):
1. Revisa los worktrees: `git worktree list`
2. Revisa los commits en cada branch
3. Lanza S1-DEPLOY-01 + S1-VAL-01
4. Si la validación es positiva, autoriza Sprint 2 → relanza los agentes con el siguiente bloque del plan.

---

## 5. Criterios de éxito globales

### Después de Sprint 1
- [ ] Coste medio < $2 por PDF de 250 partidas equivalentes (medido en 5+ PDFs reales)
- [ ] Tiempo medio < 20 min por PDF de 250 partidas equivalentes
- [ ] % revisión manual < 15 %
- [ ] Hybrid search + cross-encoder funcionando en producción
- [ ] Tests verdes en ai-core

### Después de Sprint 2
- [ ] `/dashboard/admin/jobs` operacional
- [ ] Detalle de job con timeline + métricas
- [ ] Cancel de un job responde en <10 s (no minutos)
- [ ] Cron detecta zombis y manda alerta
- [ ] Persistencia del wizard funciona (reload preserva contexto)
- [ ] Cap + chunking adaptativo soporta PDFs de 1000+ partidas

### Después de Sprint 3
- [ ] Bi-encoder y cross-encoder fine-tuned con recall@10 ≥15% sobre Gemini-001
- [ ] Catálogo COAATMCA con <5% de incidencias data quality
- [ ] PDFs nativos procesados con pdfplumber-first (cero coste LLM)
- [ ] Loop RLHF activo: ≥500 correction pairs/mes
- [ ] Rollback de modelo funcional en <2 min
- [ ] `MODELS.md` documentado

---

## 6. Out of scope (explícito)

Cosas que **NO** se hacen en estos 3 sprints, queda para futuro:

- Migración a Temporal Cloud / Inngest (Cloud Run Jobs se mantiene)
- Cambio de proveedor LLM (Gemini se mantiene, solo se reduce su uso)
- Multi-tenancy real (cada workspace con su propio catálogo)
- Export en BC3/Presto/Excel del Budget final
- Modo "estimación rápida" para PDFs grandes (sampler + extrapolación)
- Pricing en otros idiomas (EN/CA/DE/NL) — sigue solo en ES
- Mobile app nativa

---

*Fin del plan. Versionado en git. Actualizar este documento si hay cambios
de scope durante la ejecución.*

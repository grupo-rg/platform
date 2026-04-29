# AI Pipelines — Arquitectura, diagnóstico y contratos

> Referencia técnica del sistema de pipelines de IA. Cubre los tres flujos de generación de presupuestos, cómo se integran con la telemetría SSE, cuáles fueron los bugs encontrados y los arreglos aplicados, y el contrato de eventos que el UI consume en tiempo real.

---

## 1. Visión general

La plataforma opera tres pipelines de IA, todos terminando en un documento `Budget` persistido en Firestore:

| Pipeline | Entrada | Motor | Salida |
|----------|---------|-------|--------|
| **Asistente IA** | Mensaje natural en el chat | `privateWizardAgent` (Node/Genkit, Gemini 2.5 Flash) | `reply` + `updatedRequirements` (specs, phaseChecklist, finalBrief, detectedNeeds) |
| **NL → Budget** | `finalBrief` del Asistente cuando `isReadyForGeneration=true` | `GenerateBudgetFromNlUseCase` (Python / Cloud Run) | `Budget` persistido + eventos SSE |
| **PDF → Budget** | PDF de mediciones + estrategia `INLINE`/`ANNEXED` | `RestructureBudgetUseCase` (Python / Cloud Run) | `Budget` persistido + eventos SSE |

Todos los pipelines escriben **la misma tabla de telemetría** (`pipeline_telemetry/{budgetId}/events` con TTL 12h) y el UI consume un único endpoint SSE ([/api/budget/stream](../src/app/api/budget/stream/route.ts)) que re-emite esos eventos con `onSnapshot`. El componente visual [BudgetGenerationProgress](../src/components/budget/BudgetGenerationProgress.tsx) los renderiza como un timeline de 4 fases (Análisis, Búsqueda, Consolidación, Completado).

### Diagrama (alto nivel)

```
                      ┌─────────────────────────────────────┐
                      │   Asistente IA (Node/Genkit Flash)  │
                      │   - turnos conversacionales         │
                      │   - llena specs + phaseChecklist    │
                      │   - al finalizar emite finalBrief   │
                      └───────────────┬─────────────────────┘
                                      │  (user pulsa
                                      │  "Generar presupuesto")
                                      ▼
┌──────────────────────┐     ┌────────────────────────────┐       ┌──────────────────┐
│  PDF de mediciones   │     │  NL → Budget proxy (Next)  │       │  Chat (cliente)  │
│  (subido al chat)    │     │  action pasa brief +       │       │  genera          │
└──────────┬───────────┘     │  budgetId a Python         │       │  budgetId = uuid │
           │                 └─────────────┬──────────────┘       └──────────────────┘
           ▼                               ▼
┌────────────────────────────────────────────────────────────────┐
│              services/ai-core (Python / FastAPI / Cloud Run)   │
│                                                                │
│  /api/v1/jobs/measurements   ── RestructureBudgetUseCase       │
│    (PDF → imágenes @150DPI → Extractor → Swarm Pricing)        │
│                                                                │
│  /api/v1/jobs/nl-budget      ── GenerateBudgetFromNlUseCase    │
│    (narrative → ArchitectService → Swarm Pricing)              │
│                                                                │
│  Auth: middleware x-internal-token (INTERNAL_WORKER_TOKEN)     │
│                                                                │
│  Adapters compartidos:                                         │
│   · GoogleGenerativeAIAdapter (Gemini 2.5 Flash/Pro + retries) │
│   · FirestorePriceBookAdapter (vector search 768-D)            │
│   · FirestoreBudgetRepository (persistencia con subcolecciones)│
│   · FirestoreProgressEmitter (emite eventos de telemetría)     │
└─────────────────────────────────┬──────────────────────────────┘
                                  │ escribe cada evento a
                                  ▼
                 ┌────────────────────────────────────┐
                 │   Firestore                        │
                 │   pipeline_telemetry/{budgetId}/   │
                 │     events/*  (TTL 12h)            │
                 │   budgets/{budgetId}/              │
                 │     chapters/*                     │
                 └─────────────────┬──────────────────┘
                                   │ onSnapshot (Admin SDK)
                                   ▼
                 ┌────────────────────────────────────┐
                 │  /api/budget/stream?budgetId=X     │
                 │  (SSE — re-emite en tiempo real)   │
                 └─────────────────┬──────────────────┘
                                   ▼
                 ┌────────────────────────────────────┐
                 │  BudgetGenerationProgress (React)  │
                 │   - 4 fases colapsables            │
                 │   - sub-eventos recientes          │
                 │   - progress bar + cronómetro      │
                 └────────────────────────────────────┘
```

### Archivos clave

**Node/Next**
- Chat: [`src/components/budget/wizard/BudgetWizardChat.tsx`](../src/components/budget/wizard/BudgetWizardChat.tsx), [`useBudgetWizard.ts`](../src/components/budget/wizard/useBudgetWizard.ts), [`PhaseStepper.tsx`](../src/components/budget/wizard/PhaseStepper.tsx), [`BudgetStreamListener.tsx`](../src/components/budget/wizard/BudgetStreamListener.tsx) (deprecated no-op).
- Panel de actividad: [`src/components/budget/BudgetGenerationProgress.tsx`](../src/components/budget/BudgetGenerationProgress.tsx).
- Agente conversacional: [`src/backend/ai/private/agents/private-wizard.agent.ts`](../src/backend/ai/private/agents/private-wizard.agent.ts) (función `streamPrivateWizardAgent`) + endpoint [`src/app/api/assistant/stream/route.ts`](../src/app/api/assistant/stream/route.ts).
- Proxies al Python: [`src/actions/budget/generate-budget-from-specs.action.ts`](../src/actions/budget/generate-budget-from-specs.action.ts) (NL→Budget), [`src/actions/budget/extract-measurement-pdf.action.ts`](../src/actions/budget/extract-measurement-pdf.action.ts) (PDF→Budget).
- Telemetría SSE: [`src/app/api/budget/stream/route.ts`](../src/app/api/budget/stream/route.ts), emisor en Node [`src/backend/budget/events/budget-generation.emitter.ts`](../src/backend/budget/events/budget-generation.emitter.ts).
- Admin: [`src/actions/admin/get-pipeline-jobs.action.ts`](../src/actions/admin/get-pipeline-jobs.action.ts), [`src/app/[locale]/dashboard/admin/pipelines/page.tsx`](../src/app/[locale]/dashboard/admin/pipelines/page.tsx).

**Python (`services/ai-core/`)**
- Bootstrap: [`src/core/http/main.py`](../services/ai-core/src/core/http/main.py) (FastAPI + `InternalTokenMiddleware`).
- DI: [`src/core/http/dependencies.py`](../services/ai-core/src/core/http/dependencies.py).
- Use cases: [`src/budget/application/use_cases/restructure_budget_uc.py`](../services/ai-core/src/budget/application/use_cases/restructure_budget_uc.py) (PDF) y [`generate_budget_from_nl_uc.py`](../services/ai-core/src/budget/application/use_cases/generate_budget_from_nl_uc.py) (NL).
- Services: [`architect_service.py`](../services/ai-core/src/budget/application/services/architect_service.py), [`pdf_extractor_service.py`](../services/ai-core/src/budget/application/services/pdf_extractor_service.py), [`swarm_pricing_service.py`](../services/ai-core/src/budget/application/services/swarm_pricing_service.py).
- Adapters: [`gemini_adapter.py`](../services/ai-core/src/budget/infrastructure/adapters/ai/gemini_adapter.py), [`firestore_price_book.py`](../services/ai-core/src/budget/infrastructure/adapters/databases/firestore_price_book.py), [`firestore_budget.py`](../services/ai-core/src/budget/infrastructure/adapters/databases/firestore_budget.py).
- Telemetry: [`src/pipeline_telemetry/**`](../services/ai-core/src/pipeline_telemetry/).

---

## 2. Pipeline detallado

### 2.1 Asistente IA (conversacional)

1. Usuario escribe en `/es/dashboard/asistente` → `useBudgetWizard.sendMessage()`.
2. Para admins sin adjuntos, el hook hace `POST /api/assistant/stream` y consume SSE: eventos `text` (chunks) y `done` (final con `reply` + `updatedRequirements`). El bloque JSON final del prompt se filtra antes de llegar al UI.
3. `updatedRequirements.phaseChecklist` alimenta el [`PhaseStepper`](../src/components/budget/wizard/PhaseStepper.tsx): Alcance → Estado → Escala → Capítulos → Validación.
4. Cuando el modelo marca `isReadyForGeneration=true`, debe también rellenar `finalBrief` (resumen técnico para el RAG) y `detectedNeeds[]` (con `requestedMaterial` cuando aplique).

### 2.2 NL → Budget (Python)

1. Cliente genera `budgetId = uuidv4()` y lo propaga a `setGenerationProgress({ budgetId })`. Desde ese segundo, el `BudgetGenerationProgress` abre el EventSource correcto.
2. `generateBudgetFromSpecsAction` (proxy) hace `POST ${AI_CORE_URL}/api/v1/jobs/nl-budget` con header `x-internal-token` y body `{leadId, budgetId, narrative}`. La narrativa prioriza `finalBrief` del Asistente; si falta, concatena la conversación y `detectedNeeds`.
3. Python recibe 202 y lanza `BackgroundTask`. `GenerateBudgetFromNlUseCase.execute()`:
   - Llama `ArchitectService.decompose_request(narrative)` → `DecomposedTask[]` (o `ASKING`).
   - Mapea cada tarea a `RestructuredItem` (puente `NL-{taskId}`, `userSpecificMaterial` inyectado en la descripción).
   - Llama `SwarmPricingService.evaluate_batch(items)` → `BudgetPartida[]`.
   - Agrupa por capítulo, aplica márgenes estándar (GG 13%, BI 6%, IVA 21%), persiste el `Budget` y emite `budget_completed`.
4. El UI ya escuchaba el canal: las fases avanzan en vivo y al llegar `budget_completed` el callback `onComplete` publica el mensaje del sistema con link `/dashboard/admin/budgets/{id}/edit`.

### 2.3 PDF → Budget (Python)

1. Usuario suelta un PDF → el chat pide triage `INLINE`/`ANNEXED`.
2. Cliente genera `budgetId = uuidv4()` y lo envía como campo del `FormData`. `extract-measurement-pdf.action` hace `POST ${AI_CORE_URL}/api/v1/jobs/measurements` con `x-internal-token`.
3. Python convierte el PDF a imágenes @150 DPI, devuelve 202, y dispara `RestructureBudgetUseCase`:
   - `InlinePdfExtractorService` o `AnnexedPdfExtractorService` — Gemini Vision con `RestructureChunkResult`.
   - Si Gemini trunca JSON (`ValidationError`), fallback a `RestructureChunkResultMinimal` (`max_output_tokens=4096`). Si también falla, emite `extraction_failed_chunk` para esa página y **continúa con las demás**.
   - `SwarmPricingService.evaluate_batch()` con Deconstructor (Flash) → Vector Search → Evaluator (Pro).
   - Assembly + persistencia + `budget_completed`.

---

## 3. Contrato de telemetría

Cada evento en Firestore tiene la forma:

```json
{
  "type": "<event_type>",
  "data": { ... },
  "timestamp": <number | ISO string>,
  "expiresAt": <ISO string>
}
```

### Tabla de eventos

| Evento | Emisor | `data` | Fase UI |
|--------|--------|--------|---------|
| `extraction_started` | Python (PDF y NL) | `{query}` | Análisis |
| `subtasks_extracted` | Node NL / Python | `{totalTasks, count?}` | Análisis |
| `restructuring` | Python PDF | `{query}` | Análisis |
| `batch_restructure_submitted` | Python PDF | `{query}` | Análisis |
| `extraction_retry_minimal` | Python PDF | `{page, attempt, reason}` | Análisis (info) |
| `extraction_partial_success` | Python PDF (adapter salvage) | `{page, items_recovered}` | Análisis (info) |
| `extraction_failed_chunk` | Python PDF | `{page, error}` o `{error}` | Análisis (error) |
| `query_expansion_started` | Node NL (ex-Surveyor) | `{taskId, chapter, task}` | Búsqueda |
| `vector_search_started` | Node NL + Python | `{taskId?, query}` | Búsqueda |
| `vector_search_completed` | Node NL | `{taskId, candidatesCount}` | Búsqueda (info) |
| `vector_search` | Python Swarm | `{query}` | Búsqueda |
| `batch_pricing_submitted` | Python Swarm | `{query}` | Búsqueda |
| `judge_evaluating` | Node NL (ex-Judge) | `{taskId, chapter, candidatesCount}` | Consolidación (info) |
| `item_resolved` | Python Swarm + Node NL legacy | `{item: {code, description, totalPrice}, type, taskId?}` | Consolidación |
| `budget_completed` | Python + Node NL | `{budgetId, total, itemCount}` | Completado |

### Cómo mapear fases en el UI

El mapeo vive en [`BudgetGenerationProgress.eventToPhase()`](../src/components/budget/BudgetGenerationProgress.tsx). Si añades un tipo nuevo:

1. Decide a qué fase pertenece (Análisis / Búsqueda / Consolidación / Completado).
2. Añade el `case` en `eventToPhase()`.
3. Añade un `case` en `buildSubEvent()` con `kind` (`info` / `search` / `resolved` / `error`), `title` breve y `detail` si hay contexto relevante.
4. Los eventos sin mapeo se descartan silenciosamente — no rompen el pipeline.

---

## 4. Bugs encontrados y arreglos aplicados

### Bug A — Streaming NL→Budget no llegaba al UI

**Síntoma:** logs del servidor mostraban Architect + Surveyor + Firestore hybrid search, pero el panel se quedaba en "Analizando…" 60 s hasta que la action retornaba.

**Causa raíz:** mismatch de IDs. La action generaba `generatedBudgetId = uuidv4()` y emitía a `pipeline_telemetry/{generatedBudgetId}/events`, pero el UI abría el EventSource con `leadId` (fallback porque `generationProgress.budgetId` todavía era `undefined`). Dos canales distintos.

**Fix (Fase A1/A2):**
- El **cliente genera `budgetId` antes de llamar a la action**, lo pasa a `setGenerationProgress` y como parámetro de la action (`providedBudgetId`). Aplicado a `generate-budget-from-specs`, `generate-public-demo`, `generate-demo-budget` y `extract-measurement-pdf`.
- La action Node del NL ahora emite también eventos granulares alrededor de cada agente: `query_expansion_started`, `vector_search_started/_completed`, `judge_evaluating`, y un `budget_completed` final.
- Tras la Fase E la action pasó a ser proxy al Python, pero el principio (cliente dueño del `budgetId`) se mantiene.

### Bug B — Doble estado visual en PDF→Budget

**Síntoma:** al subir un PDF aparecían simultáneamente la tarjeta "Procesando Documento (Tool Activa)" y el panel dinámico `BudgetGenerationProgress`.

**Fix (Fase B):** eliminado el JSX de `state === 'processing_pdf'` en el chat. El panel dinámico, que sí consume telemetría en vivo, es la única fuente visual. `handleConfirmPdfStrategy` genera el `budgetId` en cliente y lo propaga al panel y al action.

### Bug C — `ValidationError` del Python por JSON truncado

**Síntoma:** `Invalid JSON: EOF while parsing a string at line X column Y` en `RestructureChunkResult`, con 5 retries exponenciales agotándose y abortando la extracción completa del PDF.

**Fix (Fase C):**
- [`gemini_adapter.py`](../services/ai-core/src/budget/infrastructure/adapters/ai/gemini_adapter.py) — `maxOutputTokens: 8192` por defecto (parametrizable).
- [`pdf_extractor_service.py`](../services/ai-core/src/budget/application/services/pdf_extractor_service.py) — schema fallback `RestructureChunkResultMinimal` (solo `code`/`description`/`quantity`). Si el schema completo falla, reintenta con el minimal (`max_output_tokens=4096`) y emite `extraction_retry_minimal`. Si ambos fallan, emite `extraction_failed_chunk` y **continúa con el resto de páginas** en lugar de abortar el job.

**Fix v2 (iteración posterior — el truncamiento persistía porque los retries del schema completo con `temperature=0.0` eran deterministas):**
- **Salvage JSON truncado en el adapter** ([`gemini_adapter.py`](../services/ai-core/src/budget/infrastructure/adapters/ai/gemini_adapter.py) — `_salvage_truncated_json`): recorre el array `items` balanceando llaves/strings (respetando escapes `\"`) y corta al último `}` cerrado. El adapter retorna los items rescatados **sin retry**, con `usage['_salvaged'] = True` para que el extractor emita telemetría.
- `base_delay` bajado de 4.0 s → 2.0 s (backoff máximo 2→4→8→16→32 s).
- `maxOutputTokens=16384` en la llamada principal del INLINE (doble del default).
- `temperature=0.15` en la llamada principal — rompe el determinismo del truncamiento que hacía que los 5 retries reprodujeran el mismo fallo.
- Semáforo concurrencia **8** (antes 15) — reduce presión en quota cuando varias páginas fallan simultáneamente.
- Evento nuevo `extraction_partial_success {page, items_recovered}` — visible en timeline UI y panel admin.
- **Prompt endurecido (crítico para dominio)**: regla explícita de **TRANSCRIPCIÓN LITERAL** en [`restructure_image_vision.prompt`](../services/ai-core/prompts/restructure_image_vision.prompt). Prohibido resumir/parafrasear descripciones — rompería el matching 1:1 / 1:N contra el libro de precios vectorizado. La prevención del truncamiento se consigue **recortando el número de partidas por respuesta** (10 si descripciones >400 chars, hasta 15 si <200), no la longitud de cada descripción. El extractor itera con `has_more_items: true` hasta completar la página.

### Bug D — Endpoint Python sin autenticación

**Fix (Fase D):** middleware `InternalTokenMiddleware` en FastAPI que valida `x-internal-token` para todas las rutas `/api/v1/jobs/*`. `INTERNAL_WORKER_TOKEN` se configura en `.env` (Next) y `env.yaml` (Python). Si está vacío (dev local), se permite el acceso para no bloquear; en producción siempre debe estar configurado.

### Bug E — Retries exponenciales agotaban el tiempo del job

**Parcialmente mitigado por Fase C:** al reducir el ratio de fallos con `max_output_tokens` + fallback minimal, los retries de 5 intentos se activan mucho menos. Los retries siguen ahí para robustez ante 429/network.

---

## 5. Migración NL→Budget a Python (Fase E)

**Motivación:** centralizar modelos, retries, catálogo COAATMCA y telemetría en un solo sitio. Eliminar la duplicación Node/Python.

**Entregables:**
- [`architect_service.py`](../services/ai-core/src/budget/application/services/architect_service.py) — port del `ArchitectAgent` TypeScript. Schema Pydantic `ArchitectResponse` + `DecomposedTask`. Carga `pdf_index_2025.json` desde [`services/ai-core/data/`](../services/ai-core/data/) (copiado de `src/lib/pdf_index_2025.json`).
- [`generate_budget_from_nl_uc.py`](../services/ai-core/src/budget/application/use_cases/generate_budget_from_nl_uc.py) — orquestador. Puentea `DecomposedTask` → `RestructuredItem` para reutilizar `SwarmPricingService` tal cual. Si Architect devuelve `ASKING`, lanza `AskingForClarificationError`.
- Nuevo endpoint [`POST /api/v1/jobs/nl-budget`](../services/ai-core/src/core/http/main.py) con `NlBudgetRequest` (Pydantic) + `BackgroundTask`.
- Node action [`generate-budget-from-specs.action.ts`](../src/actions/budget/generate-budget-from-specs.action.ts) reducida a proxy: construye narrativa, hace POST, devuelve `{budgetId, isPending: true}`.
- Tests de contrato: [`test_generate_budget_from_nl_uc.py`](../services/ai-core/tests/budget/application/test_generate_budget_from_nl_uc.py) — mocks del Architect y el SwarmPricing; valida assembly, totales y eventos.
- Smoke ICL: [`scripts/test_nl_budget_icl.py`](../services/ai-core/scripts/test_nl_budget_icl.py) — 5 casos (cocina, baño, obra nueva, fachada, integral) que disparan el endpoint real.

**Reutilizado del Python existente:** `GoogleGenerativeAIAdapter`, `FirestorePriceBookAdapter`, `FirestoreBudgetRepository`, `FirestoreProgressEmitter`, `SwarmPricingService`. Solo se añadió el Architect + el use case orquestador.

**Los agentes Node (`ArchitectAgent`, `SurveyorAgent`, `JudgeAgent`) se quedan en el repo por ahora** — ya no son invocados por `generate-budget-from-specs` pero `generate-public-demo.action.ts` los usa todavía (la demo pública sigue en Node por compat). Se limpiarán cuando también migremos la demo pública.

---

## 6. Observabilidad — Panel admin `/dashboard/admin/pipelines`

Ruta: [`/dashboard/admin/pipelines`](../src/app/[locale]/dashboard/admin/pipelines/page.tsx).

- Lista los últimos 50 jobs de `pipeline_telemetry/` con: `jobId`, `source` (nl/pdf/unknown, inferido), `startedAt`, duración, nº eventos, total estimado, estado (`completed`/`failed`/`in_progress`).
- Detalle en `[id]/page.tsx`: timeline cronológico de los eventos con offset relativo y payload JSON.
- Acceso desde el sidebar: "Analítica → Pipelines IA".

**Limitación conocida:** leer los últimos N jobs requiere un scan + `events.orderBy('timestamp')` por cada doc. Para volúmenes grandes, la siguiente iteración debe añadir un **doc-level summary** (status, source, startedAt, durationMs, itemCount) que se mantenga con una Cloud Function trigger sobre `events` y se lea directamente con `orderBy(startedAt desc).limit(50)`.

---

## 7. Contribuir

### Añadir un evento nuevo

1. Elige un tipo descriptivo (ej: `material_validated`).
2. Emite desde el productor (Node o Python):
   - Node: `emitGenerationEvent(budgetId, 'material_validated', {...})` (usa [`budget-generation.emitter.ts`](../src/backend/budget/events/budget-generation.emitter.ts)).
   - Python: inyectar el `IGenerationEmitter` y llamar `self._emit(budget_id, 'material_validated', {...})`.
3. Mapea en [`BudgetGenerationProgress.tsx`](../src/components/budget/BudgetGenerationProgress.tsx): añade el `case` en `eventToPhase()` y en `buildSubEvent()`.
4. Documenta el nuevo tipo en la tabla de la sección 3.

### Debuggear un job concreto

1. Obtén el `budgetId` — aparece en los logs del servidor y en la URL del panel admin.
2. Firestore → `pipeline_telemetry/{budgetId}/events` — ves los eventos en orden.
3. Cloud Run logs (Python): filtrar por `budgetId` o `leadId`.
4. Si no llega ningún evento al UI pero sí al Firestore → problema en el EventSource/SSE del cliente. Revisar `BudgetGenerationProgress` y el parámetro `budgetId` del EventSource.
5. Si no llega ningún evento al Firestore → problema del productor. Revisar credenciales de Firebase Admin en el servicio y que el emitter no silencie excepciones.

### Ejecutar el smoke-test ICL

```bash
cd services/ai-core
python scripts/test_nl_budget_icl.py --url http://localhost:8080 --token $INTERNAL_WORKER_TOKEN
# Solo un caso
python scripts/test_nl_budget_icl.py --case cocina
```

---

## 8. Pendiente / roadmap

- **Panel admin con doc-level summary** (escalabilidad para N jobs grandes).
- **OpenTelemetry** en Python para traces cross-request y correlación con los logs.
- **Migrar `generate-public-demo.action.ts` al Python** — hoy sigue en Node por compat con el límite de 1 presupuesto/demo.
- **Borrar los archivos** `architect.agent.ts`, `surveyor.agent.ts`, `judge.agent.ts` cuando la migración se valide en producción 2-3 días sin regresiones.
- **Cache de queries RAG** para reducir latencia cuando el mismo `task` se resuelve repetidamente.
- **Webhook de error** — si `extraction_failed_chunk` aparece > N veces, notificar al admin.

## 9. Sprint "Aprendizaje v1" — Fases 6.A → 6.G (v006, 2026-04-22)

### Contexto
El sprint Precisión v005 entregó un pipeline técnicamente correcto (normas, DAG, catálogo, conversiones de unidad, chips de auditoría) pero **estático**: cada corrección del aparejador se perdía al cerrar el presupuesto. Fase 6 cierra esa asimetría — el editor captura correcciones, Firestore las persiste y el Swarm las re-inyecta como ICL al Pro en corridas futuras.

### Entregables por fase

- **6.A** — Subdomain `src/budget/learning/` con puerto `IHeuristicFragmentRepository` + adapters `InMemory` y `Firestore` sobre la colección `heuristic_fragments`. Filtrado: `status='golden'` + tag `chapter:<NAME>` + edad ≤ 12 meses + similarity (difflib) ≥ 0.70 + count ≥ 2. Cobertura 93%.
- **6.B** — [CorrectionCaptureDialog.tsx](../src/components/budget-editor/table/CorrectionCaptureDialog.tsx) + [save-heuristic-correction.action.ts](../src/actions/budget/save-heuristic-correction.action.ts). Dispara al cambiar `unitPrice`/`unit` en [AIReasoningSheet.tsx](../src/components/budget-editor/table/AIReasoningSheet.tsx). Builder puro con 5 motivos canónicos (`descuento_proveedor`, `volumen`, `error_ia`, `calidad_premium`, `otro`).
- **6.C** — `_find_relevant_fragments` + `_format_fragments_as_icl` en [swarm_pricing_service.py](../services/ai-core/src/budget/application/services/swarm_pricing_service.py). El placeholder `{{golden_examples}}` del prompt del Pro deja de ser literal `"No Heuristics Configured Yet."` y recibe un bloque real con "PATRÓN APRENDIDO" cuando hay ≥ 2 fragments del mismo motivo + chapter.
- **6.D** — Campo `applied_fragments: Optional[List[str]]` en `BudgetPartida`. El Swarm prefija el `ai_resolution.reasoning_trace` con `[v006] Aplicado(s) fragment(s) #...`. Badge `AppliedFragmentsBadge` en el sheet del editor.
- **6.E** — [dependencies.py](../services/ai-core/src/core/http/dependencies.py) cableado con `catalog_lookup + rules (5650 chars) + dag + fragment_repo`. Antes el Swarm en producción HTTP operaba como v004 silenciosamente. Esta deuda técnica queda saldada.
- **6.F** — Re-run completo de los 3 goldens con el stack v006. Resultados en [eval_v005.json](../services/ai-core/evals/eval_v005.json) (nombre del archivo es legacy; contenido es v006):
  - **001 MU02/P030326 (INLINE/benchmark)**: `recall=0.626`, `canonical_case_matched=True`. `precision_1to1=0.0` — esperado, códigos RG ≠ COAATMCA (calibra con `precision_semantic` de 6.G).
  - **002 SANITAS DENTAL (ANNEXED/regression_guard)**: 64 partidas, 8 capítulos. Baseline v005 congelada.
  - **003 NL Reforma Baño (NL/qualitative)**: 3/3 capítulos obligatorios, PEM 4.578€ en rango, `passes=True`.
- **6.G** — Métricas recalibradas: `precision_semantic` (fuzzy ≥ 0.80 sobre descripción + chapter match) y `chapter_total_delta_weighted` (normalizado por PEM absoluto). Las legacy (`precision_1to1`, `chapter_total_delta_mean`) se mantienen en el JSON para comparabilidad histórica. 22 tests unitarios nuevos.

### Scripts operativos

- [seed_heuristic_fragments.py](../services/ai-core/scripts/seed_heuristic_fragments.py) — dry-run / `--commit` para sembrar fragments demo (DEMOLICIONES/volumen × 2, FONTANERIA Y GAS/descuento_proveedor × 2, SOLADOS Y ALICATADOS/calidad_premium × 1) y activar el loop ICL antes del deploy.

### Suite de tests
- Python: 413 passed / 2 skipped, 0 regresiones.
- Frontend: 68 passed (vitest), typecheck limpio.

### Pendiente inmediato (post-sprint)
- **Deploy a Cloud Run** del servicio `ai-core` con las nuevas deps inyectadas.
- **Smoke manual** de los 3 flujos (NL, PDF INLINE, PDF ANNEXED) en http://localhost:9002 para verificar que la UI persiste correcciones + las re-lee en la siguiente corrida del editor.
- **Re-aplicar métricas 6.G al `eval_v005.json` existente offline** — el runner se inició antes de 6.G; las métricas legacy están en el JSON, las nuevas pueden derivarse sin volver a tasar (mismo `matches`, nuevas fórmulas).
- **Renombrar archivo de salida** del runner de `eval_v005.json` a `eval_v006.json` — hoy el nombre es legacy.

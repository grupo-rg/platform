# Dochevi · Whitepaper técnico del sistema actual

> **Versión:** 1.0 · 2026-05-19
> **Objetivo del documento:** describir con honestidad el estado real del
> sistema completo (frontend + backend + ai-core + infraestructura), sus
> flujos, sus fortalezas y su deuda técnica. Sirve como base de partida
> para decidir cambios arquitectónicos de fondo.

---

## 0. Resumen ejecutivo

Dochevi es una plataforma SaaS para constructoras y reformistas que
automatiza la generación de presupuestos detallados a partir de:

1. **Lenguaje natural** (descripción libre del proyecto).
2. **PDFs de mediciones** (formatos tipo BC3, Presto, plantillas Word/Excel).
3. **Conversación con un agente IA público** (chat web previo a la captación).

El sistema cubre además: gestión de leads (CRM), agenda con Google Calendar,
gestión de obras (proyectos), facturación de gastos, generación de SEO/blog
con IA, y un editor de presupuestos avanzado para revisión manual.

**El núcleo crítico es la generación de presupuestos a partir de PDFs de
mediciones**, que usa un pipeline asíncrono en Cloud Run Jobs con
checkpointing por partida, vector search sobre catálogo COAATMCA y
evaluación matemática con Gemini 2.5 (Flash/Pro). Es la operación que
mueve el resto del producto.

**Estado del sistema:** funcional en producción para casos de tamaño
moderado (<100 partidas) con riesgo operacional alto en casos grandes
(>500 partidas). El incidente 2026-05-18 reveló debilidades en el
subsistema de pricing (sin circuit-breaker, sin cancel cooperativo real,
sin timeouts por retry interno).

---

## 1. Stack tecnológico

### Frontend
- **Next.js 15** App Router · **React 18** · **TypeScript**
- **Tailwind CSS** + **ShadCN UI**
- **next-intl** (5 locales: `es`, `en`, `ca`, `de`, `nl`)
- **Firebase Web SDK** (Auth client-side, Firestore listeners)
- **@tanstack/react-query** (caching ligero)
- **react-pdf** (`@react-pdf/renderer`) para PDF del cliente
- **Genkit** (orquestación AI server-side)
- Hosting: **Vercel**

### Backend Node (server actions + API routes)
- 22 bounded contexts en `src/backend/` con estructura
  `domain / application / infrastructure`
- Firebase Admin SDK (Firestore + Storage + Auth)
- Domain events in-memory (sin pub/sub externo)
- Resend (email), Meta WhatsApp (parcial)

### Backend Python ai-core (`services/ai-core/`)
- **FastAPI 0.111** + Uvicorn (HTTP)
- **Pydantic 2.7** (validación)
- **PyMuPDF (fitz)** + **pdfplumber** (extracción PDF)
- **google-genai** SDK (Gemini)
- **firebase-admin** (Firestore desde Python)
- **google-cloud-run** (Cloud Run Jobs API)
- **google-cloud-storage** (GCS)
- **Qdrant** + **Firestore vector search**
- Python 3.11 · Docker

### Infraestructura
- **Google Cloud Platform** project `grupo-rg-a9929`, región `europe-southwest1`
  - **Cloud Run Service** `ai-core` (HTTP dispatcher, 1 CPU / 1 Gi / 60 s)
  - **Cloud Run Job** `ai-core-worker` (worker batch, 2 CPU / 2 Gi / 3600 s — ampliable a 86400 s)
  - **Cloud Tasks** (publicación programada de blog posts)
  - **Cloud Build** + **Artifact Registry**
  - **Firestore** (modo nativo)
  - **Cloud Storage** (buckets por contexto)
- **Vercel** (Next.js, cron jobs `re-engagement` + `recover-scheduled-blog-posts`)

### Modelos IA
| Componente | Modelo | Uso |
|---|---|---|
| Pricing (Swarm) | `gemini-2.5-flash` y `gemini-2.5-pro` | Evaluación matemática de partidas, reranking |
| Architect (NL → tasks) | `gemini-2.5-flash` | Descomposición proyecto en chapters/items |
| Vision (PDF) | `gemini-2.5-flash` (INLINE) y `gemini-2.5-pro` (ANNEXED) | Extracción mediciones desde imágenes |
| Embeddings | `gemini-embedding-001` (768 dims, truncado de 3072) | Vector search catálogo |
| Triage / Public chat | `gemini-2.5-flash` | Clasificación intención, conversación comercial |
| Editorial planner (blog) | `gemini-2.5-flash` | Generación de briefs editoriales |
| Metadata extractor (PDF) | `gemini-2.5-flash` | Auto-extracción cliente/título de primera página |

---

## 2. Arquitectura de alto nivel

```
                                     ┌──────────────────────────┐
                                     │   Cliente final (web)    │
                                     │  - Wizards públicos      │
                                     │  - Dashboard admin       │
                                     │  - Blog                  │
                                     └────────────┬─────────────┘
                                                  │
                                                  │ HTTPS
                                                  ▼
                ┌────────────────────────────────────────────────────────────┐
                │                    Next.js 15 (Vercel)                     │
                │  ┌──────────────────────────┐  ┌────────────────────────┐  │
                │  │  App Router · 5 locales  │  │  Server Actions (112)  │  │
                │  │  /api/* · SSE · crons    │  │  src/actions/*         │  │
                │  └──────────────────────────┘  └────────────────────────┘  │
                │           │                              │                 │
                │           │     ┌────────────────────────┘                 │
                │           ▼     ▼                                          │
                │  ┌───────────────────────────────────────────────────────┐ │
                │  │  src/backend/ — 22 bounded contexts                   │ │
                │  │  (budget, lead, project, crm, marketing, agenda, …)   │ │
                │  └───────────────────────────────────────────────────────┘ │
                └──────────────┬─────────────────────┬───────────────────────┘
                               │                     │
                  ┌────────────┘                     └──────────────┐
                  │                                                 │
                  ▼                                                 ▼
        ┌─────────────────────┐                          ┌──────────────────────┐
        │  Firebase           │                          │  GCP Cloud Run       │
        │  - Firestore        │◀────── ai-core ──────────│  Service: ai-core    │
        │  - Storage          │       (admin SDK)        │  (HTTP dispatcher)   │
        │  - Auth             │                          │                      │
        └──────────┬──────────┘                          │  Job: ai-core-worker │
                   │                                     │  (batch worker)      │
                   │                                     └──────────┬───────────┘
                   │                                                │
                   │                                                ▼
                   │                                     ┌──────────────────────┐
                   │                                     │  Gemini 2.5          │
                   │                                     │  (Flash / Pro /      │
                   │                                     │   Embedding-001)     │
                   │                                     └──────────────────────┘
                   │
                   │      ┌──────────────────────────────────────────────┐
                   └─────▶│  Servicios externos                          │
                          │  - Resend (email)                            │
                          │  - Meta WhatsApp (parcial)                   │
                          │  - Google Calendar (agenda)                  │
                          │  - Unsplash (imágenes blog)                  │
                          │  - Cloud Tasks (publicación blog programada) │
                          └──────────────────────────────────────────────┘
```

### Patrón maestro

- **Frontend** despliega en Vercel y consume Server Actions Next.js.
- Las Server Actions persisten directo a Firestore (admin SDK) para
  operaciones ligeras, o hacen *proxy* HTTP a `ai-core` para operaciones
  pesadas (generación de presupuestos).
- `ai-core` (Cloud Run Service) actúa como **dispatcher**: recibe la
  petición, persiste el `PipelineJob` en `queued`, y lanza una nueva
  ejecución de `ai-core-worker` (Cloud Run Job) pasándole el `JOB_ID`
  como env var.
- El worker hace todo el trabajo pesado (descarga PDF de Storage,
  extrae partidas, búsqueda vectorial, pricing con LLM, escribe Budget
  final en Firestore) durante minutos u horas.
- Firestore actúa como **bus de estado durable** — todo el progreso del
  job (status, checkpoints, errors) vive ahí.
- El frontend escucha via `onSnapshot` directamente o via SSE
  (`/api/budget/stream`).

---

## 3. Bounded contexts

| Módulo (en `src/backend/`) | Propósito |
|---|---|
| `agenda` | Calendario y bookings (Google Calendar + Domain Delegation) |
| `ai` | Orquestación de flujos / agentes Genkit (public, private, public-demo, core) |
| `ai-training` | Datos de entrenamiento + ICL/RLHF (Heuristic Fragments) |
| `analytics` | Telemetría de eventos (usuario, sesiones, conversiones) |
| `auth` | Sesiones Firebase + custom claim `admin` |
| `budget` | Generación, edición y persistencia de presupuestos |
| `catalog` | Catálogos de materiales |
| `chat` | Mensajería público y autenticada |
| `crm` | Leads + scoring + estados Kanban |
| `expense` | Gastos / facturas de obras |
| `lead` | Leads desde formulario web + chat público |
| `marketing` | Email sequences, blog publishing, content briefs |
| `material-catalog` | Catálogo editable por admin (Obramat) |
| `platform` | Configuración global, márgenes, datos empresa |
| `price-book` | Catálogo precios v2 (búsqueda semántica) |
| `project` | Proyectos (obras) y fases |
| `re-engagement` | Cron de reactivación de leads inactivos |
| `security` | Sanitización input, rate-limiting, audit logs |
| `shared` | Firebase admin init, events, Resend, Calendar |
| `user` | Perfiles + roles |

### Adicional: ai-core (Python, separado del Next.js)

| Módulo (en `services/ai-core/src/`) | Propósito |
|---|---|
| `pipeline_jobs` | Orquestación, state machine, checkpointing |
| `budget` | Pricing, extracción PDF, architect NL→tasks |
| `extractor` | Adapter PDF (pdfplumber) |
| `pipeline_telemetry` | Eventos en tiempo real |
| `core` | HTTP layer, worker entrypoint, bootstrap |

---

## 4. SUBSISTEMA CRÍTICO: generación de presupuestos

### 4.1 Modos de entrada

Existen 3 flujos para crear un presupuesto:

| jobType | Disparador | Input |
|---|---|---|
| `nl-budget` | Wizard chat conversacional | Narrative (texto libre) |
| `measurements` | Upload de PDF de mediciones (BC3/Presto) | PDF en Cloud Storage |
| `vision-extract` | Upload de PDF puramente visual | PDF + estrategia |

Los tres convergen en el mismo modelo de datos `Budget` con sus `BudgetChapter[]`
y `BudgetPartida[]`, y todos se ejecutan asíncronamente a través del mismo
`RunPipelineJobUseCase`.

### 4.2 Flujo NL → Budget

```
[Wizard chat]
    │
    │ 1. usuario describe proyecto en texto libre
    │
    ▼
[ClientPromptDialog]
    │
    │ 2. pide nombre cliente + título del presupuesto
    │
    ▼
[generateBudgetFromSpecsAction]
    │
    │ 3. construye narrative consolidado
    │    (specs + detectedNeeds + chatHistory)
    │
    ▼
[ai-core: /api/v1/jobs/dispatch jobType=nl-budget]
    │
    │ 4. crea PipelineJob en Firestore (status=queued)
    │ 5. lanza Cloud Run Job execution
    │
    ▼
[Cloud Run Job: ai-core-worker]
    │
    │ 6. claim_for_attempt (queued → running)
    │ 7. inicia heartbeat (30s) + cancellation_poller (5s)
    │
    ▼
[GenerateBudgetFromNlUseCase]
    │
    │ Fase 1: Architect (Gemini Flash) descompone narrative
    │         en List[DecomposedTask] con chapter + reasoning
    │
    │ Fase 2: convierte tasks en RestructuredItem[]
    │
    │ Fase 3: SwarmPricingService.evaluate_batch(items)
    │         → BudgetPartida[] (pricing + reranking + escalation)
    │         (resume_from checkpoints si retry)
    │
    │ Fase 4: assembly → BudgetChapter[]
    │
    │ Fase 5: bake_markup_into_budget (GG + BI + IVA)
    │
    │ Fase 6: FirestoreBudgetRepository.save(budget)
    │
    ▼
[mark_completed en PipelineJob]
    │
    │ 7. emit budget_completed
    │
    ▼
[UI recibe SSE/onSnapshot → muestra link al detalle]
```

### 4.3 Flujo PDF → Budget (measurements)

```
[Dashboard / Wizard PDF]
    │
    │ 1. usuario sube PDF (250pp típico, hasta 100MB)
    │
    ▼
[uploadPdfForPipelineJob]
    │
    │ 2. cliente sube PDF directo a Firebase Storage
    │    path: pipeline_uploads/{uid}/{jobId}/{filename}
    │    (no pasa por servidor — evita 512MB body limit)
    │
    ▼
[extractPdfMetadataAction (sync)]
    │
    │ 3. ai-core /api/v1/jobs/extract-metadata
    │    Gemini Flash sobre primera página
    │    → {clientName, budgetTitle, projectAddress, confidence}
    │
    ▼
[PdfMetadataPromptDialog]
    │
    │ 4. UI prerellena form con metadata, user confirma/edita
    │
    ▼
[dispatchPipelineJobAction jobType=measurements]
    │
    │ 5. PipelineJob queued con payload {gcsUri, strategy, clientName, budgetTitle}
    │ 6. Cloud Run Job execution
    │
    ▼
[Cloud Run Job: ai-core-worker]
    │
    │ 7. download PDF desde GCS
    │
    ▼
[BudgetPipelineRunner._run_pdf_pipeline]
    │
    │ 8. fitz convierte PDF → imágenes base64 (150 DPI, PNG)
    │    Hint: is_summatory = page >= total/2
    │
    ▼
[RestructureBudgetUseCase]
    │
    │ Fase 1: PdfExtractorService (INLINE o ANNEXED)
    │   ├─ INLINE: Flash + fallback heurístico pdfplumber para PDFs nativos
    │   │   Semaphore(8) → 250 páginas en lotes de 8 paralelas
    │   │   Hasta 4 iteraciones de retry por página si JSON truncado
    │   │
    │   └─ ANNEXED: Pro + map-reduce (descripciones || sumatorios)
    │       Semaphore(8) → join por code normalizado
    │
    │ Anti-alucinación:
    │   - stabilize_chapter_name (rechaza "[UNKNOWN]", "NO ESPECIFICADO")
    │   - consolidate_chapters FIFO + upgrade (primer nombre completo gana)
    │   - filtro fantasmas (code vacío descartado)
    │   - cross-page merge literal (preserva fidelidad)
    │
    │ Output: List[RestructuredItem]
    │   (~3.5 partidas/página → ~876 partidas en PDF 250pp)
    │
    ▼
[SwarmPricingService.evaluate_batch]
    │
    │ Por cada item del batch (con Semaphore(4)):
    │   1. _analyze_and_deconstruct (Flash) → queries
    │   2. _firestore_vector_swarm:
    │      - gemini-embedding-001 (3 queries)
    │      - top-k=4 candidatos (sin filtro previo por capítulo)
    │   3. _rerank_candidates (Flash) si ≥4 candidatos
    │   4. _select_tier (heurística local)
    │      - flash si score ≥0.85 + unit match
    │      - pro en cualquier otro caso (conservador)
    │   5. evaluate_chunk (Flash o Pro)
    │   6. Si Flash devuelve from_scratch / needs_human_review:
    │      → escalation a Pro (call adicional)
    │   7. Persist checkpoint por partida (idempotente por code)
    │   8. callback on_partida_resolved → checkpoint Firestore
    │
    ▼
[Assembly + Markup]
    │
    │ Grouping por chapter → BudgetChapter[]
    │ bake_markup_into_budget (Phase 17: PVP all-in)
    │
    ▼
[FirestoreBudgetRepository.save(budget)]
    │
    │ Budget final con calibrationVersion = 'phase17-markup-baked'
    │
    ▼
[mark_completed + emit budget_completed]
```

### 4.4 Componentes clave del pipeline (paths exactos)

| Componente | Path | Responsabilidad |
|---|---|---|
| `RunPipelineJobUseCase` | `services/ai-core/src/pipeline_jobs/application/use_cases/run_pipeline_job_uc.py` | Orquestador del worker: claim, heartbeat, cancel poll, runner, mark terminal |
| `BudgetPipelineRunner` | `services/ai-core/src/pipeline_jobs/infrastructure/budget_pipeline_runner.py` | Router PDF/NL al use case correcto + PDF→images |
| `RestructureBudgetUseCase` | `services/ai-core/src/budget/application/use_cases/restructure_budget_uc.py` | Pipeline PDF: extract → price → assembly → markup |
| `GenerateBudgetFromNlUseCase` | `services/ai-core/src/budget/application/use_cases/generate_budget_from_nl_uc.py` | Pipeline NL: architect → price → assembly → markup |
| `ArchitectService` | `services/ai-core/src/budget/application/services/architect_service.py` | NL → tasks. 34 capítulos COAATMCA. Status ASKING/COMPLETE |
| `InlinePdfExtractorService` | `services/ai-core/src/budget/application/services/pdf_extractor_service.py` | Vision Flash + fallback pdfplumber. Semaphore(8) |
| `AnnexedPdfExtractorService` | `services/ai-core/src/budget/application/services/pdf_extractor_service.py` | Vision Pro map-reduce |
| `SwarmPricingService` | `services/ai-core/src/budget/application/services/swarm_pricing_service.py` | Pricing batch con tier selector Flash/Pro, escalation, reranking |
| `MarkupDistributor` | `services/ai-core/src/budget/application/services/markup_distributor.py` | Distribuir GG + BI en partidas (calibration phase17) |
| `ReconciliationService` | `services/ai-core/src/budget/application/services/reconciliation.py` | Detectar divergencia entre breakdown y unitPrice |
| `GoogleGenerativeAIAdapter` | `services/ai-core/src/budget/infrastructure/adapters/ai/gemini_adapter.py` | Wrapper Gemini con retry + salvage de JSON truncado |
| `FirestorePriceBookAdapter` | `services/ai-core/src/budget/infrastructure/adapters/databases/firestore_price_book.py` | Vector search 768D sobre `price_book_2025` |
| `QdrantCatalogAdapter` | `services/ai-core/src/budget/infrastructure/adapters/databases/qdrant_catalog.py` | Vector search Qdrant `prices-2025-v004` |
| `FirestoreBudgetRepository` | `services/ai-core/src/budget/infrastructure/adapters/databases/firestore_budget.py` | Persistencia Budget aggregate |
| `FirestorePipelineJobRepository` | `services/ai-core/src/pipeline_jobs/infrastructure/firestore_pipeline_job_repository.py` | State machine + checkpoints |
| `CloudRunJobsExecutor` | `services/ai-core/src/pipeline_jobs/infrastructure/cloud_run_jobs_executor.py` | Wrapper de `google-cloud-run` SDK |
| `worker_main` | `services/ai-core/src/core/jobs/worker_main.py` | Entrypoint Job. SIGTERM handler. Exit codes |
| `dispatch_router` | `services/ai-core/src/core/http/dispatch_router.py` | Endpoints REST /dispatch, /cancel, /retry, /{jobId} |

### 4.5 State machine del PipelineJob

```
              ┌───────────┐
   create ───▶│  queued   │◀─────────── retry
              └─────┬─────┘
                    │ claim_for_attempt (atómico)
                    ▼
              ┌───────────┐
              │  running  │
              └─┬──┬──┬───┘
                │  │  │
        success │  │  │ cancellation_requested → SIGTERM → CancelledError
                │  │  │
                │  │  └────────────────┐
                │  │                   │
                │  │  error            │
                │  └──────────┐        │
                │             │        │
                ▼             ▼        ▼
          ┌──────────┐  ┌────────┐  ┌──────────┐
          │ completed│  │ failed │  │ canceled │
          └──────────┘  └────────┘  └──────────┘
                              │           │
                              └─── retry ─┘  (a queued)
```

Subcolecciones por job:
- `pipeline_jobs/{jobId}/attempts/{attemptId}` — historial de cada intento (executionName, startedAt/endedAt, status, error, partidasResolved)
- `pipeline_jobs/{jobId}/checkpoints/{partidaCode}` — checkpoint por partida (`code` como id ⇒ idempotente)

### 4.6 Catálogo COAATMCA y vector search

- **Fuente**: `coaatmca_2025_cuadros_base.json` + `construction_dag_2025.json`
- **Tamaño**: ~1,661 entradas, 34 capítulos (DEMOLICIONES, MOVIMIENTO DE TIERRAS, HORMIGONES, FORJADOS, CUBIERTAS, …)
- **Embeddings**: `gemini-embedding-001`, 3072 dims nativas → truncadas a **768 dims** (MRL es válido por diseño del modelo)
- **Storage**:
  - **Firestore vector fields** sobre colección `price_book_2025` (con kind=item/breakdown)
  - **Qdrant** colección `prices-2025-v004` (alternativa / backup)
- **Query típica**: top-k=4, sin filtro estructural previo por capítulo o unidad
- **Rerank**: invocación adicional a Gemini Flash si ≥4 candidatos
- **Filtro dimensional**: si `unit_dimension` del item no coincide, score se degrada por factor 0.3

---

## 5. Frontend

### 5.1 Estructura de rutas (Next.js App Router)

```
src/app/[locale]/
├── (public)/
│   ├── page.tsx                          ← landing
│   ├── services/page.tsx                 ← grid de servicios
│   ├── services/[category]/page.tsx
│   ├── services/[category]/[subcategory]/page.tsx
│   ├── budget-request/page.tsx           ← formulario público presupuesto
│   ├── presupuesto/rapido/page.tsx
│   ├── presupuesto/obra-nueva/page.tsx
│   ├── zonas/[zone]/page.tsx             ← cobertura geográfica
│   ├── contact/page.tsx
│   ├── hoja-de-ruta/page.tsx
│   ├── blog/page.tsx                     ← listado posts publicados
│   ├── blog/[slug]/page.tsx              ← detalle post (ISR 5 min)
│   └── aceptar-presupuesto/[token]/page.tsx
├── (auth)/
│   ├── login/page.tsx
│   └── signup/page.tsx
└── dashboard/
    ├── page.tsx                          ← home admin con KPIs
    ├── budget-request/page.tsx
    ├── admin/
    │   ├── budgets/page.tsx              ← listado con paginación + búsqueda
    │   ├── budgets/[id]/edit/page.tsx    ← editor con 30+ componentes
    │   ├── leads/page.tsx
    │   ├── leads/[id]/page.tsx
    │   ├── messages/page.tsx
    │   ├── prices/page.tsx
    │   ├── pdf-batch-extractor/page.tsx
    │   ├── ai-training/page.tsx
    │   ├── pending-items/page.tsx
    │   ├── security/page.tsx
    │   ├── traces/page.tsx
    │   └── traces/[traceId]/page.tsx
    ├── projects/page.tsx                 ← listado obras
    ├── projects/[id]/page.tsx            ← detalle con tabs overview/phases/financials/team
    ├── leads/page.tsx
    ├── leads/[id]/page.tsx
    ├── analytics/page.tsx
    ├── expenses/page.tsx
    ├── agenda/page.tsx
    ├── assistant/page.tsx                ← chat IA privado (SSE)
    ├── measurements/page.tsx
    ├── seo-generator/page.tsx            ← 5 tabs (Nuevo, Plan, Borradores, Calendario, Publicados)
    └── settings/
        ├── company/page.tsx
        ├── financial/page.tsx
        ├── budget/page.tsx
        └── pricing/page.tsx
```

### 5.2 API routes (Next.js)

| Endpoint | Tipo | Propósito |
|---|---|---|
| `GET /api/budget/stream?budgetId=X` | SSE | Telemetría pipeline (tail Firestore `pipeline_telemetry`) |
| `POST /api/assistant/stream` | SSE | Chat IA privado streaming |
| `GET /api/crm/deals` | REST | Listar deals Kanban |
| `POST /api/crm/deals/move` | REST | Mover deal entre fases |
| `POST /api/measurements` | REST | Webhook procesar medidas |
| `POST /api/marketing/sequences` | REST | Disparar secuencias email |
| `POST /api/marketing/blog/publish` | REST | Endpoint Cloud Task publicar blog |
| `POST /api/marketing/worker` | REST | Worker de tareas marketing |
| `GET /api/cron/re-engagement` | REST cron | Reactivar leads inactivos (diario 8 AM) |
| `GET /api/cron/recover-scheduled-blog-posts` | REST cron | Rescatar posts scheduled fallidos (cada 15 min) |
| `POST /api/dev-chat` | REST | Debug interno |

### 5.3 Server Actions (`src/actions/` — ~112 actions)

Organizadas por dominio. Las críticas:

- `budget/` (18): generación, edición, envío, aprobación
- `lead/` (17): OTP, perfil, conversaciones, configuración PDF
- `chat/` (9): admin/lead messaging
- `pipeline/` (5): dispatch, cancel, retry, extract-metadata
- `project/` (6): CRUD obras + fases + delete
- `expense/` (6): facturas + extracción AI
- `price-book/` (6): búsqueda semántica
- `material-catalog/` (5): catálogo materiales
- `marketing/` (5): blog post, editorial plan
- `analytics/` (3), `admin/` (4), `agenda/`, `crm/`, `attachments/`, `audio/`, `platform/`, etc.

### 5.4 Hooks principales

| Hook | Propósito |
|---|---|
| `useAuth` | Firebase user + signOut |
| `useBudgetEditor` | useReducer 600+ líneas: items, chapters, undo/redo, cost breakdown, markup scaling (3 calibration versions) |
| `usePipelineJob` | Firestore `onSnapshot` sobre `pipeline_jobs/{jobId}` + 30s tick |
| `usePipelineJobState` (derivation pure) | `canCancel`, `canRetry`, `isStale` (>5min sin heartbeat), `isTimedOut` (>90min) |
| `useToast` / `sileo` | Notificaciones (dos sistemas conviven) |
| `useBudgetWizard` | State del chat wizard NL |
| `usePriceBook` | React Query caching de búsquedas |

### 5.5 Contextos

- `AuthContext` (`src/context/auth-context.tsx`): `User | null`, `loading`, `signOut`
- `BudgetWidgetContext`: visibilidad del widget global de presupuesto + `leadId` (localStorage)

### 5.6 Componentes clave

- `BudgetWizardChat` — chat conversacional con `ClientPromptDialog` y `PdfMetadataPromptDialog`
- `BudgetEditorWrapper` + `BudgetEditorTable` — editor avanzado
- `BudgetGenerationProgress` — UI del pipeline en curso, lee SSE
- `PipelineJobControls` — Cancelar/Reintentar + banners stale/timeout
- `EditorialCalendar` — calendario blog mes 7×6 con drag&drop
- `EditorialPlanTab` — generador de plan editorial agéntico
- `EditBudgetClientDialog` — editar cliente/título desde editor
- `CreateProjectModal` — crear obra con tabs (con presupuesto / obra directa)

---

## 6. Subsistema SEO / Blog / Marketing

Estado actual: **plan completo Fases 0+1+2+3 ya construido** (sesión 2026-05-18).

### 6.1 Generación de posts

```
[Dashboard /seo-generator tab "Nuevo"]
    │
    ▼
[generateAndSaveBlogPostAction]
    │
    │ verifyAuth(admin) → generateBlogPostFlow
    │ → Gemini Flash structured output:
    │   { title, slug, metaTitle, metaDescription, keywords,
    │     tags, contentMarkdown, seoScore, imageAltText, imageQueryEN }
    │ → BlogPostService.createDraft → Firestore
    │ → prepareBlogCoverImage (Unsplash + Storage)
    │ → BlogPostService.update con heroImageUrl + atribución
    │
    ▼
[Draft persistido en blog_posts/{postId}]
```

### 6.2 Plan editorial agéntico (Fase 3)

```
[Tab "Plan editorial"]
    │
    │ admin elige: locale, weeks, postsPerWeek, seed keywords
    │
    ▼
[generateEditorialPlanAction]
    │
    │ paralelo:
    │   - analyzeContentGaps → cataloga huecos vs /services/*
    │   - searchKeywordIdeas → Google Trends scraping
    │
    ▼
[editorialPlannerFlow]
    │
    │ Gemini Flash structured output:
    │   N briefs (title, angle, primaryKeyword, secondaryKeywords,
    │   intent, proposedPublishAt, rationale, relatedServicePath)
    │
    ▼
[content_briefs/{briefId} con status='proposed']
    │
    │ admin revisa y aprueba 1 a 1
    │
    ▼
[approveBriefAction]
    │
    │ - status='generating'
    │ - generateAndSaveBlogPostAction (genera contenido full)
    │ - scheduleBlogPostAction (encola Cloud Task para publishAt)
    │ - status='generated' con generatedPostId
```

### 6.3 Scheduling y publicación

- **Cloud Tasks** encola tarea para `publishAt`
- Endpoint `POST /api/marketing/blog/publish` recibe el callback con `x-internal-token`
- `publishAtomically` (transacción Firestore) previene doble publicación
- Check `stale_task` ±2h: si la task vieja ejecuta tras un reschedule, salta
- **Cron de rescate** (`/api/cron/recover-scheduled-blog-posts`, cada 15 min): detecta `scheduled` vencidos sin publicar, reintenta con `MAX_RECOVERY_ATTEMPTS=3`, marca `failed` con razón si agota

### 6.4 Componentes UI

- `EditorialCalendar` — vista mes con drag&drop, slots vacíos sugeridos, retry visual de failed
- `EditorialPlanTab` — generador + lista de briefs propuestos
- Blog público con `rehype-sanitize` (XSS protection del markdown del LLM)

---

## 7. Subsistema CRM / Leads / Chat público

### 7.1 Captación de leads

3 fuentes:
1. **Formulario web** (`(public)/budget-request`) → `Lead` con `intake`
2. **Chat público** (widget global, agente `triage` → `public-commercial`)
3. **Admin manual** (`createAdminLeadAction`)

Lead → `verification` (OTP por email/SMS) → `qualification` (auto via score) → `intake` → optional `profile` (Typeform-style).

### 7.2 Sequences de marketing

- `Sequence` aggregate: pasos con canal (EMAIL/WHATSAPP), templateId, ABTestVariant, dayOffset
- `Enrollment` por lead con `nextExecutionTime`
- Templates A/B en `marketing-templates.ts` (Variante A "velocidad", Variante B "menos estrés")
- Cron `/api/cron/re-engagement` reactiva leads dormidos
- Worker `/api/marketing/worker` procesa cola

### 7.3 CRM Kanban

- Estados: NEW → CONTACTED → QUALIFIED → PROPOSAL_SENT → CLOSED_WON / CLOSED_LOST
- Listeners de domain events: `BudgetSent` → `PROPOSAL_SENT`; `BudgetAccepted` → `CLOSED_WON`
- API REST `/api/crm/deals` + `/api/crm/deals/move`

---

## 8. Subsistema Agenda

- **Google Calendar API** con **Domain-Wide Delegation** (env: `GOOGLE_WORKSPACE_ADMIN_EMAIL`)
- Generación de Google Meet links automáticos
- Tools Genkit públicos para que el agente comercial agende: `list-available-slots`, `confirm-booking`, `reschedule-booking`, `cancel-booking`, `get-my-bookings`
- Domain events: `BookingConfirmed` → trigger email + WhatsApp templates `booking_reminder_24h`, `booking_reminder_1h`
- `NotifyAdminOnBookingUseCase` envía email transaccional al equipo de ventas

---

## 9. Subsistema Proyectos (Obras)

### 9.1 Modelo de datos

- `Project` aggregate: `budgetId` (opcional desde Fase B-1 recientemente), `leadId`, `clientSnapshot`, `name`, `address`, `phases[]`, `team[]`, status
- `ProjectPhase`: `name`, `order`, `status`, `progress`, `estimatedCost`, `realCost`, fechas estimadas y reales
- State machine: `preparacion` → `ejecucion` → `pausada` → `finalizada` → `cerrada`

### 9.2 Flujos clave

- **Crear obra desde presupuesto aprobado**: `ProjectService.createFromBudget` genera fases automáticamente desde los `chapters` del budget
- **Crear obra directa (sin presupuesto)**: `ProjectService.createWithoutBudget` — flujo añadido recientemente para casos donde el cliente contrata sin presu formal
- **Vincular gastos a fases**: `aggregatePhaseRealCosts(project, expenses)` cruza líneas de facturas por `phaseId` o `budgetChapter` matching
- **Alertas de desviación**: badge rojo si fase real > estimado × 1.1, ámbar entre 1.0-1.1
- **Curva de consumo de presupuesto**: SVG inline en tab Económico (línea plan vs real acumulado por mes)
- **Eliminar obra**: action con `AlertDialog` de confirmación

### 9.3 Componentes

- `ProjectManagerClient` con 4 tabs (overview, phases, financials, team)
- `EditableClientDialog` para modificar snapshot
- `CreateExpenseModal` integrable con `lockedProjectId` (contexto fijo de obra)

---

## 10. Auth y Security

- **Firebase Auth** con email/password
- **Session cookie** generado por `adminAuth.verifySessionCookie` server-side
- **Custom claims**: `admin: true` para acceso al dashboard administrativo
- `verifyAuth(requireAdmin)` middleware reutilizable en server actions
- **Firestore rules**: cliente solo puede crear/leer/cancel su `pipeline_jobs/{jobId}` (uid match), leer `blog_posts` publicados. Resto bloqueado, escritura solo vía admin SDK
- **Storage rules**: validación de MIME (`application/pdf`, `image/*`), tamaños máx por bucket (10/20/100 MB), auth requerida para `pipeline_uploads/`
- **Input sanitization** en chat público (detecta intentos de prompt injection)
- `rehype-sanitize` en viewer de blog (XSS guard contra markdown del LLM)

---

## 11. Almacenamiento de datos

### 11.1 Colecciones Firestore principales

| Colección | Contenido | Acceso |
|---|---|---|
| `leads/{leadId}` + subcolecciones | Perfiles + conversaciones + intake | Admin SDK |
| `budgets/{budgetId}` | Budget aggregate con chapters/items | Admin SDK |
| `pipeline_jobs/{jobId}` + `attempts/` + `checkpoints/` | Jobs del pipeline + estado durable | Cliente puede leer propio, admin SDK escribe |
| `projects/{projectId}` | Obras con fases y equipo | Admin SDK |
| `expenses/{expenseId}` | Facturas/gastos vinculados a obra | Admin SDK |
| `price_book_2025/{itemId}` | Catálogo precios con embeddings 768D | Solo lectura admin SDK |
| `heuristic_fragments/{id}` | ICL/RLHF fragments con embedding | Admin SDK |
| `pipeline_telemetry/{jobId}/events/{eventId}` | Eventos SSE con TTL 12h | Cliente lee, admin SDK escribe |
| `generation_events` | Eventos legacy del wizard | Admin SDK |
| `blog_posts/{postId}` | Blog público (Fases SEO) | Cliente lee, admin SDK escribe |
| `content_briefs/{briefId}` | Briefs editoriales propuestos | Solo admin SDK |
| `mail/{mailId}` | Cola para Resend | Cliente puede `create` |
| `analytics/{docId}` | Eventos tracking | Cliente puede `write` |

### 11.2 Cloud Storage (buckets)

| Bucket / path | Contenido | Tamaño máx | Lifecycle |
|---|---|---|---|
| `pipeline_uploads/{uid}/{jobId}/` | PDFs antes de procesar | 100 MB | Auto-delete 7 días |
| `budget-multimedia/` | PDFs y JPEGs en presupuestos | 10 MB | — |
| `dream-renovator/` | Assets demos públicos | — | — |
| `renders/` | Renders IA (públicos y privados) | — | — |
| `uploads/` | Genéricos | 10 MB | — |
| `public_uploads/` | Subidas desde chat público | 10 MB | — |
| `admin/price-books/` | Source price books (admin only) | — | — |
| `blog-images/{postId}/` | Cover images de blog | — | — |

---

## 12. Observabilidad y telemetría

### 12.1 Telemetría operacional del pipeline

- Eventos durante generación (persistidos en `pipeline_telemetry/{jobId}/events`):
  - `extraction_started`, `subtasks_extracted`
  - `vector_search` (con candidatos)
  - `tier_assigned` (flash/pro decision)
  - `tier_escalated` (Flash → Pro fallback)
  - `pricing_complete` (por partida)
  - `checkpoint` (partida persistida en Firestore)
  - `budget_completed`, `extraction_failed_chunk`
- Frontend escucha via SSE (`/api/budget/stream?budgetId=...`)
- TTL: eventos expiran 12h

### 12.2 Lo que NO existe (gap importante)

- **No hay métricas agregadas** (% partidas en Pro, latencia p95, tasa de 503s, % escalación). Tienes que rebuscar Firestore para sacarlas.
- **No hay alertas automáticas** de Cloud Monitoring contra job zombi, fallback rate alto, etc.
- **No hay dashboard de salud Gemini** (rate de errores, latencia por modelo).
- **No hay tracing distribuido** (OpenTelemetry, Datadog, Honeycomb).
- **Logs de Cloud Run** solo accesibles via GCP Console, no integrados en el dashboard admin.

### 12.3 Heartbeat + watchdog

- Worker actualiza `pipeline_jobs/{jobId}.updatedAt` cada 30s
- Frontend deriva:
  - `isStale = status==='running' && now - updatedAt > 5min`
  - `isTimedOut = status==='running' && now - startedAt > 90min`
- UI muestra banners amarillo/rojo según estado

---

## 13. Análisis de costes (estimaciones)

### 13.1 Por flujo

| Flujo | Tokens promedio | Coste estimado |
|---|---|---|
| **NL → Budget** (~50 tasks) | ~150k input + 100k output (Flash/Pro mix) | ~$0.50-1.50 |
| **PDF → Budget pequeño** (~50 partidas) | ~300k input + 200k output | ~$1-3 |
| **PDF → Budget medio** (~200 partidas, 80pp) | ~1.2M input + 800k output | ~$5-10 |
| **PDF → Budget grande** (~876 partidas, 250pp) | ~5M input + 3M output (depende del % Pro) | ~$30-150 |
| **Blog post completo** (Flash) | ~10k input + 8k output | ~$0.01-0.02 |
| **Plan editorial** (N briefs) | ~50k input + 30k output | ~$0.05-0.10 |
| **Extract metadata PDF** (1ª página) | ~5k input + 1k output | ~$0.001 |
| **Triage / chat público** (1 turno) | ~5k input + 2k output | ~$0.001-0.005 |

### 13.2 Drivers principales

1. **PDF grande con alta tasa de escalación a Pro** — caso atípico que aplastó al incidente de 2026-05-18. Si 60% de las partidas escala a Pro → coste ×10.
2. **Vision API en PDFs visuales puros (ANNEXED con Pro)** — más caro que INLINE con Flash.
3. **Reranking con LLM Flash** (~$0.01/partida) cuando hay ≥4 candidatos — 100× más caro que un cross-encoder dedicado.

---

## 14. Fortalezas del sistema actual

1. **Arquitectura hexagonal limpia** en backends (Next + Python): domain / application / infrastructure separados, ports/adapters.
2. **Pipeline asíncrono real** con Cloud Run Jobs y state machine durable. Es lo correcto para batch >5 min.
3. **Checkpointing por partida** — los reintentos no recomputan trabajo ya hecho. Ahorra dinero y tiempo.
4. **Atomicidad de transiciones** vía Firestore transactions (`publishAtomically`, `claim_for_attempt`).
5. **Manejo de SIGTERM** en worker para cancelación cooperativa básica. Exit codes diferenciados (0/1/2/143).
6. **Salvage de JSON truncado** en `gemini_adapter.py` — recupera respuestas LLM cortadas por límite de tokens.
7. **Anti-alucinación en extracción**: `stabilize_chapter_name`, `consolidate_chapters` FIFO, filtros de fantasmas.
8. **Auto-extracción de metadata** (cliente/título) desde primera página del PDF.
9. **Plan editorial agéntico** con human-in-the-loop (admin aprueba briefs, no posts ciegos).
10. **i18n completa** en 5 locales con localized pathnames.
11. **Override operacional** `FORCE_FLASH_PRICING` (recién añadido) para degradar Pro→Flash sin redeploy.
12. **Cron de rescate** para posts blog scheduled fallidos.
13. **Test suite Python** con ~80 archivos, marker `firestore` para tests con emulator.

---

## 15. Debilidades y deuda técnica

### 15.1 Críticas (afectan producción HOY)

| # | Problema | Localización |
|---|---|---|
| 1 | **`SwarmPricingService` no checkea `cancellation_event`** — cancel del usuario no se materializa hasta que el swarm devuelve | `swarm_pricing_service.py` |
| 2 | **Sin timeout por retry** en `gemini_adapter.py` — solo timeout total httpx 300s. Retries internos pueden bloquear el slot del semaphore indefinidamente | `gemini_adapter.py:164` |
| 3 | **Sin circuit breaker Pro→Flash automático** — depende de un humano flipear env var manualmente | — |
| 4 | **`Semaphore(4)` saturable bajo carga** — 4 slots atascados en Pro con 503s = sistema zombi | `swarm_pricing_service.py:749` |
| 5 | **No hay vista global de jobs en el dashboard** — operador huérfano al hacer reload, depende de URL del wizard | — |
| 6 | **Conversación del wizard NO se persiste** — reload pierde contexto visual del pipeline activo | `useBudgetWizard.ts` |
| 7 | **`stabilize_chapter_name` sin estado** — ordenamiento de partidas no determinista produce duplicados de capítulo que `consolidate_chapters` luego repara | `pdf_extractor_service.py` |
| 8 | **No hay determinismo de `code`** — mismo PDF dos veces puede producir códigos diferentes → checkpoints inútiles en retry | `pdf_extractor_service.py` |
| 9 | **Sin cap superior de partidas** — PDF de 500pp produciría 1500+ partidas, tardaría 24h | — |

### 15.2 Importantes (ineficiencias estructurales)

| # | Problema |
|---|---|
| 10 | Reranking con LLM Flash en vez de cross-encoder dedicado (~$0.01/partida vs $0.0001) |
| 11 | Sin filtro estructural (capítulo/unidad) antes de vector search — busca en 1,661 entradas globales |
| 12 | Top-k = 4 demasiado bajo para catálogo técnico con sinónimos en español |
| 13 | Embeddings Gemini-001 son genéricos — un fine-tuning sobre COAATMCA daría +20-30% precisión |
| 14 | Catálogo COAATMCA tiene **unit mismatches** (data quality) que fuerzan ~30% de las partidas a Pro innecesariamente |
| 15 | Sin caché por hash(description + unit) — repetir misma partida en N PDFs duplica coste |
| 16 | `CHUNK_SIZE=1` en swarm: el agrupamiento adaptativo es teatro, no hay batching real |
| 17 | Sin observabilidad agregada (% Pro, tasa de fallos, latencia p95) — no se puede operar con datos |
| 18 | Dos sistemas de toast conviven (Radix + Sileo) — UI inconsistente |
| 19 | Sin métricas de coste por presupuesto reales en el dashboard |
| 20 | Sin export del Budget en BC3/Presto/Excel — solo PDF |

### 15.3 Operacionales

| # | Problema |
|---|---|
| 21 | Sin alertas automáticas (Cloud Monitoring no configurado para zombi, fallback rate, etc.) |
| 22 | Logs de Cloud Run solo accesibles vía GCP Console |
| 23 | Sin tracing distribuido (OpenTelemetry / Datadog / Honeycomb) |
| 24 | El operador (admin) no puede cancelar/reintentar desde una vista global — solo desde el wizard que lanzó el job |
| 25 | El `EmailProviderPort` solo expone `sendDirectEmail`; el resto de canales (SMS, push) no tiene puerto unificado |
| 26 | Sin admin REST endpoints (ej. `/admin/jobs/list`, `/admin/jobs/{id}/force-cancel`) accesibles sin pasar por la UI |

### 15.4 Producto / UX

| # | Problema |
|---|---|
| 27 | Wizard NL no garantiza unicidad de `clientName` → puede duplicar leads idénticos |
| 28 | Editor de budget tiene 600+ líneas en un solo reducer — alto riesgo de bugs en undo/redo |
| 29 | No hay vista de "presupuestos en curso" globales del cliente — solo el que está editando |
| 30 | Sin notificaciones in-app (toast persistente con CTAs) — solo email externo |

---

## 16. Preguntas abiertas para próximo diseño

Las decisiones arquitectónicas pendientes que merecen un estudio dedicado:

1. **¿Es Gemini 2.5 el modelo correcto para pricing?**
   - Pros: integración GCP, precio bajo, contexto 1M
   - Contras: SLA pobre vs Vertex, 503s frecuentes, retries internos no controlados
   - Alternativas a estudiar: Claude Sonnet 4.5, GPT-4.1, modelo dedicado fine-tuned

2. **¿Vector search puro es suficiente o hace falta hybrid?**
   - BM25 + vector mejoraría recall en jerga técnica española
   - Filtro estructural previo (capítulo/unidad) reduce el espacio de búsqueda 30×
   - Cross-encoder reranker dedicado reduce coste de rerank 100×

3. **¿El catálogo COAATMCA es la fuente de verdad correcta?**
   - 1,661 entradas + posibles data quality issues
   - Auditar y normalizar units / chapters podría reducir 30% del coste de pricing

4. **¿Cloud Run Jobs + DIY orchestration es la elección correcta?**
   - Funciona pero requiere construir mucha capa operacional (panel admin, alertas, retries inteligentes)
   - Alternativas serias: **Temporal Cloud** (~$200/mes, batería incluida), **Inngest** (free 50k runs/mes)
   - Migración: 1-2 semanas

5. **¿Cómo garantizamos determinismo en la extracción?**
   - Sin él, el checkpoint resume es teatro: si los códigos cambian entre intentos, los 457 checkpoints heredados no se materializan
   - Soluciones: temperatura 0 + system prompt anti-creatividad + post-process determinista (sorted by page + position)

6. **¿Es viable un layout-aware parser determinista para PDFs nativos?**
   - pdfplumber ya existe como fallback heurístico
   - Una pasada layout-first (Docling/Pix2Struct) reduciría llamadas LLM 70% para PDFs nativos
   - Vision-LLM solo para PDFs escaneados/visuales

7. **¿Cómo limitar tamaño de presupuesto?**
   - Cap de N partidas máx por job, con split a sub-jobs si excede
   - Previsión de duración antes del dispatch ("este PDF tardará 90 min, ¿confirmar?")
   - Modo "estimación rápida" para PDFs grandes (samplea 20% + extrapola)

8. **¿Cómo hacer cooperativa real la cancelación dentro del swarm?**
   - Pasar `cancellation_event` al `evaluate_batch`
   - Checkear `event.is_set()` entre cada partida resuelta
   - `asyncio.wait_for(llm_call, timeout=60s)` por llamada

---

## 17. Anexo A: paths críticos de implementación

```
services/ai-core/
├── src/
│   ├── pipeline_jobs/
│   │   ├── domain/entities.py
│   │   ├── domain/exceptions.py
│   │   ├── application/
│   │   │   ├── ports/
│   │   │   │   ├── job_repository.py
│   │   │   │   ├── job_executor.py
│   │   │   │   ├── pdf_storage.py
│   │   │   │   └── pipeline_runner.py
│   │   │   └── use_cases/run_pipeline_job_uc.py
│   │   └── infrastructure/
│   │       ├── firestore_pipeline_job_repository.py
│   │       ├── in_memory_pipeline_job_repository.py
│   │       ├── cloud_run_jobs_executor.py
│   │       ├── gcs_pdf_storage.py
│   │       └── budget_pipeline_runner.py
│   ├── budget/
│   │   ├── domain/entities.py
│   │   ├── application/
│   │   │   ├── ports/ports.py
│   │   │   ├── services/
│   │   │   │   ├── architect_service.py
│   │   │   │   ├── swarm_pricing_service.py
│   │   │   │   ├── pdf_extractor_service.py
│   │   │   │   ├── markup_distributor.py
│   │   │   │   ├── reconciliation.py
│   │   │   │   ├── budget_metadata_extractor.py
│   │   │   │   └── breakdown_normalizer.py
│   │   │   └── use_cases/
│   │   │       ├── restructure_budget_uc.py
│   │   │       ├── generate_budget_from_nl_uc.py
│   │   │       └── extract_budget_from_pdf.py
│   │   ├── catalog/
│   │   │   ├── domain/construction_dag.py
│   │   │   └── infrastructure/adapters/
│   │   ├── infrastructure/
│   │   │   ├── adapters/
│   │   │   │   ├── ai/gemini_adapter.py
│   │   │   │   ├── databases/firestore_budget.py
│   │   │   │   ├── databases/firestore_price_book.py
│   │   │   │   └── databases/qdrant_catalog.py
│   │   │   └── events/firestore_emitter.py
│   │   └── learning/  (ICL/RLHF fragments)
│   └── core/
│       ├── http/
│       │   ├── main.py
│       │   ├── dispatch_router.py
│       │   └── dependencies.py
│       ├── jobs/worker_main.py
│       ├── bootstrap.py
│       └── logging.py
└── cloudbuild.yaml

src/
├── app/[locale]/
│   ├── (public)/...
│   ├── (auth)/...
│   ├── dashboard/...
│   └── api/...
├── actions/
│   ├── budget/
│   ├── lead/
│   ├── project/
│   ├── pipeline/         (dispatch/cancel/retry/extract-metadata)
│   ├── marketing/        (blog-post, editorial-plan)
│   └── ...
├── backend/
│   ├── budget/           (Next-side domain + AI flows)
│   ├── lead/
│   ├── project/
│   ├── marketing/
│   ├── ai/               (Genkit flows + agents + tools + prompts)
│   ├── crm/
│   ├── agenda/
│   ├── re-engagement/
│   └── ...
├── components/
│   ├── budget/
│   ├── budget-editor/
│   ├── budget-request/
│   ├── projects/
│   ├── marketing/        (editorial-calendar, editorial-plan-tab)
│   ├── expenses/
│   └── layout/
├── hooks/
├── context/
├── i18n/
└── lib/

firestore.rules
storage.rules
firebase.json
vercel.json
package.json
next.config.js
```

---

## 18. Anexo B: comandos de operación

### Build + deploy ai-core

```powershell
$env:CLOUDSDK_PYTHON = "C:\Users\Usuario\AppData\Local\Google\Cloud SDK\google-cloud-sdk\platform\bundledpython\python.exe"
gcloud builds submit --config services/ai-core/cloudbuild.yaml services/ai-core
```

### Setear / quitar override Pro→Flash

```powershell
# Activar (degradar Pro a Flash)
gcloud run jobs update ai-core-worker --region=europe-southwest1 --update-env-vars=FORCE_FLASH_PRICING=true

# Desactivar (volver a Pro normal)
gcloud run jobs update ai-core-worker --region=europe-southwest1 --remove-env-vars=FORCE_FLASH_PRICING
```

### Cancelar manualmente una execution de Cloud Run Job

```powershell
# Listar executions
gcloud run jobs executions list --job=ai-core-worker --region=europe-southwest1

# Cancelar una concreta
gcloud run jobs executions cancel <EXECUTION_NAME> --region=europe-southwest1
```

### Sincronizar env vars Service → Job

```powershell
powershell -ExecutionPolicy Bypass -File services/ai-core/scripts/sync-job-env-from-service.ps1
```

---

## 19. Próximos pasos sugeridos (orden de prioridad)

Sin entrar en alternativas (eso queda para el estudio profundo que viene después de este documento), las acciones que sin discusión deberían suceder:

1. **Capa operacional**: `dashboard/admin/jobs` con vista global y controles (cancel/retry/force-fail). Persistencia del job activo en localStorage. Alertas Slack/email cuando zombi.
2. **Robustez del pricing**: cancellation cooperativa en swarm; timeout por retry en gemini_adapter; circuit-breaker Pro→Flash automático.
3. **Determinismo en extracción**: temperatura 0 + post-process determinista para garantizar mismo PDF → mismos códigos.
4. **Auditar catálogo COAATMCA**: detectar units mal etiquetadas, normalizar, reducir tasa de unit-mismatch.
5. **Cross-encoder reranker dedicado** (BGE / Cohere) en vez de Flash rerank.
6. **Filtro estructural pre-vector** (capítulo/unidad).
7. **Métricas agregadas en Cloud Monitoring**: tasa Pro/Flash, latencia p95, fallos 503, % escalación.
8. **Cap de partidas + chunking adaptativo** para PDFs >500 partidas.
9. **Persistencia del wizard chat** en Firestore (no en estado React efímero).
10. **Decisión sobre orquestación**: seguir con DIY mejorado, o migrar a Temporal/Inngest.

---

*Fin del documento. Este whitepaper se actualiza incrementalmente conforme
el sistema evoluciona. La próxima fase es el estudio comparativo de
arquitecturas alternativas, basado en los puntos del §16.*

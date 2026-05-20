# Sprint 4 — Multi-Layout PDF Extractor

> **Versión:** 1.0 · 2026-05-20
> **Estado:** aprobado, listo para Fase A0
> **Sprints anteriores:** Sprint 1+2+3.A+3.B completados.
> **Foco Sprint 4:** Reemplazar el extractor de PDFs cliente actual
>   (LLM Vision puro) por un sistema híbrido `pdfplumber + LLM Vision
>   fallback` con layout classifier.

---

## 0. Contexto crítico (post Sprint 3.B)

### Estado del sistema al iniciar Sprint 4

**Catálogo COAATMCA en Firestore** — limpio y completo:
- 1,661 items + 10,537 breakdowns + 12,198 embeddings (gemini-embedding-001 768-dim).
- 15 codes corregidos (11 sufijo unit + 4 truncados desambiguados `UXH010ca/cb/cc/cd`).
- `is_variable` preservado al 100% (962 true / 9,575 false).
- 56 breakdown codes truncados marcados con `_truncated_in_source: true` (pending revisión manual con PDF).
- Backup pre-reingest en `data/catalog_source/firestore_backup_pre_reingest_20260520T170135Z.json`.

**Matcher en producción (`ai-core` image `873b7125`)**:
- Sprint 1 optimizations active: Hybrid BM25+Vector RRF, BGE rerank, pricing cache, force Flash, semaphore=8, LLM timeout=60s.
- Sprint 2: cancellation cooperativa, circuit breaker, determinismo PDF, chunking adaptativo, BGE optimization (batching, pre-warm, top-k=5, kill-switch).
- Lazy BGE singleton (Service no carga modelo).
- Service 2 GiB + Job 2 GiB + maxRetries=0.
- env vars: `SWARM_CONCURRENCY=8`, `LLM_CALL_TIMEOUT_SECONDS=60`, `FORCE_FLASH_PRICING=true`, `ENABLE_BGE_RERANK=true`, `PIPELINE_UPLOADS_BUCKET=grupo-rg-a9929-pipeline-uploads`, `ADMIN_ALERT_EMAIL=correodeconsultoria@gmail.com`.

**Resultados del último smoke (post-reingest, budget `31217dbb-0063-48f0-8b49-587ebe579ae7`)**:
- 74 items totales · 3 chapters (todos "Sin título" por bug del extractor) · 34 needs_review.
- Match distribution: **44 1:1 (59%) + 9 1:N (12%) + 21 from_scratch (28%)**.
- Confidence: 40 con >90, 34 con 40-85.
- Tiempo: ~3 min. Sin OOM.
- Mejora vs smoke anterior: de **50% from_scratch a 28%**.

**Conclusión del análisis (`data/catalog_source/smoke_analysis_post_reingest.md`)**:
- ✅ Matcher funciona BIEN (72% matches válidos a pesar de input contaminado).
- ✅ Catálogo está COMPLETO y consistente.
- ✅ Reasoning del juez cognitivo razona correctamente (encuentra `DRF020` para "Eliminación de revestimiento yeso (techos)" a pesar del ruido).
- ❌ **El extractor del PDF cliente está roto**:
  - Cantidades siempre `qty=1.0` (PDF dice 10,000 = 10 m²) → **presupuesto 10x menor**.
  - Capítulos no detectados (todos "Sin Capítulo" en lugar de jerarquía `21 PATOLOGÍAS GRAVES / 01.1 PAT. 2 - FISURAS / 1.2.6`).
  - Descripciones contaminadas con notas + cantidades + subtotales.
  - Items duplicados (49 visibles en editor vs 74 en backend).

---

## 1. Decisión estratégica (modo crítico)

**El cuello del 50% from_scratch NO es el catálogo ni el matcher**. Es el extractor del PDF cliente.

### Inquietudes evaluadas

#### Inquietud 1: Multiplicidad de layouts PDF

Tipos observados:
- **standard**: partida + medición en misma fila/sección.
- **annexed**: partidas con descripciones al inicio del PDF, mediciones referenciadas por ID en sección posterior.
- **coaatmca_hierarchical**: jerarquía `21 / 01.1 / 1.2.6` (lo que vemos ahora).
- **cype_paragraph**: texto continuo de párrafos sin tabla estricta.
- **unknown**: layouts custom/escaneados.

**Respuesta**: Ni `pdfplumber especializado solo` (no escala a N variantes) ni `LLM Vision solo` (lento + no determinista para cantidades).
**Solución**: **híbrido 3-capa**: pdfplumber + layout classifier + parser específico por layout + LLM Vision como fallback para zonas ambiguas.

#### Inquietud 2: Catalog Builder Agent (DIFERIDO a Sprint 5)

Partidas `from_scratch` con razonamiento ya tienen good reasoning_trace ("CANDIDATOS ENJAMBRE: [] → estimo precio basándome en mercado"). En un futuro Sprint 5:
- Agente LLM genera propuesta de partida canonical sintética.
- Reglas de escalado (ej. baldosa 60x60 → 120x120 con cambios de m.o., calzos, material).
- UI admin: review/edit/approve.
- Aprobado → ingest a `price_book_2025` con `kind=item` + `_human_validated=true`.

**Ejemplo probado**: las 3 capturas del usuario (`RSP_MAR_60X60`, `RSP_MAR_80X80`, `RSP_MAR_120X120`) muestran que el sistema puede interpolar lógica constructiva consistente. Pero requiere arquitectura adicional (queue de propuestas, UI admin, ingest pipeline) → Sprint 5.

#### Inquietud 3: ¿El Sprint 4 reproducirá el dolor de Sprint 1-3?

**Riesgos identificados** (con probabilidad real):

| # | Riesgo | Probabilidad | Mitigación obligatoria |
|---|---|---|---|
| 1 | Nuevo extractor mete memoria al Service | Baja | Lazy loading en `dependencies.py`. pdfplumber ~10MB. |
| 2 | Bug S3-06 reaparece (artifacts como partidas) | Baja | Validación contextual (no solo regex). Tests golden. Feature flag. |
| 3 | Cambios rompen `restructure_budget_uc` | Baja | Misma interfaz pública (`RestructuredItem[]`). Tests regresión. |
| 4 | Layout classifier falla con PDF nuevo | Media | Fallback a LLM Vision puro = comportamiento actual. **No regresión**. |
| 5 | LLM Vision en zonas ambiguas → coste/tiempo sube | Media | Budget hard: max 5 calls/PDF + métrica `extractor_llm_fallback_rate`. |
| 6 | OOM Job worker con PDFs grandes | Media | Stream parsing + tests con PDF 50MB. |
| 7 | Cache hit rate baja temporalmente | Media | Esperable: descripciones limpias diferentes a contaminadas viejas. Cache se reconstruye 1 semana. |
| 8 | **Cantidades siguen incorrectas** | **ALTA** | Tests golden con qty esperada conocida. Assertion `qty != 1.0` para cantidades reales. |
| 9 | **Sprint tarda 2 semanas estabilizando edge cases** | **ALTA** | Trabajo SOLO con PDFs golden hasta tests 100%. NO deploy sin smoke local exhaustivo. |

**5 safety nets obligatorios** (no opcionales):
1. **Feature flag** `USE_MULTI_LAYOUT_EXTRACTOR=false` por defecto. Rollback en 30s.
2. **Comparator side-by-side**: V1 vs V2 con mismo PDF antes de activar flag.
3. **Métricas Cloud Monitoring**: `extractor_v2_layout_classified`, `extractor_v2_route_used`, `extractor_v2_llm_fallback_count`, `extractor_v2_duration_seconds`.
4. **Golden tests CI**: 3-5 PDFs golden en repo, tests bloquean merge.
5. **Mantener V1 deployado 2 semanas** (coexisten). Rollback es env var.

---

## 2. Plan Sprint 4 — Multi-Layout PDF Extractor

### Fase A0 — Spec (yo, 1 día)

**Inputs requeridos**:
- 3-5 PDFs reales del cliente con variantes de layout (anonimizar si tienen data sensible).
- Path en disco del usuario: pendiente de confirmar.

**Outputs**:
- `data/pdf_layouts/golden/*.pdf` (PDFs anonimizados copiados al repo).
- `data/pdf_layouts/LAYOUT_SPEC.md` con:
  - Tipos de layout observados (standard, annexed, coaatmca, cype-paragraph, ...).
  - Por cada tipo: coordenadas, fonts, regex de identificación.
  - Casos edge: notas multilínea, subtotales, partidas duplicadas, cross-page.
  - Output schema canonical (`RestructuredItem[]` con campos `code, description, unit, quantity, chapter, sub_chapter, notes, page`).

**Trabajo concreto**:
1. Script `explore_pdf_layout.py` (ya existe del catálogo) aplicado a cada PDF cliente.
2. Tomar 4-6 páginas representativas por PDF (inicio capítulo, partida normal, cross-page, anexo de medición si annexed, sub-capítulo).
3. Análisis manual del output JSON + capturas del PDF.
4. Redactar spec.

### Fase A — Backend (Agent A en worktree paralelo)

**Depende**: A0 spec completo.

**Path target**: `services/ai-core/src/budget/application/services/`

| Task | Descripción |
|---|---|
| A1 | `layout_classifier.py` — clasifica PDF en `standard \| annexed \| coaatmca_hierarchical \| cype_paragraph \| unknown` usando features de pdfplumber (tables count, hierarchy regex, sections, font analysis). |
| A2 | `parsers/{standard,annexed,coaatmca_hierarchical,cype_paragraph}.py` — un parser por layout. Output canonical: `RestructuredItem[]`. |
| A3 | `llm_vision_fallback.py` — invocar LLM Vision SOLO para zonas que el parser no logra (cobertura < 80%) o layout=unknown. Budget hard: max 5 calls/PDF, presupuesto monitorizado. |
| A4 | `multi_layout_extractor.py` — adapter principal. Plug-and-play replacement del `pdf_extractor_service.py` actual. Misma interfaz pública. |
| A5 | Tests integración con 3-5 PDFs golden + assertions (qty esperada, capítulos, partidas count). |
| A6 | Feature flag `USE_MULTI_LAYOUT_EXTRACTOR=false` por defecto en `restructure_budget_uc.py`. |
| A7 | Métricas Cloud Monitoring: `extractor_v2_layout_classified{type}`, `extractor_v2_route_used{route}`, `extractor_v2_llm_fallback_count`, `extractor_v2_duration_seconds`, `extractor_v2_partidas_extracted_total`. |

**Dependencias internas**: A1 → A2 → A3 → A4 → A5 → A6 → A7 (secuencial).

### Fase B — Frontend + Ops (Agent B en worktree paralelo)

**Depende**: A0 spec + parcialmente A4 (para B3).

**Path target**: `src/**`

| Task | Descripción |
|---|---|
| B1 | `/dashboard/admin/pdf-layout-test` — drop PDF → muestra classification + tabla de items extraídos con cantidades, capítulos. |
| B2 | Cards en `/dashboard/admin/model-health` con métricas extractor_v2_*. |
| B3 | Botón "Comparar V1 vs V2" en cada job de `/dashboard/admin/jobs/[jobId]` — corre extractor V2 sobre el mismo GCS PDF y muestra diff. |

**Dependencias internas**: B1 y B2 paralelos. B3 depende de A4 ready.

### Fase C — Validation (humano + claude, 2-3 días)

**Depende**: A5 + B1.

| Task | Descripción |
|---|---|
| C1 | Smoke local con `USE_MULTI_LAYOUT_EXTRACTOR=true`. 3 PDFs diferentes. Validar qty correcto + capítulos + partidas count. |
| C2 | Side-by-side comparator V1 vs V2 (via B3). Tomar decisión: ¿V2 mejor en todas las dimensiones críticas? |
| C3 | Si C2 positivo: smoke staging con flag=true. |
| C4 | Smoke staging con PDF real (no golden). Validar end-to-end. |
| C5 | Si C4 positivo: flag=true en producción. Mantener V1 deployado 2 semanas con rollback inmediato vía env var. |
| C6 | Cleanup post-2 semanas: borrar V1 si V2 estable. |

---

## 3. Métricas de éxito Sprint 4

| Métrica | Antes Sprint 4 | Objetivo Sprint 4 |
|---|---|---|
| Tiempo extracción PDF 14pp/74 partidas | ~3-5 min (LLM Vision) | **<30s** (pdfplumber-first) |
| Cantidades correctas | 0% (qty=1.0 siempre) | **>95%** |
| Capítulos detectados | 0% (todos "Sin Capítulo") | **>90%** |
| Partidas duplicadas | ~25 dupes en 74 items | **0** |
| Tiempo total smoke (74 partidas, end-to-end) | ~11 min | **5-7 min** |
| Coste smoke | $0.05 | **<$0.02** |
| from_scratch rate | 28% | **15-20%** (mejora indirecta por descripciones limpias) |
| Riesgo OOM Service | bajo (con lazy fix) | bajo (mantener lazy) |
| LLM Vision fallback rate | 100% (siempre se usa) | **<30%** (solo zonas ambiguas) |

---

## 4. Estimación

- **Optimista**: 8-10 días trabajo (~2 semanas calendario).
- **Pesimista**: 15-20 días (si edge cases requieren parsers nuevos).

**Hitos**:
- **Día 1**: Fase A0 spec completo.
- **Día 2-3**: Agents A + B lanzados en paralelo.
- **Día 8-10**: A5 + B1 listos. Validación local.
- **Día 11-14**: Staging + producción con flag.
- **Día 14-28**: Coexistencia V1+V2. Métricas monitorizadas.
- **Día 28+**: Cleanup V1.

---

## 5. Out of scope explícito

- **Catalog Builder Agent** (Sprint 5 con queue + UI admin + ingest pipeline).
- **Revisión manual de 56 breakdown codes truncados** del catálogo (puede esperar).
- **Augmentation del catálogo** con paráfrasis Flash ($0.14) — Sprint 5.
- **Fine-tuning de modelos** (bi-encoder, cross-encoder) — Sprint 5+.

---

## 6. Cuando volver del compact

1. **Leer este archivo completo**: `SPRINT_4_PLAN.md`.
2. **Leer specs de catálogo previos** (referencia para estilo y rigor):
   - `data/catalog_source/LAYOUT_SPEC.md` (catálogo COAATMCA).
   - `data/catalog_source/smoke_analysis_post_reingest.md` (último smoke).
3. **Esperar de mí (el usuario)**:
   - Path local a la carpeta con PDFs reales del cliente.
   - Permiso para copiar 3-5 al repo en `data/pdf_layouts/golden/`.
4. **Próxima acción inmediata (claude)**:
   - Listar los PDFs disponibles en la carpeta del usuario.
   - Elegir 3-5 con variantes de layout (clasificarlos rápido por inspección).
   - Anonimizar si hay data sensible (nombres cliente, direcciones).
   - Copiar a `data/pdf_layouts/golden/`.
   - Aplicar `explore_pdf_layout.py` a cada uno con páginas representativas.
   - Escribir `data/pdf_layouts/LAYOUT_SPEC.md` con análisis.
   - Reportar al usuario.

---

*Fin del plan Sprint 4. Versionado en git. Actualizar si scope cambia.*

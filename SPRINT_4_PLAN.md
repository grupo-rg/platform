# Sprint 4 — Multi-Layout PDF Extractor

> **Versión actual:** 2.0 (post Fase A backend) · 2026-05-20
> **Plan técnico detallado:** [`data/pdf_layouts/LAYOUT_SPEC.md`](data/pdf_layouts/LAYOUT_SPEC.md) v1.2 — fuente de verdad de decisiones técnicas. Este documento es el resumen ejecutivo + estado del sprint.
> **Sprints anteriores:** 1, 2, 3.A, 3.B completados (catálogo limpio + matcher operativo).
> **Foco Sprint 4:** Reemplazar el extractor de PDFs cliente con un parser determinista que cubra el 95%+ de los formatos del cliente Grupo RG en segundos, eliminando el silencio mortal del LLM Vision sobre PDFs grandes.

---

## Changelog del plan

- **v1.0** (mañana 20-may): Asumía 4 parsers nuevos + LLM Vision fallback. Estimación 8-10 días con 2 agentes paralelos. **Demostrado falso** tras Fase A0.
- **v1.1** (tarde 20-may): Detectado que el extractor heurístico existente (`try_heuristic_extraction`, Fase 9.2) ya está conectado pero falla 30/54 PDFs. Estimación bajada a 5-8 días. **Demostrado optimista** tras batch de 28 PDFs.
- **v1.2 FINAL** (noche 20-may): Verificado que `page.extract_tables()` de pdfplumber no detecta tablas en estos PDFs (whitespace alignment) y `extract_with_pdfplumber_first` produce falsos positivos masivos (bug S3-06). Solución: parser TABULAR coord-based nuevo usando `extract_words()` + agrupación por x-coords. Estimación 10-14 días.
- **v2.0** (cierre 20-may): Fase A backend ENTREGADA en una sesión. Parser TABULAR operativo, cobertura 96% sobre 28 PDFs Grupo RG, A9 anomaly detection cierra el silencio mortal del 14-may.

---

## Estado actual (cierre 2026-05-20)

### ✅ Fase A0 — Spec
- 33 PDFs analizados (5 goldens locales + 28 candidates 2025 del cliente Grupo RG).
- Layout dominante real identificado: **PRESTO CIFRE TABULAR** con jerarquía 1-4 niveles (CAPÍTULO → SUBCAPÍTULO → APARTADO → Partida).
- 3 fallback paths existentes (Fase 9.2 regex, S3-06 tablas, LLM Vision) evaluados y caracterizados.
- Spec persistido en `data/pdf_layouts/LAYOUT_SPEC.md` v1.2.

### ✅ Fase A backend — Parser TABULAR coord-based
- Módulo nuevo: `services/ai-core/src/budget/pdf_tabular_parser/` (1,757 LOC).
- Tests: 124 unitarios + 9 A9 + 8 sintéticos skipped + 5 golden = 141 tests verdes, 0 regresiones.
- Feature flag `USE_TABULAR_PARSER=false` por defecto. Rollback en 30s vía env var.
- Integrado en `InlinePdfExtractorService.extract` antes de los fast paths legacy.
- Campo `RestructuredItem.sub_chapter` añadido (opcional, retrocompatible).
- **Métricas medidas sobre 28 PDFs reales Grupo RG**:
  - **52/54 viable (96%)**
  - qty_rate medio: **99.98%**
  - chapter_rate medio: 99.75%
  - Tiempo PDF más grande (103 pp, 295 partidas): **8.5s** (vs LLM Vision ~5 min).

### ✅ Fase A9 — Anomaly detection (silencio mortal 14-may)
- `LayoutUnsupportedError` + `_enforce_llm_vision_budget()` (`MAX_LLM_VISION_PAGES=50` configurable).
- Aplicado en `InlinePdfExtractorService` y `AnnexedPdfExtractorService`.
- Si extractor cae a LLM Vision con >50 pp → aborta en <2s con SSE `pipeline_error` (errorType=EXTRACTOR_LAYOUT_UNSUPPORTED).
- 9 tests dedicados, verificado con RdLL 258pp.

### ✅ Smoke local end-to-end
- 3/3 escenarios pasan: PDF viable usa TABULAR, PDF no viable cae a Fase 9.2, RdLL aborta limpio.

### 🟡 Fase B frontend — En curso (agente background, 4-7h estimadas)
- `/dashboard/admin/pdf-layout-test`: drop PDF → fingerprint + items.
- Cards de métricas en `/dashboard/admin/model-health`.
- Render contextual de eventos SSE `tabular_parser_*` y `pipeline_error` en `BudgetGenerationProgress`.
- Endpoint admin proxy `POST /api/admin/test-pdf-layout` que invoca un nuevo `POST /api/v1/admin/test-tabular-parser` en ai-core.

### ⏳ Fase C — Validation + deploy
- Smoke local UI cuando Fase B esté listo.
- Deploy a Cloud Run (Service + Job) con `bash services/ai-core/scripts/deploy-sprint4.sh`.
- Smoke UI/UX desde frontend con PDF cliente real.
- Monitor 48h + ajustar threshold A9 si aparecen casos legítimos.

### ⏳ Fase D — Soporte PRESTO ANNEXED (RdLL 258pp) — out of Sprint 4 scope
- El PDF RdLL del incidente 14-may sigue cayendo a LayoutUnsupportedError (no a silencio).
- Solución requiere LLM single-shot mapping (130 partidas ↔ 95 sumatorios PRESTO internos `TC-X.Y`, `EL-X.Y`, `PC02.01`).
- Estimado 3-5h agente, deferido a Sprint 5 si Grupo RG lo necesita.

---

## Resultados medidos vs objetivos del spec v1.2

| Métrica | Antes Sprint 4 | Objetivo v1.2 | Resultado real |
|---|---|---|---|
| Cobertura PDFs Grupo RG | ~5% (1 de 28 funciona limpio) | >85% | **96%** |
| qty extraída correctamente | 0% (siempre 1.0) | >95% | **99.98%** medio |
| chapter detectado | 0% ("Sin Capítulo" siempre) | >90% | 99.75% medio |
| Tiempo PDF 100pp+ | ~5 min LLM Vision | <30s | **8.5s** |
| Falsos positivos partidas | masivos (bug S3-06) | 0 | 0 (40 tests dedicados) |
| Silencio mortal LLM Vision >50pp | sí (incidente 14-may) | no | **abort en <2s con SSE error** |
| Tests módulo nuevo | n/a | >100 | **141 verdes** |
| Regresiones full suite | n/a | 0 | **0** |

---

## Inventario técnico

### Commits Sprint 4 (locales, sin push)

```
a110fc4 test(sprint-4): smoke end-to-end pipeline con USE_TABULAR_PARSER=true
ef139cd feat(sprint-4): A9 anomaly detection — abort silencio mortal LLM Vision
c83a553 feat(sprint-4): sub_chapter campo opcional + validation script
5215e52 merge(sprint-4): backend agent — parser TABULAR coord-based (132 tests, 0 regresiones)
f7776a6 feat(sprint-4): parser TABULAR coord-based para PDFs PRESTO/CIFRE
e8e2f7a docs(sprint-4): LAYOUT_SPEC.md v1.2 + batch analyzer scripts
```

73 commits adicionales sin push de Sprints 1-3.

### Archivos clave del Sprint 4

**Backend Python — creados**:
- `services/ai-core/src/budget/pdf_tabular_parser/domain/{column,row,hierarchy,result}.py` (~436 LOC)
- `services/ai-core/src/budget/pdf_tabular_parser/application/{header_detector,column_mapper,row_grouper,hierarchy_tracker,partida_extractor,tabular_parser,restructured_adapter,spanish_number}.py` (~1,225 LOC)
- `services/ai-core/src/budget/pdf_tabular_parser/infrastructure/pdfplumber_adapter.py` (78 LOC)
- `services/ai-core/tests/budget/pdf_tabular_parser/*` (~1,449 LOC, 141 tests)
- `services/ai-core/tests/budget/test_a9_llm_vision_budget.py` (148 LOC, 9 tests)

**Backend Python — modificados**:
- `services/ai-core/src/budget/application/services/pdf_extractor_service.py` — añadidos `RestructuredItem.sub_chapter`, `_is_tabular_parser_enabled()`, `_enforce_llm_vision_budget()`, `LayoutUnsupportedError`, integración del TABULAR antes del legacy fast path.
- `services/ai-core/pytest.ini` — marker `golden` añadido.

**Scripts**:
- `services/ai-core/scripts/analyze_batch_pdf_layouts.py` — batch analyzer reutilizable.
- `services/ai-core/scripts/verify_heuristic_output.py` — diagnostic.
- `services/ai-core/scripts/validate_tabular_coverage.py` — validate parser sobre directorio.
- `services/ai-core/scripts/smoke_tabular_parser_local.py` — smoke end-to-end.
- `services/ai-core/scripts/deploy-sprint4.sh` — deploy bash.
- `services/ai-core/scripts/deploy-sprint4.ps1` — deploy PowerShell.

**Documentación**:
- `data/pdf_layouts/LAYOUT_SPEC.md` — spec técnico v1.2 (fuente de verdad).

**Análisis (gitignored, locales)**:
- `data/pdf_layouts/golden/*.pdf` — 5 PDFs golden.
- `data/pdf_layouts/comparative/*.pdf` — trio humano vs AI.
- `data/pdf_layouts/analysis/*.json,*.csv,*.md` — fingerprints + summary CSVs.

---

## ENV vars Sprint 4

| Var | Default | Descripción |
|---|---|---|
| `USE_TABULAR_PARSER` | `false` | Activa parser TABULAR coord-based en `InlinePdfExtractorService`. Si OFF, comportamiento pre-Sprint 4. |
| `MAX_LLM_VISION_PAGES` | `50` | Threshold A9: aborta con `EXTRACTOR_LAYOUT_UNSUPPORTED` si extractor cae a LLM Vision con más páginas. |

Vars existentes preservadas (no tocadas por Sprint 4): `SWARM_CONCURRENCY=8`, `LLM_CALL_TIMEOUT_SECONDS=60`, `FORCE_FLASH_PRICING=true`, `ENABLE_BGE_RERANK=true`, `PIPELINE_UPLOADS_BUCKET=...`, `ADMIN_ALERT_EMAIL=...`, `ENABLE_PDFPLUMBER_FIRST=false`, todas las `FIREBASE_*`, `GOOGLE_GENAI_API_KEY`, `INTERNAL_WORKER_TOKEN`.

---

## Eventos SSE nuevos (consumidos por Fase B)

```typescript
"tabular_parser_started"   → { totalPages: number }
"tabular_parser_completed" → { partidasCount, qtyRate, chapterRate, durationSeconds }
"tabular_parser_aborted"   → { reason: string, partidasExtracted: number }
"inline_fast_path_used"    → { partidas_count, method: "tabular_parser_coord_based" | ..., qty_rate?, chapter_rate? }
"pipeline_error"           → {
                                errorType: "EXTRACTOR_LAYOUT_UNSUPPORTED",
                                extractor: "InlinePdfExtractorService" | "AnnexedPdfExtractorService",
                                pagesAttempted: number,
                                maxPagesAllowed: number,
                                message: string,
                                suggestion: string
                              }
```

---

## Deploy

```bash
# Deploy con parser activado (recomendado tras smoke local)
bash services/ai-core/scripts/deploy-sprint4.sh

# Deploy con parser desactivado (sin cambios comportamiento — solo A9 activo)
bash services/ai-core/scripts/deploy-sprint4.sh --no-tabular

# Solo build, no toca env vars
bash services/ai-core/scripts/deploy-sprint4.sh --build-only

# Windows
powershell -File services/ai-core/scripts/deploy-sprint4.ps1
```

Tiempo estimado del deploy: 8-12 min (incluye pre-bake del modelo BGE en la imagen).

---

## Rollback Sprint 4

Si el parser TABULAR rompe algo en producción:

1. **Rollback inmediato (30s)**: `bash services/ai-core/scripts/deploy-sprint4.sh --no-tabular` (actualiza env var sin rebuild).
2. **Rollback completo (3-5 min)**: revertir a la imagen anterior con `gcloud run services update ai-core --image=<sha-anterior>`.

A9 anomaly detection es retrocompatible (solo añade un check antes del LLM Vision); para desactivarlo: `gcloud run services update ai-core --update-env-vars=MAX_LLM_VISION_PAGES=10000`.

---

## Pendientes post-Sprint 4

- **Push** de los 80+ commits a `origin/main` cuando Fase C esté validada.
- **PRESTO ANNEXED para RdLL** — Fase D opcional, LLM single-shot mapping (~3-5h agente).
- **`rank_bm25` install gap en venv local** — solo afecta dev local. Cloud Run lo instala via `requirements.txt`.
- **`reportlab` no en requirements.txt** — solo afecta tests sintéticos del módulo nuevo. Skip-pable.
- **Fase B frontend smoke con flag activado** — pendiente de la terminación del agente Fase B.

---

*Plan vivo. Actualizar tras cada fase. Versionado en git.*

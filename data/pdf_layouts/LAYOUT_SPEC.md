# LAYOUT_SPEC — PDFs cliente de mediciones (Sprint 4 Fase A0)

> **Versión:** 1.2 · 2026-05-20
> **Fase:** A0 (spec) — TERMINADA.
> **Autor:** Sprint 4 Fase A0 exploratory analysis.
> **Goldens:** `data/pdf_layouts/golden/*.pdf` (5 PDFs) + análisis batch sobre 28 PDFs de `00-golden-candidates-2025/`.
> **Changelog:**
> - **v1.0** — 4 PDFs iniciales analizados; layout dominante = INLINE_WITH_TITLES; plan 3-5 días.
> - **v1.1** — añadido RdLL 258pp; detectado layout PRESTO ANNEXED; plan 5-8 días.
> - **v1.2** — **batch 28 PDFs reales del cliente**. Confirmado: layout dominante = **PRESTO CIFRE TABULAR** (no MU02 ni SANITAS). `extract_with_pdfplumber_first` existe pero está **roto en producción** (genera falsos positivos: `"21"`, `"25 marzo 2025"`, `"01.1"` como partidas → kill switch `ENABLE_PDFPLUMBER_FIRST=false` activo). `page.extract_tables()` no funciona en estos PDFs (whitespace alignment, no líneas). **Plan revisado: 10-14 días con parser TABULAR coord-based nuevo**.

---

## 0. TL;DR para humanos cansados (v1.2 FINAL)

Después de analizar **33 PDFs reales** (5 goldens + 28 candidates):

- **Layout dominante real: PRESTO CIFRE TABULAR**. Cabecera `CÓDIGO RESUMEN UDS LONGITUD ANCHURA ALTURA PARCIALES CANTIDAD PRECIO IMPORTE`. Jerarquía 1-4 niveles: CAPÍTULO → SUBCAPÍTULO → APARTADO → Partida.
- **El extractor heurístico actual NO funciona en producción**:
  - `try_heuristic_extraction` (Fase 9.2 regex): extrae 0% qty en 30/54 PDFs analizados (los formatos PRESTO no matchean los regex SANITAS/MU02 hardcoded).
  - `extract_with_pdfplumber_first` (S3-06): produce **falsos positivos masivos** (`"21"`, `"01.1"`, `"25 marzo 2025"` como partidas) → kill switch `ENABLE_PDFPLUMBER_FIRST=false` lo desactiva en prod.
  - `AnnexedPdfExtractorService` solo LLM Vision page-by-page → timeout en PDFs >60pp.
- **La causa raíz técnica**: `page.extract_tables()` de pdfplumber NO detecta las tablas en estos PDFs porque están maquetadas con whitespace alignment (no líneas explícitas). pdfplumber requiere líneas para detectar tablas.
- **La solución correcta**: parser TABULAR coord-based usando `extract_words()` + agrupación por x-coords memorizadas de la cabecera. **Es trabajo serio, no fix.**
- **Estimación revisada: 10-14 días.**

---

## 1. Inventario de PDFs analizados

Localizados en `data/pdf_layouts/golden/`:

| PDF | Pages | Size | Origen probable | Notas |
|---|---|---|---|---|
| `sanitas_dental.pdf` | n/a | 145 KB | Sanitas Dental (proyecto comercial) | Layout SANITAS (`C04.02 Partida m2 TITULO`). Ya soportado. |
| `mu02_albanileria.pdf` | 25 | 687 KB | Project MU02 (vivienda?) | Layout MU02 (`1.1 Ud TITULO`). Ya soportado y funciona bien (77% qty OK). |
| `private_residence_palma.pdf` | 14 | 131 KB | Vivienda privada Palma (anonimizado) | Layout CIFRE/Presto con columnas tabulares. **NO soportado por el regex actual** — 0% qty. |
| `estado_mediciones_simple.pdf` | n/a | 83 KB | Simple, sin estructura jerárquica | Layout MU02 ligero, **15 partidas → confidence 0.65 cae por debajo del threshold 0.85 → fast path skipped → cae a LLM Vision con qty=1.0**. |
| `presupuesto_grande_rdll.pdf` | **258** | **1.37 MB** | RdLL OBRA CIVIL — proyecto vivienda completa (presupuesto fechado 2026-01-30). | Layout **PRESTO ANNEXED** (`XX.YY Partida UD TÍTULO` + sumatorios `Total TC-X.Y.Z` en últimas 10 pp). **NO soportado por NINGÚN regex actual** — analyzer reporta `UNKNOWN, 0 partidas`. **Este PDF originó el incidente del 14-may-2026**: extracción cae a LLM Vision page-by-page sobre 258 pp → ~60+ min → Cloud Run timeout. |

PDFs comparativos en `data/pdf_layouts/comparative/`:
- `measurements_input.pdf` (= `estado_mediciones_simple.pdf` byte-identical).
- `budget_human.pdf` — presupuesto generado por aparejador humano para ese input.
- `budget_ai.pdf` — presupuesto generado por nuestro sistema actual para el mismo input.

---

## 2. Estado actual de la extracción heurística (sin tocar nada)

Output de `services/ai-core/scripts/verify_heuristic_output.py` (invoca el mismo `try_heuristic_extraction` que ejecuta el pipeline productivo cuando llega `pdf_bytes`):

| PDF | Fast path | Partidas | qty real | chapter real | Bug observado |
|---|---|---|---|---|---|
| sanitas_dental | ✅ usado | 65 | **15 % (10/65)** | 100 % (65/65) | qty falla la mayoría: descripción larga rompe regex de quantity row. |
| mu02_albanileria | ✅ usado | 95 | **77 % (73/95)** | 100 % (95/95) | 22 partidas con qty=1.0 (probables PA o partidas vacías de unidades). El layout MU02 es el más simple y funciona. |
| private_residence_palma | ✅ usado | 74 | **0 % (0/74)** | **8 % (6/74)** | **EXACTAMENTE el smoke `31217dbb-...`**. Cantidades en filas tabulares `UDS LONG ANCH ALT CANT PRECIO IMPORTE` — ninguna línea match el regex `^X,XXX$`. Capítulos `21 PATOLOGÍAS` no comparten prefix con códigos `1.2.6`. |
| estado_mediciones_simple | ❌ NO usado | n/a | n/a | n/a | confidence 0.65 < threshold 0.85 → cae al LLM Vision con todos sus problemas (qty=1.0, sin capítulos). |
| **presupuesto_grande_rdll** | ❌ NO usado | **0** detectadas vs 155 reales | n/a | n/a | **EL PEOR CASO**. Layout `UNKNOWN` por regex faltante (`XX.YY Partida UD TÍTULO`). Cae a LLM Vision por 258 páginas → **incidente del 14-may**. Verificado: con pattern PRESTO ad-hoc detectamos **155 partidas + 20 capítulos**. Sumatorios `Total TC-X.Y.Z` en pp 249-258 (ANNEXED real). |

**Esto contradice la hipótesis original** de que el extractor PDF cliente actual es LLM Vision puro y necesita un reemplazo nuevo. La heurística ya hace mucho del trabajo; solo necesita ajustes finos.

---

## 3. Layouts identificados — taxonomía calibrada

Las 4 muestras se reducen a 2 sub-tipos del mismo macro-layout `INLINE_WITH_TITLES`:

### 3.1. Sub-layout `INLINE_DENSE` (SANITAS / MU02 / estado_simple)

Formato cabecera de partida:
```
<código>  [Partida|partida]?  <unidad>  <título>
```

Ejemplos reales:
- SANITAS: `C04.02 Partida m2 Demolición de tabique cerámico...`
- MU02:    `1.1 Ud Acondicionamiento de la entrada del solar...`
- Simple:  `01 ud Trabajos previos...` (variante)

Bloque descriptivo: párrafos libres entre la cabecera y la próxima cabecera. Las **mediciones** (cantidades) aparecen al final del bloque en **una sola línea aislada con el número decimal**: ej. `10,00` o `1,00 Ud`.

Cobertura actual del regex `QUANTITY_ROW`: **alta** para MU02 (77%), **media-baja** para SANITAS (15%, porque la descripción contiene muchos números intermedios que NO son cantidad final).

### 3.2. Sub-layout `INLINE_CIFRE` (private_residence_palma) — **NUEVO, no soportado**

Formato cabecera idéntico (`<código> <unidad> <título>`), pero el cuerpo es una **tabla CIFRE/Presto** con cabecera fija:

```
CÓDIGO RESUMEN UDS LONGITUD ANCHURA ALTURA CANTIDAD PRECIO IMPORTE
<código> <unidad> <título>
<repetición del título o subtítulo>
<descripción de la zona>  <UDS>  <LONG>  <ANCH>  <ALT>  <CANT>
[línea adicional zona si aplica]
Subtotal <total>
<total> <precio_unit> <importe>
```

Ejemplo real (página 2 de `private_residence_palma.pdf`):
```
21 PATOLOGÍAS GRAVES                          ← capítulo organizativo
01.1 PAT. 2 - FISURAS Y/O GRIETAS EN FORJADOS ← sub-capítulo
1.2.6 m2 Eliminación de revestimiento de yeso (techos)   ← cabecera partida
Eliminación de revestimiento de yeso (techos)             ← repetición título
Sótano local. Punto coincidente con gotera. 1 10,000 10,000  ← fila de medición
Subtotal 10,000
10,000 0,00 0,00                                          ← fila resumen (precio aún sin pricer)
```

**El regex actual** `QUANTITY_ROW = ^(\d+[,.]\d+)\s*$` NO matchea ninguna de las 3 últimas líneas porque tienen múltiples tokens. **Resultado**: 0/74 cantidades extraídas.

### 3.3. Sub-layout `INLINE_SHORT_NO_CHAPTERS` (estado_mediciones_simple)

Cabecera estándar MU02, pero **solo 15 partidas total** y **sin capítulos** explícitos en el texto. Confidence del clasificador cae a 0.65, y el threshold `min_layout_confidence=0.85` impide que el fast path se use. El PDF cae al LLM Vision con todos sus síntomas: `qty=1.0`, `chapter="Sin Capítulo"`, descripciones contaminadas.

### 3.4. Sub-layout `PRESTO_ANNEXED` (presupuesto_grande_rdll) — **EL CASO MÁS GRAVE**

Layout completo en 2 fases dentro del mismo PDF:

**Fase 1 — Descripciones** (pp 1-248):
```
01 Capítulo DESBROCE                                ← capítulo numerado, palabra "Capítulo"
01.01 Partida UD REPLANTEO                          ← cabecera de partida
REPLANTEO                                            ← título repetido
Replanteo de la cimentación de las viviendas...     ← descripción multilínea (5-15 líneas)
NOTA SUVICAR: SE VALORAN 3 JORNADAS DE...          ← notas técnicas (comunes en este PDF)
SPC0010 Replanteo                                   ← identificador interno + zona
01.02 Partida m² Desbroce y limpieza del terreno...
...
```

**Diferencias clave vs SANITAS/MU02**:
- Código `XX.YY` sin prefix `C` (a diferencia de SANITAS `C01.01`).
- Palabra explícita `Partida` entre código y unidad (a diferencia de MU02 que la omite).
- Capítulo `XX Capítulo NOMBRE` (a diferencia de MU02 que pone solo `XX NOMBRE`).
- Unidades en mayúscula (`UD`, `M2`, `M3`, `H`) — el `_UNITS_GROUP` ya las soporta.

**Fase 2 — Sumatorios** (pp 249-258):
```
Total TC-1.4 1,00 0,00 0,00
1,15 10,00 0,00 0,00 11,50
1,15 22,00 0,00 0,00 25,30
Total TC-1.5.3 66,70 0,00
Total TC-1.5 1,00 0,00 0,00
...
Total PROYECTO_23 1 0,00 0,00
```

**Mapeo no trivial**: el código de sumatorio `TC-1.4` o `PC02.01` o `90PC` NO coincide directamente con el código de partida `01.04` o `02.01`. Hay una taxonomía PRESTO interna (`TC` = "Trabajos Construcción", `PC` = "Partida Capítulo", etc.) que requiere mapping. Probable lógica: `TC-1.4` ↔ `01.04`, `PC02.01` ↔ `02.01`, pero NO está confirmado y puede variar por proyecto.

**Verificado con regex ad-hoc** (no en el código, solo prueba A0):
- `^(?P<code>\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\s+(?P<type>Partida|partida)\s+` → **155 partidas detectadas** en 258 pp.
- `^(?P<code>\d+)\s+Cap[íi]tulo\s+(?P<name>[^\n]+)$` → **20 capítulos detectados**.

**Cobertura actual del pipeline**: ninguna. El classifier reporta `UNKNOWN` (0 partidas) y la heurística no se invoca. Cae a LLM Vision page-by-page → 258 pp × ~10-15s/pp = ~50-65 min → Cloud Run cancela la request a 60 min con CancelledError silenciado → **incidente del 14-may-2026**.

---

## 4. Mapeo capítulo ↔ partida — bug raíz adicional

`analyzer.py:235-239` actualmente hace:
```python
for p in partidas:
    prefix = p.code.split(".")[0].upper()  # "1.2.6" → "1"
    if prefix and prefix in raw_chapters:
        raw_chapters[prefix].partidas_count += 1
```

Asume que el primer token del código de partida es el prefix del capítulo. **Esto es falso en `private_residence_palma.pdf`**:

- Capítulos del PDF: `21 PATOLOGÍAS GRAVES`, `22 PATOLOGÍAS NO GRAVES`, `7 ESCOMBROS`, `0 ACTUACIONES PREVIAS`.
- Códigos de partida: `0.1, 0.2, ..., 0.4` (caen en `0`), `1.2.6, 1.2.8, ...` (caen en `1` → **no existe capítulo `1`**), `15.16, 15.09, ...` (caen en `15` → tampoco existe), `7.x` (caen en `7` ✅).

Los códigos de partida son del **catálogo COAATMCA** (taxonomía técnica del aparejador), independientes de la **organización del documento** (capítulos del autor del IEE). El mapeo debe ser por **proximidad espacial en el flujo del texto**, no por matching numérico.

---

## 5. Bugs identificados (en orden de severidad)

| # | Bug | PDF que lo expone | Impacto | Severidad |
|---|---|---|---|---|
| **B0** | **`PARTIDA_PRESTO` regex inexistente**: PDFs con `XX.YY Partida UD TÍTULO` (sin prefix C, con palabra "Partida") clasifican como UNKNOWN → cae a LLM Vision page-by-page → timeouts | **presupuesto_grande_rdll (258pp)** | **timeout Cloud Run 60min** — incidente 14-may | **BLOQUEANTE** |
| B0.b | `CHAPTER_PRESTO_NUMERIC` regex inexistente: capítulos `XX Capítulo NOMBRE` no detectados (CHAPTER_NUMERIC actual exige solo `XX NOMBRE`) | presupuesto_grande_rdll | 0 capítulos en 20 reales | **BLOQUEANTE** |
| B0.c | `try_heuristic_extraction` no soporta TWO_PHASE_ANNEXED. El `AnnexedPdfExtractorService` existente solo tiene LLM Vision sin fast path | presupuesto_grande_rdll | 50-65 min de extracción vía LLM Vision | **BLOQUEANTE** |
| B1 | `QUANTITY_ROW` solo matchea líneas con un único decimal aislado; falla en filas tabulares CIFRE/Presto con `UDS LONG ANCH CANT` | private_residence_palma | 0% qty extraída | **CRÍTICO** |
| B2 | Mapeo capítulo↔partida por prefix numérico; falla cuando códigos de partida y de capítulo viven en taxonomías distintas | private_residence_palma | 92% chapter "Sin Capítulo" | **ALTO** |
| B3 | Threshold `min_layout_confidence=0.85` excluye PDFs cortos (<20 partidas, confidence 0.65) → caen a LLM Vision | estado_mediciones_simple | qty=1.0 + sin capítulos | **ALTO** |
| B4 | Sub-capítulos (`01.1 PAT. 2 - FISURAS...`) no detectados como nivel jerárquico intermedio | private_residence_palma | Pérdida de granularidad organizativa | MEDIO |
| B5 | Descripción de zona en CIFRE/Presto (`Sótano local. Punto coincidente con gotera.`) se mezcla con el bloque descriptivo de la partida | private_residence_palma | Descripciones contaminadas con notas zonales | MEDIO |
| B6 | Para SANITAS, qty real solo en 15% — el regex matchea números intermedios en la descripción larga | sanitas_dental | qty incorrecta en ~50 partidas | MEDIO |
| B7 | `partidas_sample` del JSON sale sin enrichment (siempre qty=None) | todos | Solo cosmético, output Markdown engañoso | BAJO |
| B8 | Pipeline no expone strategy=ANNEXED automáticamente. Frontend siempre envía INLINE → un PDF ANNEXED se procesa como INLINE → fast path falla → LLM Vision page-by-page sobre 258 pp | presupuesto_grande_rdll | timeout en producción | **CRÍTICO** |

---

## 6. Output schema canonical (referencia para los fixes)

`RestructuredItem` ya existe en `pdf_extractor_service.py` y es el contrato con el Swarm. Campos relevantes:

```python
class RestructuredItem(BaseModel):
    code: str                   # ej. "1.2.6", "C04.02"
    description: str            # texto descriptivo limpio (sin notas zonales)
    quantity: float             # cantidad real (NO 1.0 default si extracción real falló)
    unit: str                   # ej. "m2", "ml", "u" (no normalizado)
    chapter: str                # ej. "21 PATOLOGÍAS GRAVES" (proximidad espacial)
    sub_chapter: Optional[str]  # ej. "01.1 PAT. 2 - FISURAS..." [NUEVO en Sprint 4]
    unit_normalized: Optional[str]  # ej. "m²" (post Unit.normalize)
    unit_dimension: Optional[str]   # ej. "area"
    page: Optional[int]         # 1-indexed (telemetría)
    notes: Optional[str]        # notas zonales separadas de description [NUEVO]
```

Mantener retrocompatibilidad: `sub_chapter`, `notes`, `page` opcionales.

---

## 7. Edge cases observados

- **Cross-page descriptions** (sanitas, 5 partidas): cabecera al final de una página, bloque descriptivo arranca en la siguiente. Ya manejado por `analyzer._build_chapter_names` y `extract_descriptions_and_quantities` con tolerancia razonable (sanitas extrae 60/65 OK).
- **Partidas duplicadas en el PDF** (private_residence): `1.2.14 m2 Reparación partes repicadas` aparece en página 2 y se REPITE al inicio de página 3 (la zona del Sótano local quedaba a caballo). El analyzer actual cuenta ambas. El handler `consolidate_chapters` no deduplica partidas → output tiene 74 visibles + duplicados internos no detectados.
- **Subtotales con qty=0** (private_residence): líneas `10,000 0,00 0,00` — el precio aún no estaba completado por el aparejador. Si capturamos `Subtotal X,XXX`, esto se evita.
- **Códigos con punto decimal** vs **códigos con punto separador** (mu02: `15.09` es código `15` capítulo `9` partida; `1.2.6` es código de 3 niveles): la regex `PARTIDA_MU02` ya tolera `\d+\.\d+(?:\.\d+)?` (1-3 niveles).
- **Unidades pegadas a la cantidad** (`5,000 m2`): el regex `QUANTITY_ROW` lo soporta como `qty` + `unit` opcional, pero falla si hay texto adicional antes/después.
- **Subcapítulos con código `XX.X`** (`01.1 PAT. 2 - FISURAS...`): no detectados actualmente. Hay que añadir un pattern para `^\d+\.\d+\s+PAT\.\s+\d+\s+-\s+(.+)$` y similares.
- **PDFs escaneados** (no observados en estos 4 goldens, pero se anticipa). UNKNOWN layout → directamente LLM Vision sin intentar heurística.

---

## 8. Plan revisado de Sprint 4 (consecuencia de A0)

### Lo que se cae del plan original

❌ Construir 4 parsers nuevos (`standard.py`, `annexed.py`, `coaatmca_hierarchical.py`, `cype_paragraph.py`).
❌ `layout_classifier.py` nuevo (ya existe `classifier.py` con taxonomía calibrada).
❌ `llm_vision_fallback.py` separado con budget hard (ya hay flujo LLM completo + fast path falla limpio).
❌ `multi_layout_extractor.py` adapter (no se necesita; el extractor existente ya enruta).
❌ Feature flag `USE_MULTI_LAYOUT_EXTRACTOR` (no es un V2 separado; son fixes incrementales sobre V1).
❌ Comparator V1 vs V2 side-by-side (no hay V2 separado).
❌ 2 semanas de coexistencia V1+V2.

### Lo que el sprint realmente necesita (v1.1, ampliado por RdLL)

**A0 — Pattern `PARTIDA_PRESTO` + `CHAPTER_PRESTO_NUMERIC`** (`patterns.py`) — **PREREQUISITO para que rdll funcione**:
- `PARTIDA_PRESTO = r"^(?P<code>\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\s+(?P<type>Partida|partida)\s+(?P<unit>UNITS)\s+(?P<title>.+?)$"`.
- `CHAPTER_PRESTO_NUMERIC = r"^(?P<code>\d+)\s+Cap[íi]tulo\s+(?P<name>[A-ZÁÉÍÓÚÑ][^\n]+)$"`.
- Añadir ambos a `find_partidas_in_text` y `find_chapters_in_text`.
- Test golden: `presupuesto_grande_rdll.pdf` debe pasar de 0 a ≥150 partidas detectadas + ≥18 capítulos.

**A1 — Pattern `QUANTITY_ROW` ampliado** (`patterns.py`):
- Añadir match para `^Subtotal\s+(?P<qty>\d+[,.]\d+)\s*$` (resumen explícito de partida CIFRE).
- Añadir match para líneas tabulares `<descripción zona> <UDS> <LONG> <ANCH>? <ALT>? <CANT>` con captura del último decimal positivo.
- Test golden: `private_residence_palma.pdf` debe pasar de 0% a ≥95% qty extraída.

**A2 — Mapeo capítulo↔partida por proximidad espacial** (`analyzer.py`):
- En vez de `prefix = code.split(".")[0]`, mantener un cursor del "último capítulo visto" mientras se procesa el texto en orden.
- Cada partida hereda el capítulo del último `find_chapters_in_text` antes de su posición en el texto.
- Test golden: `private_residence_palma.pdf` debe pasar de 8% a ≥95% chapter detectado.

**A3 — Detección de sub-capítulos** (`patterns.py`):
- Nuevo regex `SUB_CHAPTER_CIFRE = r"^(\d+\.\d+)\s+(PAT\.\s+\d+\s+-\s+.+)$"`.
- Añadir campo `sub_chapter: Optional[str]` a `RestructuredItem` (retrocompatible).
- Cada partida hereda el último sub_chapter visto entre capítulos.

**A4 — Threshold relaxation** (`analyzer.py`):
- Cambiar `min_partidas_detected=5` por `min_partidas_detected=10`.
- Cambiar `min_layout_confidence=0.85` por `min_layout_confidence=0.65` SI `len(candidates) >= 10`.
- Test golden: `estado_mediciones_simple.pdf` debe usar fast path (no LLM Vision).

**A5 — Mejora qty extraction para SANITAS** (`analyzer.py`):
- Restringir el match `QUANTITY_ROW` al **último** bloque numérico tras la descripción, no a cualquier número intermedio.
- Heurística: cantidades válidas siempre vienen tras la descripción técnica y antes de la próxima cabecera de partida.
- Test golden: `sanitas_dental.pdf` debe pasar de 15% a ≥80% qty extraída.

**A6 — Detección y soporte ANNEXED en heurística** (`classifier.py` + `analyzer.py`) — **NUEVO en v1.1**:
- Classifier ya distingue ANNEXED por concentración de sumatorios en último tercio. Conservarlo.
- En `try_heuristic_extraction`: si `layout == TWO_PHASE_ANNEXED`, llamar a `try_heuristic_extraction_annexed(text_per_page)` que:
  1. Detecta partidas en primer N% del texto.
  2. Detecta sumatorios `Total <key> <qty> ...` en último N%.
  3. Construye un mapa `code → quantity` con la lógica de mapping PRESTO (sufijo `TC-` y `PC` removidos para inferir el código de partida).
  4. Asigna quantity a cada partida según el mapa; las que no encuentran sumatorio quedan con `quantity=None` (no 1.0 default — explicit fail).
- Test golden: `presupuesto_grande_rdll.pdf` debe extraer ≥80% qty desde sumatorios.

**A7 — Tests golden con assertions** (`tests/budget/layout_analyzer/`):
- Por cada PDF en `data/pdf_layouts/golden/`:
  - Assertions: `qty_extraction_rate >= 0.80`, `chapter_extraction_rate >= 0.90`, `items_count == expected`.
  - Para `presupuesto_grande_rdll`: además `extraction_duration_seconds <= 30` (CRÍTICO: si pasa de 30s, está cayendo a LLM Vision).
- Tests bloquean merge si algún PDF golden regresa.

**A8 — Métricas observables** (Cloud Monitoring):
- `extractor_heuristic_used{layout_type, result=success|fallback_to_llm}` — counter.
- `extractor_heuristic_qty_rate{pdf_id}` — gauge.
- `extractor_heuristic_chapter_rate{pdf_id}` — gauge.
- `extractor_heuristic_duration_seconds{pdf_id}` — histogram.
- `extractor_llm_vision_pages_processed{pdf_id}` — counter (debería ser 0 para layouts soportados).

**A9 — Anomaly detection en pipeline** (`pdf_extractor_service.py`):
- Si `qty_extraction_rate < 0.50` para un PDF que pasa el fast path: log WARNING + override a LLM Vision como fallback automático.
- Si LLM Vision se invoca para >50 páginas: log ERROR + abort con código `EXTRACTOR_LAYOUT_UNSUPPORTED` (UI muestra error claro al usuario, no silencio).
- Evita un nuevo incidente como el 14-may.

### Estimación revisada v1.1

- **Optimista:** 5 días (A0+A6 son los nuevos costosos por el mapping PRESTO ANNEXED).
- **Pesimista:** 8 días (si A6 requiere descubrir más variantes de sufijos PRESTO).
- **Comparable al plan original:** 8-10 días → **5-8 días.** ~30-40% menos trabajo + mucha menos invasión arquitectónica.

### Fase B (frontend) — sin cambios estructurales

Las tasks B1-B3 originales se mantienen, pero pequeñas:
- B1: `/dashboard/admin/pdf-layout-test` — drop PDF → muestra fingerprint + items extraídos. Útil para QA continuo del A6.
- B2: Cards en `/dashboard/admin/model-health` con métricas A7.
- B3: Comparator V1 vs V2 — **descartado** (no hay V2 separado). En su lugar: vista "antes/después" usando logs históricos del mismo budget_id.

### Fase C (validation)

- C1: Smoke local con los 4 PDFs golden, verificar qty/chapter rates.
- C2: Smoke staging con el PDF cliente del usuario.
- C3: Smoke production (sin feature flag — fix incremental, no v2).
- C4: Monitor 1 semana de métricas A7.

---

## 9. Riesgo principal del plan revisado

**Riesgo 1**: Sub-layouts CIFRE/Presto adicionales que no aparecen en los 4 goldens y rompen A1.
- *Mitigación:* A8 (fallback automático si qty_rate <50%) garantiza que un PDF desconocido no salga roto a producción.
- *Mitigación:* Pedirle al usuario 2-3 PDFs adicionales del cliente real para ampliar los goldens antes del cutover.

**Riesgo 2**: `consolidate_chapters` no deduplica partidas repetidas (caso private_residence_palma `1.2.14`).
- *Mitigación:* Test golden `assert len(unique_codes) == len(items)`. Si falla, añadir dedupe explícito en `try_heuristic_extraction`.

**Riesgo 3**: La caída de tests golden bloquea cualquier change futuro al extractor.
- *Aceptado.* Es el punto. Una regresión en el extractor debe bloquear merge — el smoke `31217dbb-...` demuestra el coste de no tener este safety net.

---

## 10. Próxima acción inmediata (v1.1)

Sprint 4 Fase A (backend) ahora es **un solo agente, no dos paralelos**. Tasks secuenciales A0→A9, todas en `services/ai-core/src/budget/layout_analyzer/` + `tests/` + un toque a `pdf_extractor_service.py`. Sin worktree porque son fixes localizados sin riesgo de conflicto.

**Orden de implementación** (crítico para validar incremental):
1. **A0** (patrones PRESTO) + tests sobre rdll → si no detecta 150+ partidas, parar y revisar regex.
2. **A1** (QUANTITY_ROW ampliado) + tests sobre private_residence_palma → si no llega 90% qty, parar.
3. **A2** (chapter proximity) + tests sobre private_residence_palma → si no llega 90% chapter, parar.
4. **A3** (sub-chapter) — opcional pero recomendado para granularidad UI.
5. **A4** (threshold) + tests sobre estado_mediciones_simple → confirmar fast path se usa.
6. **A5** (SANITAS qty) + tests sobre sanitas_dental → confirmar 80%+.
7. **A6** (ANNEXED heurístico) + tests sobre rdll → CRÍTICO, confirmar duration <30s y qty 80%+.
8. **A7** (tests golden CI) + **A8** (métricas) + **A9** (anomaly detection) en paralelo.

Fase B (frontend) en paralelo con A4-A9, agente independiente.

Estimación calendar: **5-8 días** (no 3 semanas, no 1 semana — más realista incluyendo rdll ANNEXED).

---

## 11. PDFs adicionales (ya analizados v1.2)

**Ya tenemos 28 PDFs analizados** en `data/pdf_layouts/analysis/batch_golden_candidates/`. Cubren el espacio de layouts realista para el cliente Grupo RG.

Carpeta `99-formato-raro/` contiene archivos NO-PDF (PZH binario Presto, ZIP, DOCX, DWG) — **OUT OF SCOPE Sprint 4**.

---

## 12. Plan Sprint 4 v1.2 FINAL — parser TABULAR coord-based

### Lo que se cae del plan v1.1

❌ Asumir que el extractor heurístico solo necesita "ampliar regex" → realidad: regex es el enfoque equivocado para layouts PRESTO TABULAR.
❌ Reutilizar `extract_with_pdfplumber_first` → está roto en prod, requiere reescritura.
❌ Plan de 5-8 días → irreal.

### Lo que el sprint REALMENTE necesita (v1.2 FINAL)

**A1 — Detección de cabecera tabular PRESTO + memorización de x-coords** (`new_tabular_parser.py`):
- Buscar en cada página la línea con cabecera `CÓDIGO ... RESUMEN ... CANTIDAD ... PRECIO ... IMPORTE` (case-insensitive, tolerante a espaciado variable).
- Memorizar las x-coords centrales de cada columna a partir de `page.extract_words(extra_attrs=["fontname"])`.
- Persistir mapping `{column_concept: x_range}` para usar en páginas subsecuentes (la cabecera se imprime al inicio de cada página en PRESTO).

**A2 — Agrupación de words por línea (y-coord) y por columna (x-coord)** (`new_tabular_parser.py`):
- Para cada página: agrupar `extract_words()` en líneas (y tolerance ±2pt).
- Para cada línea: asignar cada word a la columna cuya x_range contiene `x_center`.
- Reconstruir `{code, description, uds, longitud, anchura, altura, parciales, cantidad, precio, importe}` por fila.

**A3 — Detección de jerarquía multinivel** (`new_tabular_parser.py`):
- Patrones (priorizados, primer match gana):
  - `CAPÍTULO XX <NAME>` — nivel 1.
  - `SUBCAPÍTULO XX.YY <name>` — nivel 2.
  - `APARTADO XX.YY.ZZ <name>` — nivel 3.
  - `XX[.YY[.ZZ[.WW]]] <unit> <title>` — partida (1-4 niveles).
- Mantener cursor de jerarquía: cada partida hereda el último capítulo/subcapítulo/apartado vistos en orden de aparición.

**A4 — Extracción de cantidad fiable**:
- Estrategia preferida: línea de "summary" con 3 decimales `<CANT> <PRECIO> <IMPORTE>` que aparece justo antes de la siguiente partida.
- Alternativa: columna CANTIDAD del último row de mediciones de la partida.
- Si ambas fallan: `quantity = None` (NO 1.0 default — explicit fail para que A9 lo detecte).

**A5 — Anti-falsos-positivos** (lección S3-06):
- Filtros explícitos: descartar filas cuyo `code` matchea `^\d{2}\s+\w+\s+\d{4}$` (fechas tipo "25 marzo 2025"), o cuyo `description` está vacío o es solo whitespace, o cuyo `code` es solo un número (sin punto) y aparece en línea de capítulo.
- Tests unitarios con falsos positivos conocidos: `["21", "01.1", "25 marzo 2025", "0", "TOTAL CAPÍTULO 02"]`.

**A6 — Fallback graceful**:
- Si parser TABULAR encuentra cabecera pero <80% partidas extraídas con qty real → log WARNING + abort + fallback a LLM Vision.
- Si parser TABULAR NO encuentra cabecera (PDF sin formato PRESTO) → fallback inmediato a LLM Vision (sin warning).
- Si LLM Vision se invoca para >50 páginas → **ERROR explícito a UI** con mensaje claro: "Layout no soportado, contacte soporte" (no silencio mortal como 14-may).

**A7 — Tests golden con assertions estrictas** (`tests/budget/pdf_extractor/test_tabular_parser_golden.py`):
- Por cada PDF en `data/pdf_layouts/golden/`:
  - `assert items_count == expected` (exacto).
  - `assert qty_extraction_rate >= 0.95` para PDFs PRESTO TABULAR (no 0.80 — exigir excelencia).
  - `assert chapter_extraction_rate >= 0.95`.
  - `assert extraction_duration_seconds <= 60` (incluso PDF de 258pp).
  - `assert no_falsos_positivos` (lista hardcoded de strings que NO deben aparecer como code).
- Tests bloquean merge si algún PDF golden regresa.

**A8 — Métricas Cloud Monitoring**:
- `extractor_v2_parser_used{parser=tabular|legacy_heuristic|llm_vision}` — counter.
- `extractor_v2_qty_rate{pdf_id}` — gauge.
- `extractor_v2_chapter_rate{pdf_id}` — gauge.
- `extractor_v2_duration_seconds{pdf_id}` — histogram.
- `extractor_v2_false_positives_count{pdf_id}` — counter (debería ser 0 en producción).
- `extractor_v2_pages_to_llm_vision_total{pdf_id}` — counter (debería ser 0 para layouts soportados).

**A9 — Adapter para feature flag + coexistencia con V1**:
- `USE_TABULAR_PARSER=true|false` env var.
- `pdf_extractor_service.InlinePdfExtractorService.extract` decide entre nuevo parser (default true) y legacy (fallback).
- Permite rollback inmediato si v2 regresa.

**A10 — Heurística "preflight":** antes de procesar PDF, detectar features tabulares con muestra de 3 páginas y decidir si v2 puede aplicar o cae directo a LLM Vision. Evita gastar 30s tratando de parsear un PDF que ya sabemos no es PRESTO.

### Estimación REALISTA v1.2

- **Optimista:** 10 días (parser ~500 LOC + tests + métricas).
- **Realista:** 12 días.
- **Pesimista:** 15 días (si aparecen variantes PRESTO no contempladas o edge cases en coord-grouping).

### Fase B (frontend) — sin cambios

B1: `/dashboard/admin/pdf-layout-test` — sigue siendo útil para QA continuo.
B2: Cards de métricas A8.
B3: Comparator V1 vs V2 con A9 feature flag.

### Fase C (validation) — más conservadora

- C1: Local smoke con 5 PDFs golden.
- C2: Comparator side-by-side (A9 flag) con todos los 28 candidates.
- C3: Staging smoke con 3 PDFs reales no-golden (selección random del cliente).
- C4: Production con flag=false → flag=true para Owner only (whitelist) → flag=true global tras 48h.
- C5: Mantener V1 deployado 4 semanas (no 2) — mayor cautela por scope ampliado.

---

*Fin de LAYOUT_SPEC.md. Si encuentras un sub-layout adicional cuando llegue un PDF nuevo del cliente, actualiza la sección 3 y añade el regex correspondiente en A1.*

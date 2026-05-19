# Modelos AI en ai-core

Documento operativo: qué modelos corren hoy en producción, cómo se entrenan
(planeado Sprint 3.B), cómo se despliegan, cómo se hace rollback y qué
métricas monitorizamos. Sincronizado con el dashboard
`/dashboard/admin/model-health` (S3-09).

## Modelos en uso (production)

| Componente              | Modelo                          | Versión             | Lugar                          |
| ----------------------- | ------------------------------- | ------------------- | ------------------------------ |
| Pricing evaluator       | gemini-2.5-flash                | (Google managed)    | Cloud Run Job                  |
| Embeddings catálogo     | gemini-embedding-001            | (Google managed)    | Cloud Run Job                  |
| Cross-encoder reranker  | BAAI/bge-reranker-v2-m3         | v1 (base, sin FT)   | Cloud Run Job (Docker image)   |
| BM25 hybrid search      | rank-bm25                       | 0.2.2               | Cloud Run Job (in-memory)      |

> Las versiones efectivas pueden sobrescribirse vía env vars en Cloud Run:
> `EMBEDDING_MODEL_VERSION`, `RERANKER_MODEL_VERSION`, `PRICING_MODEL_VERSION`.
> Sin env var, aplica el default de la tabla. El dashboard
> `/dashboard/admin/model-health` muestra qué fuente está activa.

## Cómo se entrena (Sprint 3.B futuro)

### Bi-encoder fine-tune (S3-04)

- Base: `BAAI/bge-m3`.
- Dataset: pares sintéticos generados via Gemini 2.5 Pro (S3-03) sobre los
  1.658 items del catálogo COAATMCA.
- Loss: `MultipleNegativesRankingLoss`.
- Hiperparámetros: 3 epochs, batch size 16, learning rate 2e-5.
- Validación: holdout 10%, métrica `cos_sim(anchor, positive) > cos_sim(anchor, negative)`.

### Cross-encoder fine-tune (S3-05)

- Base: `BAAI/bge-reranker-v2-m3`.
- Dataset: 5.000 pares `(query histórica, candidate catálogo)` puntuados por
  Gemini 2.5 Pro actuando como judge.
- Coste estimado de generación del dataset: **$300 – $600 USD** (depende del
  ratio de pares positivos / negativos validados).

## Cómo se despliega

> **Sprint 3.B**: los pesos fine-tuned vivirán en
> `gs://grupo-rg-a9929-ai-models/` y se cargarán al arrancar el container vía
> las env vars `MODEL_VERSION_EMBEDDING` y `MODEL_VERSION_RERANKER`.
>
> Flujo previsto:
> 1. Entrenamiento offline produce los artefactos (`.safetensors` + tokenizer).
> 2. Subir a `gs://grupo-rg-a9929-ai-models/<component>/<version>/`.
> 3. Actualizar la env var del servicio Cloud Run (`gcloud run services update ai-core ...`).
> 4. Cloud Run hace rolling restart de las réplicas; el nuevo container baja el
>    modelo en el primer request (warm path).

Hoy (Sprint 3.A) los modelos son los base — no requieren almacenamiento
extra: `gemini-*` viene gestionado por Google, `BAAI/bge-reranker-v2-m3` se
descarga desde HuggingFace al construir la imagen Docker.

## Rollback

> **Sprint 3.B**: cambiar la env var de versión y restart del worker.
>
> ```bash
> gcloud run services update ai-core \
>   --update-env-vars=RERANKER_MODEL_VERSION=BAAI/bge-reranker-v2-m3
> ```
>
> Cloud Run hace blue/green automático; si la nueva revisión falla, redirigir
> tráfico a la revisión anterior:
>
> ```bash
> gcloud run services update-traffic ai-core --to-revisions=<prev>=100
> ```

Cada despliegue debe registrar un documento en
`model_deployments/{id}` con `deployedAt`, `image`, `changes` y `revisionId`
para que el histórico del dashboard funcione.

## Métricas a monitorizar

| Métrica                          | Fuente                                                    | Frecuencia      |
| -------------------------------- | --------------------------------------------------------- | --------------- |
| `recall@10` (golden set)         | Eval offline (Sprint 3.B)                                 | Mensual         |
| Latencia p50/p95 reranker        | telemetry events `rerank_applied`                         | Tiempo real     |
| Latencia p50/p95 bi-encoder      | telemetry events `vector_search_completed`                | Tiempo real     |
| % `needs_human_review`           | telemetry events `item_resolved`                          | Tiempo real     |
| Correcciones humanas por mes     | colección `correction_pairs/` (S3-07)                     | Diaria          |
| Heatmap correcciones por capítulo | colección `correction_pairs/` agrupada por `ai_proposed.code` | Diaria       |

Todas las métricas anteriores se exponen en
`/dashboard/admin/model-health`.

## Threshold de re-entrenamiento

Re-entrenar cuando se cumpla **cualquiera** de las siguientes condiciones:

1. Periodo mensual desde el último entreno **+ on-demand** si `recall@10` cae
   por debajo de **0,70** en el golden set.
2. Se han registrado **≥ 500 correction_pairs nuevos** desde el último entreno
   (medible vía `correction_pairs.where(corrected_at > last_training_ts).count()`).
3. Cambio significativo en el catálogo COAATMCA (nuevo capítulo, > 5% items
   añadidos/eliminados): re-entrenar bi-encoder.

El owner del threshold es el dashboard `/admin/model-health` — un cambio de
estado debería gatillar una alerta en Slack vía Cloud Monitoring (Sprint 3.B).

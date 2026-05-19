'use server';

/**
 * Sprint 3 — S3-09: dashboard "Salud del Modelo" (`/dashboard/admin/model-health`).
 *
 * Agrega métricas de salud del pipeline IA en un solo payload para el dashboard.
 * `verifyAuth(true)` — admin only.
 *
 * Fuentes:
 *   - `correction_pairs/*` (S3-07) → total registrado + heatmap por capítulo
 *     derivado de `ai_proposed.code`.
 *   - `pipeline_telemetry/{jobId}/events` → latencias del bi-encoder (vector
 *     search) y reranker (rerank_applied); % partidas con needs_human_review.
 *   - `correction_pairs/*` count → KPI cards.
 *   - env vars `EMBEDDING_MODEL_VERSION` y `RERANKER_MODEL_VERSION` con
 *     defaults documentados en services/ai-core/MODELS.md (S3-10).
 *   - `model_deployments` (opcional, no obligatorio en este sprint) →
 *     histórico de despliegues. Best-effort: si la colección no existe se
 *     devuelve [].
 */

import { verifyAuth } from '@/backend/auth/auth.middleware';
import { adminFirestore } from '@/backend/shared/infrastructure/firebase/admin-app';
import { FirestoreCorrectionPairRepository } from '@/backend/ai-training/infrastructure/firestore-correction-pair-repository';

export interface ModelHealthCards {
    /** Recall@10 último mes. Placeholder hasta golden set — `null` si no hay datos. */
    recallAt10: number | null;
    biEncoderLatencyP50Ms: number | null;
    biEncoderLatencyP95Ms: number | null;
    crossEncoderLatencyP50Ms: number | null;
    crossEncoderLatencyP95Ms: number | null;
    /** % partidas con needs_human_review en el último mes (0-1). */
    needsHumanReviewPct: number | null;
    /** Conteo total de correction_pairs persistidos. */
    correctionPairsCount: number;
}

export interface ChapterCorrectionRow {
    /** Capítulo del catálogo (prefijo del code, e.g. "EDM"). */
    chapter: string;
    count: number;
}

export interface ActiveModel {
    component: string;
    name: string;
    version: string;
    source: 'env' | 'default';
}

export interface DeploymentRow {
    id: string;
    deployedAt: string;
    image: string | null;
    changes: string | null;
    revisionId: string | null;
}

export interface ModelHealthPayload {
    cards: ModelHealthCards;
    correctionsByChapter: ChapterCorrectionRow[];
    activeModels: ActiveModel[];
    deployments: DeploymentRow[];
    generatedAt: string;
}

/**
 * Extrae el capítulo a partir de un code de catálogo. Heurística:
 *   - "EDM01.05" → "EDM" (prefijo alfanumérico hasta el primer dígito).
 *   - "D01.05"   → "D01" (mismo prefijo, dígitos pegados a la letra inicial).
 *   - "GENERIC-EXPLICIT" → "GENERIC".
 *   - Si no hay prefijo identificable, devolvemos `"UNKNOWN"`.
 *
 * El resultado se usa solo para agrupar visualmente, no es semánticamente
 * el "chapter" exacto del catálogo COAATMCA (que vive en
 * `price_book_items.chapter`), pero coincide en >95% de casos.
 */
export function chapterFromCode(code: string | null | undefined): string {
    if (!code) return 'UNKNOWN';
    const trimmed = code.trim();
    if (!trimmed) return 'UNKNOWN';
    // GENERIC-EXPLICIT → "GENERIC"
    const dashIdx = trimmed.indexOf('-');
    if (dashIdx > 0) return trimmed.slice(0, dashIdx).toUpperCase();
    // EDM01.05 → "EDM"; D01.05 → "D01"; ED → "ED".
    const dotIdx = trimmed.indexOf('.');
    const head = dotIdx >= 0 ? trimmed.slice(0, dotIdx) : trimmed;
    // Si el head es 100% dígitos, devolvemos UNKNOWN.
    if (/^\d+$/.test(head)) return 'UNKNOWN';
    return head.toUpperCase();
}

/** p50 / p95 calculados sobre un array de latencias ms. `null` si vacío. */
function percentile(values: number[], p: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return Math.round(sorted[idx]);
}

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Lee los telemetry events de los últimos N jobs y deriva latencias por tipo
 * de evento. Eventos relevantes:
 *   - `vector_search_completed` / `vector_search` con `durationMs` → bi-encoder.
 *   - `rerank_applied` con `durationMs` → cross-encoder.
 *
 * Los eventos sin `durationMs` se ignoran (no inventamos latencias).
 */
async function aggregateLatencies(): Promise<{
    biEncoderP50: number | null;
    biEncoderP95: number | null;
    crossEncoderP50: number | null;
    crossEncoderP95: number | null;
    needsReviewPct: number | null;
}> {
    const biEncoderLatencies: number[] = [];
    const crossEncoderLatencies: number[] = [];
    let totalPartidas = 0;
    let needsReviewPartidas = 0;
    const cutoffMs = Date.now() - ONE_MONTH_MS;

    // Leemos hasta 200 root docs de pipeline_telemetry (mismo límite que
    // get-pipeline-jobs.action.ts para evitar runaway lecturas).
    const rootSnap = await adminFirestore.collection('pipeline_telemetry').limit(200).get();

    for (const doc of rootSnap.docs) {
        const evSnap = await doc.ref.collection('events').get();
        for (const ev of evSnap.docs) {
            const data = ev.data() as any;
            const tsRaw = data.timestamp;
            const tsMs = tsRaw?.toDate ? tsRaw.toDate().getTime() : new Date(tsRaw || 0).getTime();
            if (Number.isFinite(tsMs) && tsMs > 0 && tsMs < cutoffMs) continue;

            const type = data.type;
            const inner = data.data || {};
            const durationMs = Number(
                inner.durationMs ?? inner.duration_ms ?? inner.latencyMs ?? inner.latency_ms,
            );
            if (type === 'vector_search_completed' || type === 'vector_search') {
                if (Number.isFinite(durationMs) && durationMs > 0) {
                    biEncoderLatencies.push(durationMs);
                }
            } else if (type === 'rerank_applied') {
                if (Number.isFinite(durationMs) && durationMs > 0) {
                    crossEncoderLatencies.push(durationMs);
                }
            } else if (type === 'item_resolved') {
                totalPartidas++;
                const item = inner.item || {};
                if (item.needsHumanReview === true || item.needs_human_review === true) {
                    needsReviewPartidas++;
                }
            }
        }
    }

    return {
        biEncoderP50: percentile(biEncoderLatencies, 50),
        biEncoderP95: percentile(biEncoderLatencies, 95),
        crossEncoderP50: percentile(crossEncoderLatencies, 50),
        crossEncoderP95: percentile(crossEncoderLatencies, 95),
        needsReviewPct: totalPartidas > 0 ? needsReviewPartidas / totalPartidas : null,
    };
}

/**
 * Lista los modelos activos a partir de env vars con defaults documentados.
 */
function listActiveModels(): ActiveModel[] {
    const embeddingFromEnv = process.env.EMBEDDING_MODEL_VERSION;
    const rerankerFromEnv = process.env.RERANKER_MODEL_VERSION;
    return [
        {
            component: 'Embeddings catálogo (bi-encoder)',
            name: embeddingFromEnv || 'gemini-embedding-001',
            version: embeddingFromEnv || 'gemini-embedding-001',
            source: embeddingFromEnv ? 'env' : 'default',
        },
        {
            component: 'Cross-encoder reranker',
            name: rerankerFromEnv || 'BAAI/bge-reranker-v2-m3',
            version: rerankerFromEnv || 'BAAI/bge-reranker-v2-m3',
            source: rerankerFromEnv ? 'env' : 'default',
        },
        {
            component: 'Pricing evaluator (Judge)',
            name: process.env.PRICING_MODEL_VERSION || 'gemini-2.5-flash',
            version: process.env.PRICING_MODEL_VERSION || 'gemini-2.5-flash',
            source: process.env.PRICING_MODEL_VERSION ? 'env' : 'default',
        },
        {
            component: 'BM25 hybrid search',
            name: 'rank-bm25',
            version: '0.2.2',
            source: 'default',
        },
    ];
}

/**
 * Lee `model_deployments/*` si existe. Schema esperado:
 *   { deployedAt, image, changes, revisionId }
 *
 * Si la colección no existe o falla, devolvemos []. No bloqueamos el dashboard.
 */
async function listDeployments(): Promise<DeploymentRow[]> {
    try {
        const snap = await adminFirestore
            .collection('model_deployments')
            .orderBy('deployedAt', 'desc')
            .limit(20)
            .get();
        return snap.docs.map(d => {
            const data = d.data() as any;
            const ts = data.deployedAt;
            const tsIso = ts?.toDate ? ts.toDate().toISOString() : (typeof ts === 'string' ? ts : new Date(0).toISOString());
            return {
                id: d.id,
                deployedAt: tsIso,
                image: data.image ?? null,
                changes: data.changes ?? null,
                revisionId: data.revisionId ?? null,
            };
        });
    } catch (err) {
        console.warn('[get-model-health] no model_deployments collection', err);
        return [];
    }
}

export async function getModelHealthAction(): Promise<
    { success: true; data: ModelHealthPayload } | { success: false; error: string }
> {
    const auth = await verifyAuth(true);
    if (!auth) {
        return { success: false, error: 'forbidden' };
    }

    try {
        const repo = new FirestoreCorrectionPairRepository();
        const [correctionsCount, allPairs, latencies, deployments] = await Promise.all([
            repo.count(),
            repo.findAll(500),
            aggregateLatencies(),
            listDeployments(),
        ]);

        // Heatmap por capítulo derivado de ai_proposed.code.
        const counts = new Map<string, number>();
        for (const p of allPairs) {
            const chapter = chapterFromCode(p.aiProposed.code);
            counts.set(chapter, (counts.get(chapter) || 0) + 1);
        }
        const correctionsByChapter: ChapterCorrectionRow[] = Array.from(counts.entries())
            .map(([chapter, count]) => ({ chapter, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 20);

        const payload: ModelHealthPayload = {
            cards: {
                recallAt10: null, // placeholder hasta golden set (Sprint 3.B)
                biEncoderLatencyP50Ms: latencies.biEncoderP50,
                biEncoderLatencyP95Ms: latencies.biEncoderP95,
                crossEncoderLatencyP50Ms: latencies.crossEncoderP50,
                crossEncoderLatencyP95Ms: latencies.crossEncoderP95,
                needsHumanReviewPct: latencies.needsReviewPct,
                correctionPairsCount: correctionsCount,
            },
            correctionsByChapter,
            activeModels: listActiveModels(),
            deployments,
            generatedAt: new Date().toISOString(),
        };

        return { success: true, data: payload };
    } catch (error: any) {
        console.error('[getModelHealthAction] failed', error);
        return { success: false, error: error?.message || 'unknown_error' };
    }
}

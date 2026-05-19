'use server';

/**
 * Sprint 1 — S1-B-01: admin job metrics reader.
 *
 * Reads two strongly-typed telemetry events emitted by the Python swarm
 * (see `services/ai-core/src/budget/application/services/swarm_pricing_service.py`):
 *   - `partida_resolved_v2`: per-partida cost/tier/match metadata.
 *   - `job_metrics_final`: aggregate KPIs (cost, latency p50/p95, tier counts).
 *
 * The action is consumed by `/dashboard/admin/jobs/[jobId]` so the operator
 * can audit a single pipeline run without scrolling raw telemetry. Falls back
 * to an in-memory partial aggregate when `job_metrics_final` is missing
 * (e.g. swarm crashed before the finally block, or the cron ran mid-flight).
 *
 * Firestore layout (from `FirebaseTelemetryRepository`):
 *   pipeline_telemetry / {jobId} / events / {uuid}
 *     - type: string          (free-form catalogue; equals event_type)
 *     - data: Record<string,any>
 *     - timestamp: Timestamp
 *     - expiresAt: Timestamp | null
 *     - jobId: string
 */

import { adminFirestore } from '@/backend/shared/infrastructure/firebase/admin-app';
import { verifyAuth } from '@/backend/auth/auth.middleware';

export interface PartidaResolvedV2 {
    code: string;
    tier_used: 'flash' | 'pro' | null;
    tier_reason: string | null;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
    latency_ms: number;
    cache_hit: boolean | null;
    match_kind: string | null;
    confidence_score: number | null;
    timestamp: string;
}

export interface JobMetricsFinal {
    total_tokens_in: number;
    total_tokens_out: number;
    total_cost_usd: number;
    duration_seconds: number;
    partidas_total: number;
    cache_hit_rate: number;
    latency_p50: number;
    latency_p95: number;
    tier_flash_count: number;
    tier_pro_count: number;
    needs_review_count: number;
    /**
     * True when the document was synthesised from `partida_resolved_v2`
     * events because no `job_metrics_final` event exists yet. Lets the UI
     * render a "Job en curso" badge while still surfacing partial KPIs.
     */
    is_partial: boolean;
    timestamp: string;
}

export interface JobMetricsResult {
    jobMetrics: JobMetricsFinal | null;
    partidasResolved: PartidaResolvedV2[];
}

const FINAL_EVENT_TYPE = 'job_metrics_final';
const PARTIDA_EVENT_TYPE = 'partida_resolved_v2';

/**
 * Mirrors the `toMs` helper used by `getPipelineJobsAction` — Firestore
 * Timestamps expose `.toDate()` server-side; the helper degrades gracefully
 * to `new Date(...)` for ISO strings (used by tests / mock data).
 */
function toMs(ts: any): number {
    if (typeof ts === 'number') return ts;
    if (!ts) return 0;
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : 0;
}

function toIso(ts: any): string {
    const ms = toMs(ts);
    return new Date(ms || Date.now()).toISOString();
}

function num(value: any, fallback = 0): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

/**
 * Mirrors the Python `_calc_percentile` helper so the partial fallback path
 * yields the same numbers a Python-emitted `job_metrics_final` would have.
 * Pure / dependency-free so it stays straightforward to unit test.
 */
export function percentile(samples: number[], pct: number): number {
    if (!samples.length) return 0;
    const clamped = Math.max(0, Math.min(100, Math.floor(pct)));
    const ordered = [...samples].map(s => (Number.isFinite(s) ? s : 0)).sort((a, b) => a - b);
    if (ordered.length === 1) return Math.round(ordered[0] * 100) / 100;
    const rank = (clamped / 100) * (ordered.length - 1);
    const low = Math.floor(rank);
    const high = Math.min(low + 1, ordered.length - 1);
    const fraction = rank - low;
    const value = ordered[low] + (ordered[high] - ordered[low]) * fraction;
    return Math.round(value * 100) / 100;
}

export function parsePartida(doc: any): PartidaResolvedV2 | null {
    if (!doc) return null;
    const data = (doc.data && typeof doc.data === 'function' ? doc.data() : doc) as any;
    const payload = data?.data ?? {};
    const code = typeof payload.code === 'string' ? payload.code : null;
    if (!code) return null;
    const tier = payload.tier_used;
    return {
        code,
        tier_used: tier === 'flash' || tier === 'pro' ? tier : null,
        tier_reason: typeof payload.tier_reason === 'string' ? payload.tier_reason : null,
        tokens_in: num(payload.tokens_in),
        tokens_out: num(payload.tokens_out),
        cost_usd: num(payload.cost_usd),
        latency_ms: num(payload.latency_ms),
        cache_hit: payload.cache_hit === true ? true : payload.cache_hit === false ? false : null,
        match_kind: typeof payload.match_kind === 'string' ? payload.match_kind : null,
        confidence_score:
            typeof payload.confidence_score === 'number' ? payload.confidence_score : null,
        timestamp: toIso(data?.timestamp),
    };
}

export function parseJobMetricsFinal(doc: any): JobMetricsFinal | null {
    if (!doc) return null;
    const data = (doc.data && typeof doc.data === 'function' ? doc.data() : doc) as any;
    const payload = data?.data ?? {};
    return {
        total_tokens_in: num(payload.total_tokens_in),
        total_tokens_out: num(payload.total_tokens_out),
        total_cost_usd: num(payload.total_cost_usd),
        duration_seconds: num(payload.duration_seconds),
        partidas_total: num(payload.partidas_total),
        cache_hit_rate: num(payload.cache_hit_rate),
        latency_p50: num(payload.latency_p50),
        latency_p95: num(payload.latency_p95),
        tier_flash_count: num(payload.tier_flash_count),
        tier_pro_count: num(payload.tier_pro_count),
        needs_review_count: num(payload.needs_review_count),
        is_partial: false,
        timestamp: toIso(data?.timestamp),
    };
}

/**
 * Build an in-memory aggregate when only `partida_resolved_v2` events are
 * available (job still running or crashed before the finally block fired).
 * Marked `is_partial: true` so the UI can warn the operator that the figures
 * may grow once the swarm completes.
 */
export function buildPartialMetrics(partidas: PartidaResolvedV2[]): JobMetricsFinal | null {
    if (!partidas.length) return null;
    const latencies = partidas.map(p => p.latency_ms);
    const eligibleCache = partidas.filter(p => p.cache_hit !== null);
    const cacheHits = eligibleCache.filter(p => p.cache_hit === true).length;
    const cacheRate = eligibleCache.length
        ? Math.round((cacheHits / eligibleCache.length) * 10000) / 10000
        : 0;
    return {
        total_tokens_in: partidas.reduce((s, p) => s + p.tokens_in, 0),
        total_tokens_out: partidas.reduce((s, p) => s + p.tokens_out, 0),
        total_cost_usd: Math.round(partidas.reduce((s, p) => s + p.cost_usd, 0) * 100) / 100,
        duration_seconds: 0,
        partidas_total: partidas.length,
        cache_hit_rate: cacheRate,
        latency_p50: percentile(latencies, 50),
        latency_p95: percentile(latencies, 95),
        tier_flash_count: partidas.filter(p => p.tier_used === 'flash').length,
        tier_pro_count: partidas.filter(p => p.tier_used === 'pro').length,
        needs_review_count: partidas.filter(p => p.match_kind === 'needs_review').length,
        is_partial: true,
        timestamp: new Date().toISOString(),
    };
}

export async function getJobMetricsAction(jobId: string): Promise<JobMetricsResult> {
    const auth = await verifyAuth(true);
    if (!auth) {
        throw new Error('unauthorized');
    }

    if (!jobId || typeof jobId !== 'string') {
        return { jobMetrics: null, partidasResolved: [] };
    }

    const eventsRef = adminFirestore
        .collection('pipeline_telemetry')
        .doc(jobId)
        .collection('events');

    // Two parallel queries — events are persisted with `type` (see
    // FirebaseTelemetryRepository.save). Keeping these tight (limit 1 / 50)
    // avoids fan-out across long-running jobs that emit thousands of events.
    const [finalSnap, partidasSnap] = await Promise.all([
        eventsRef.where('type', '==', FINAL_EVENT_TYPE).orderBy('timestamp', 'desc').limit(1).get(),
        eventsRef
            .where('type', '==', PARTIDA_EVENT_TYPE)
            .orderBy('timestamp', 'desc')
            .limit(50)
            .get(),
    ]);

    const partidasResolved = partidasSnap.docs
        .map(d => parsePartida(d))
        .filter((p): p is PartidaResolvedV2 => p !== null);

    let jobMetrics: JobMetricsFinal | null = null;
    if (!finalSnap.empty) {
        jobMetrics = parseJobMetricsFinal(finalSnap.docs[0]);
    } else if (partidasResolved.length > 0) {
        jobMetrics = buildPartialMetrics(partidasResolved);
    }

    return { jobMetrics, partidasResolved };
}

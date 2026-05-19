'use server';

/**
 * Admin Server Actions to list and inspect pipeline jobs.
 *
 * The new (post-S1) architecture stores the canonical job state in
 * `pipeline_jobs/{jobId}` and ephemeral telemetry in
 * `pipeline_telemetry/{jobId}/events/{eventId}`. This module reads from
 * `pipeline_jobs` as the source of truth and falls back to deriving a
 * summary from telemetry events for legacy jobs that pre-date the
 * lifecycle collection.
 *
 * The list action accepts optional filters (status / source / date range
 * / free-text query) so the admin UI can drive both server-side scoping
 * and client-side refinement.
 */

import { adminFirestore } from '@/backend/shared/infrastructure/firebase/admin-app';
import { verifyAuth } from '@/backend/auth/auth.middleware';

export type JobSource = 'nl' | 'pdf' | 'unknown';
export type JobStatus = 'queued' | 'running' | 'in_progress' | 'completed' | 'failed' | 'canceled';

export interface PipelineJobSummary {
    jobId: string;
    source: JobSource;
    jobType?: 'measurements' | 'vision-extract' | 'nl-budget' | string;
    startedAt: string;
    endedAt?: string;
    durationMs: number;
    eventCount: number;
    eventsByType: Record<string, number>;
    status: JobStatus;
    totalEstimated?: number;
    itemCount?: number;
    lastError?: string;
    leadId?: string;
    budgetId?: string;
    uid?: string;
    attempts?: number;
    resolvedPartidaCount?: number;
    cancellation_requested?: boolean;
    updatedAt?: string;
    /** True if this row originates from a canonical `pipeline_jobs` doc; false
     *  if synthesised from `pipeline_telemetry` events alone. */
    hasCanonicalDoc: boolean;
}

export interface PipelineEventRow {
    id: string;
    type: string;
    data: any;
    timestamp: string;
}

export interface GetPipelineJobsFilters {
    /** Allowed statuses; empty/undefined means no filter. */
    statuses?: JobStatus[];
    sources?: JobSource[];
    /** ISO string. Filters jobs whose startedAt >= fromDate. */
    fromDate?: string;
    /** ISO string. Filters jobs whose startedAt <= toDate. */
    toDate?: string;
    /** Substring match against jobId / leadId / budgetId / uid. Case-insensitive. */
    search?: string;
    /** Hard limit on result size after filtering. Default 200. */
    limit?: number;
}

function toMs(ts: any): number {
    if (typeof ts === 'number') return ts;
    if (!ts) return 0;
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.getTime();
}

function toIsoOrUndefined(ts: any): string | undefined {
    const ms = toMs(ts);
    return ms ? new Date(ms).toISOString() : undefined;
}

function inferSourceFromEvents(events: any[]): JobSource {
    for (const ev of events) {
        const t = ev.type || '';
        if (t === 'extraction_started' && ev.data?.query?.includes?.('Architect')) return 'nl';
        if (t === 'extraction_started') return 'pdf';
        if (t === 'restructuring') return 'pdf';
        if (t === 'query_expansion_started') return 'nl';
    }
    return 'unknown';
}

function inferSourceFromJobType(jobType?: string): JobSource {
    if (jobType === 'nl-budget') return 'nl';
    if (jobType === 'measurements' || jobType === 'vision-extract') return 'pdf';
    return 'unknown';
}

/**
 * Convert canonical PipelineJob status to the UI-friendly `JobStatus`.
 * The UI treats `queued`+`running` as "in_progress" but the detail view
 * needs the granular value, so we expose both: `status` keeps the raw
 * domain value, `isActive` derives elsewhere.
 */
function normaliseStatus(raw: string | undefined): JobStatus {
    if (!raw) return 'in_progress';
    if (raw === 'queued' || raw === 'running') return raw as JobStatus;
    if (raw === 'completed' || raw === 'failed' || raw === 'canceled') return raw as JobStatus;
    return 'in_progress';
}

interface EventDigest {
    eventCount: number;
    eventsByType: Record<string, number>;
    startedAt: number;
    endedAt: number;
    source: JobSource;
    totalEstimated?: number;
    itemCount?: number;
    lastError?: string;
    completed: boolean;
    failed: boolean;
}

async function digestEvents(jobId: string): Promise<EventDigest | null> {
    const evSnap = await adminFirestore
        .collection('pipeline_telemetry')
        .doc(jobId)
        .collection('events')
        .orderBy('timestamp', 'asc')
        .get();
    if (evSnap.empty) return null;

    const events = evSnap.docs.map(e => ({ id: e.id, ...e.data() } as any));
    const eventsByType: Record<string, number> = {};
    for (const e of events) {
        const t = e.type || 'unknown';
        eventsByType[t] = (eventsByType[t] || 0) + 1;
    }

    const startedAtMs = toMs(events[0].timestamp);
    const lastEv = events[events.length - 1];
    const endedAtMs = toMs(lastEv.timestamp);
    const completed = events.some(e => e.type === 'budget_completed');
    const failed = events.some(e => e.type === 'extraction_failed_chunk');
    const completedEv = events.find(e => e.type === 'budget_completed');

    return {
        eventCount: events.length,
        eventsByType,
        startedAt: startedAtMs,
        endedAt: endedAtMs,
        source: inferSourceFromEvents(events),
        totalEstimated: completedEv?.data?.total,
        itemCount: completedEv?.data?.itemCount,
        lastError: failed ? (events.find(e => e.type === 'extraction_failed_chunk')?.data?.error) : undefined,
        completed,
        failed,
    };
}

function matchesFilter(summary: PipelineJobSummary, filters?: GetPipelineJobsFilters): boolean {
    if (!filters) return true;
    if (filters.statuses && filters.statuses.length > 0) {
        // Treat `queued|running|in_progress` as fungible when the filter
        // requests `in_progress` — that's how the admin UI surfaces them.
        const wanted = new Set<JobStatus>(filters.statuses);
        const candidate: JobStatus[] = [summary.status];
        if (summary.status === 'queued' || summary.status === 'running') {
            candidate.push('in_progress');
        }
        if (!candidate.some(s => wanted.has(s))) return false;
    }
    if (filters.sources && filters.sources.length > 0) {
        if (!filters.sources.includes(summary.source)) return false;
    }
    if (filters.fromDate) {
        if (new Date(summary.startedAt).getTime() < new Date(filters.fromDate).getTime()) return false;
    }
    if (filters.toDate) {
        if (new Date(summary.startedAt).getTime() > new Date(filters.toDate).getTime()) return false;
    }
    if (filters.search && filters.search.trim()) {
        const needle = filters.search.toLowerCase();
        const haystack = [
            summary.jobId,
            summary.leadId || '',
            summary.budgetId || '',
            summary.uid || '',
        ].join(' ').toLowerCase();
        if (!haystack.includes(needle)) return false;
    }
    return true;
}

/**
 * Lists pipeline jobs from `pipeline_jobs` (canonical) merged with
 * `pipeline_telemetry` (for legacy jobs without a canonical doc).
 *
 * Reads up to `limit` canonical docs + the same window of telemetry roots
 * and reconciles them by jobId so the admin sees both clean state machine
 * info AND telemetry-derived metrics like itemCount / total.
 */
export async function getPipelineJobsAction(
    limitOrFilters?: number | GetPipelineJobsFilters,
    legacyFilters?: GetPipelineJobsFilters,
): Promise<PipelineJobSummary[]> {
    // Backwards-compat: the previous signature was `(limit: number)`. The new
    // signature accepts a single filters object OR a (limit, filters) pair.
    let filters: GetPipelineJobsFilters | undefined;
    if (typeof limitOrFilters === 'number') {
        filters = { limit: limitOrFilters, ...(legacyFilters || {}) };
    } else {
        filters = limitOrFilters;
    }
    const hardLimit = filters?.limit ?? 200;

    // 1) Read canonical pipeline_jobs root docs. orderBy createdAt desc so we
    //    naturally fetch the newest first; the dispatcher writes createdAt on
    //    every job.
    let canonicalDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    try {
        const canonicalSnap = await adminFirestore
            .collection('pipeline_jobs')
            .orderBy('createdAt', 'desc')
            .limit(hardLimit)
            .get();
        canonicalDocs = canonicalSnap.docs;
    } catch (err) {
        // If the index for createdAt doesn't exist yet (fresh project) fall
        // back to an unordered scan with the same limit — Firestore will
        // raise FAILED_PRECONDITION otherwise.
        console.warn('[get-pipeline-jobs] orderBy(createdAt) failed, falling back to unordered scan', err);
        const fallback = await adminFirestore.collection('pipeline_jobs').limit(hardLimit).get();
        canonicalDocs = fallback.docs;
    }

    const summariesById = new Map<string, PipelineJobSummary>();

    // 2) Map canonical docs → summaries; enrich with event digest if telemetry
    //    exists. This is intentionally sequential because canonical state already
    //    gives us the basics — telemetry is bonus context.
    for (const doc of canonicalDocs) {
        const data = doc.data() as any;
        const jobId = doc.id;
        const startedAt = data.startedAt ? toMs(data.startedAt) : toMs(data.createdAt);
        const endedAt = data.finishedAt ? toMs(data.finishedAt) : (data.updatedAt ? toMs(data.updatedAt) : 0);
        const status = normaliseStatus(data.status);
        const summary: PipelineJobSummary = {
            jobId,
            source: inferSourceFromJobType(data.jobType),
            jobType: data.jobType,
            startedAt: new Date(startedAt || toMs(data.createdAt)).toISOString(),
            endedAt: status === 'completed' || status === 'failed' || status === 'canceled'
                ? new Date(endedAt || startedAt || toMs(data.createdAt)).toISOString()
                : undefined,
            durationMs: status === 'completed' || status === 'failed' || status === 'canceled'
                ? Math.max(0, (endedAt || 0) - (startedAt || 0))
                : Math.max(0, Date.now() - (startedAt || toMs(data.createdAt) || Date.now())),
            eventCount: 0,
            eventsByType: {},
            status,
            lastError: data.errorMessage || undefined,
            leadId: data.leadId,
            budgetId: data.budgetId,
            uid: data.uid,
            attempts: typeof data.attempts === 'number' ? data.attempts : 0,
            resolvedPartidaCount: Array.isArray(data.resolvedPartidaCodes) ? data.resolvedPartidaCodes.length : 0,
            cancellation_requested: !!data.cancellation_requested,
            updatedAt: toIsoOrUndefined(data.updatedAt),
            hasCanonicalDoc: true,
        };

        // Best-effort enrichment with telemetry-derived metrics. We don't fail
        // the listing if the events collection doesn't exist.
        try {
            const digest = await digestEvents(jobId);
            if (digest) {
                summary.eventCount = digest.eventCount;
                summary.eventsByType = digest.eventsByType;
                // Prefer telemetry source when canonical was 'unknown'
                if (summary.source === 'unknown') summary.source = digest.source;
                summary.totalEstimated = digest.totalEstimated;
                summary.itemCount = digest.itemCount;
                if (!summary.lastError) summary.lastError = digest.lastError;
            }
        } catch {
            // ignore
        }

        summariesById.set(jobId, summary);
    }

    // 3) Read pipeline_telemetry root docs (legacy + orphans without canonical).
    //    For each one not already in the canonical map, synthesise a summary
    //    purely from the events digest.
    try {
        const rootSnap = await adminFirestore.collection('pipeline_telemetry').limit(hardLimit).get();
        for (const doc of rootSnap.docs) {
            const jobId = doc.id;
            if (summariesById.has(jobId)) continue;
            const digest = await digestEvents(jobId);
            if (!digest) continue;
            const status: JobStatus = digest.completed
                ? 'completed'
                : digest.failed ? 'failed' : 'in_progress';
            summariesById.set(jobId, {
                jobId,
                source: digest.source,
                startedAt: new Date(digest.startedAt).toISOString(),
                endedAt: digest.completed || digest.failed ? new Date(digest.endedAt).toISOString() : undefined,
                durationMs: digest.endedAt - digest.startedAt,
                eventCount: digest.eventCount,
                eventsByType: digest.eventsByType,
                status,
                totalEstimated: digest.totalEstimated,
                itemCount: digest.itemCount,
                lastError: digest.lastError,
                hasCanonicalDoc: false,
            });
        }
    } catch (err) {
        console.warn('[get-pipeline-jobs] could not read pipeline_telemetry roots', err);
    }

    const all = Array.from(summariesById.values());
    const filtered = all.filter(s => matchesFilter(s, filters));
    filtered.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    return filtered.slice(0, hardLimit);
}

/**
 * Returns the chronologically ordered telemetry events for one job. Up to
 * `limit` events (default 500), enough for a paginated timeline UI.
 */
export async function getPipelineJobDetailAction(
    jobId: string,
    limit: number = 500,
): Promise<PipelineEventRow[]> {
    const evSnap = await adminFirestore
        .collection('pipeline_telemetry')
        .doc(jobId)
        .collection('events')
        .orderBy('timestamp', 'asc')
        .limit(limit)
        .get();

    return evSnap.docs.map(d => {
        const data = d.data() as any;
        return {
            id: d.id,
            type: data.type || 'unknown',
            data: data.data ?? {},
            timestamp: new Date(toMs(data.timestamp)).toISOString(),
        };
    });
}

// ---------------------------------------------------------------------------
// Extended detail action — surfaces canonical state, attempts and checkpoints
// alongside events for the admin detail page.
// ---------------------------------------------------------------------------

export interface PipelineJobAttemptRow {
    attemptId: string;
    attemptNumber: number;
    status: string;
    startedAt: string;
    endedAt?: string;
    errorMessage?: string;
    partidasResolved: number;
    resumeFromCount: number;
    executionName?: string;
}

export interface PipelineJobCheckpointRow {
    partidaCode: string;
    attemptId?: string;
    resolvedAt?: string;
    matchKind?: string;
    confidenceScore?: number;
    tokenCost?: number;
}

export interface PipelineJobFullDetail {
    summary: PipelineJobSummary;
    canonical?: {
        jobId: string;
        jobType: string;
        status: string;
        leadId: string;
        budgetId: string;
        uid?: string;
        attempts: number;
        cancellation_requested: boolean;
        currentAttemptId: string | null;
        currentExecutionName: string | null;
        lastCheckpointCode: string | null;
        resolvedPartidaCount: number;
        errorMessage: string | null;
        errorType: string | null;
        createdAt: string;
        updatedAt: string;
        startedAt: string | null;
        finishedAt: string | null;
    };
    events: PipelineEventRow[];
    attempts: PipelineJobAttemptRow[];
    checkpoints: PipelineJobCheckpointRow[];
}

export async function getPipelineJobFullDetailAction(
    jobId: string,
    options?: { eventLimit?: number; checkpointLimit?: number },
): Promise<{ ok: true; data: PipelineJobFullDetail } | { ok: false; error: string }> {
    // Admin gating — the page already gates, but defensive gate on the action
    // too so a leaked URL isn't enough to extract event data.
    const auth = await verifyAuth(true);
    if (!auth) return { ok: false, error: 'forbidden' };

    const eventLimit = options?.eventLimit ?? 500;
    const checkpointLimit = options?.checkpointLimit ?? 1000;

    try {
        // Canonical doc (may not exist for legacy jobs).
        const canonicalSnap = await adminFirestore.collection('pipeline_jobs').doc(jobId).get();
        let canonicalData: PipelineJobFullDetail['canonical'] | undefined;
        if (canonicalSnap.exists) {
            const d = canonicalSnap.data() as any;
            canonicalData = {
                jobId,
                jobType: d.jobType || 'unknown',
                status: d.status || 'unknown',
                leadId: d.leadId,
                budgetId: d.budgetId,
                uid: d.uid,
                attempts: d.attempts ?? 0,
                cancellation_requested: !!d.cancellation_requested,
                currentAttemptId: d.currentAttemptId ?? null,
                currentExecutionName: d.currentExecutionName ?? null,
                lastCheckpointCode: d.lastCheckpointCode ?? null,
                resolvedPartidaCount: Array.isArray(d.resolvedPartidaCodes) ? d.resolvedPartidaCodes.length : 0,
                errorMessage: d.errorMessage ?? null,
                errorType: d.errorType ?? null,
                createdAt: toIsoOrUndefined(d.createdAt) || new Date().toISOString(),
                updatedAt: toIsoOrUndefined(d.updatedAt) || new Date().toISOString(),
                startedAt: toIsoOrUndefined(d.startedAt) || null,
                finishedAt: toIsoOrUndefined(d.finishedAt) || null,
            };
        }

        // Events (telemetry).
        const events = await getPipelineJobDetailAction(jobId, eventLimit);

        // Attempts sub-collection.
        const attempts: PipelineJobAttemptRow[] = [];
        try {
            const attSnap = await adminFirestore
                .collection('pipeline_jobs')
                .doc(jobId)
                .collection('attempts')
                .get();
            for (const a of attSnap.docs) {
                const ad = a.data() as any;
                attempts.push({
                    attemptId: ad.attemptId || a.id,
                    attemptNumber: ad.attemptNumber ?? 0,
                    status: ad.status || 'unknown',
                    startedAt: toIsoOrUndefined(ad.startedAt) || new Date().toISOString(),
                    endedAt: toIsoOrUndefined(ad.endedAt),
                    errorMessage: ad.errorMessage,
                    partidasResolved: ad.partidasResolved ?? 0,
                    resumeFromCount: ad.resumeFromCount ?? 0,
                    executionName: ad.executionName,
                });
            }
            attempts.sort((a, b) => a.attemptNumber - b.attemptNumber);
        } catch {
            // Subcollection might not exist for legacy jobs — leave empty.
        }

        // Checkpoints sub-collection.
        const checkpoints: PipelineJobCheckpointRow[] = [];
        try {
            const cpSnap = await adminFirestore
                .collection('pipeline_jobs')
                .doc(jobId)
                .collection('checkpoints')
                .limit(checkpointLimit)
                .get();
            for (const c of cpSnap.docs) {
                const cd = c.data() as any;
                const partida = cd.partida || {};
                checkpoints.push({
                    partidaCode: cd.partidaCode || c.id,
                    attemptId: cd.attemptId,
                    resolvedAt: toIsoOrUndefined(cd.resolvedAt),
                    matchKind: partida.match_kind || partida.matchKind,
                    confidenceScore: partida.confidence_score ?? partida.confidenceScore,
                    tokenCost: cd.tokenCost,
                });
            }
            checkpoints.sort((a, b) => (a.partidaCode || '').localeCompare(b.partidaCode || ''));
        } catch {
            // ignore
        }

        // Reuse the list-action summary builder to keep the row consistent with
        // the table view.
        const summaries = await getPipelineJobsAction({ search: jobId, limit: 5 });
        let summary = summaries.find(s => s.jobId === jobId);
        if (!summary) {
            // Fallback summary if listing didn't find it (e.g. very fresh canonical doc).
            summary = {
                jobId,
                source: canonicalData ? inferSourceFromJobType(canonicalData.jobType) : 'unknown',
                jobType: canonicalData?.jobType,
                startedAt: canonicalData?.startedAt || canonicalData?.createdAt || new Date().toISOString(),
                durationMs: 0,
                eventCount: events.length,
                eventsByType: events.reduce((acc, e) => {
                    acc[e.type] = (acc[e.type] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>),
                status: normaliseStatus(canonicalData?.status),
                leadId: canonicalData?.leadId,
                budgetId: canonicalData?.budgetId,
                uid: canonicalData?.uid,
                attempts: canonicalData?.attempts ?? 0,
                resolvedPartidaCount: canonicalData?.resolvedPartidaCount ?? checkpoints.length,
                cancellation_requested: canonicalData?.cancellation_requested,
                updatedAt: canonicalData?.updatedAt,
                hasCanonicalDoc: !!canonicalData,
            };
        }

        return {
            ok: true,
            data: {
                summary,
                canonical: canonicalData,
                events,
                attempts,
                checkpoints,
            },
        };
    } catch (err: any) {
        console.error('[get-pipeline-job-full-detail] error', err);
        return { ok: false, error: err?.message || 'unknown_error' };
    }
}

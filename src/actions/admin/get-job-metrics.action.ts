'use server';

/**
 * Sprint 1 — S1-B-01: admin job metrics reader.
 *
 * Reads two strongly-typed telemetry events emitted by the Python swarm:
 *   - `partida_resolved_v2`: per-partida cost/tier/match metadata.
 *   - `job_metrics_final`: aggregate KPIs (cost, latency p50/p95, tier counts).
 *
 * Pure helpers + interfaces live in `_job-metrics-helpers.ts` so this file
 * can be a strict Server Actions module (all exports must be async).
 */

import { adminFirestore } from '@/backend/shared/infrastructure/firebase/admin-app';
import { verifyAuth } from '@/backend/auth/auth.middleware';
import {
    FINAL_EVENT_TYPE,
    PARTIDA_EVENT_TYPE,
    type JobMetricsResult,
    type JobMetricsFinal,
    type PartidaResolvedV2,
    parsePartida,
    parseJobMetricsFinal,
    buildPartialMetrics,
} from './_job-metrics-helpers';

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

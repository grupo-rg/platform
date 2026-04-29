'use server';

import { adminFirestore } from '@/backend/shared/infrastructure/firebase/admin-app';

export interface PipelineJobSummary {
    jobId: string;
    source: 'nl' | 'pdf' | 'unknown';
    startedAt: string;
    endedAt?: string;
    durationMs: number;
    eventCount: number;
    eventsByType: Record<string, number>;
    status: 'completed' | 'failed' | 'in_progress';
    totalEstimated?: number;
    itemCount?: number;
    lastError?: string;
}

export interface PipelineEventRow {
    id: string;
    type: string;
    data: any;
    timestamp: string;
}

function toMs(ts: any): number {
    if (typeof ts === 'number') return ts;
    if (!ts) return 0;
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.getTime();
}

function inferSource(events: any[]): 'nl' | 'pdf' | 'unknown' {
    for (const ev of events) {
        const t = ev.type || '';
        if (t === 'extraction_started' && ev.data?.query?.includes?.('Architect')) return 'nl';
        if (t === 'extraction_started') return 'pdf';
        if (t === 'restructuring') return 'pdf';
        if (t === 'query_expansion_started') return 'nl';
    }
    return 'unknown';
}

export async function getPipelineJobsAction(limit: number = 50): Promise<PipelineJobSummary[]> {
    // Leemos los documentos root de pipeline_telemetry y, para cada uno, sus events.
    // Firestore no nos da ordenación por docs raíz (están vacíos), así que leemos
    // los events.orderBy(timestamp desc) de cada uno y consolidamos. Para la primera
    // versión limitamos a los 50 últimos jobs más reciente; a futuro conviene tener
    // un doc-level summary que se actualice con un trigger.
    const rootSnap = await adminFirestore.collection('pipeline_telemetry').limit(200).get();
    const summaries: PipelineJobSummary[] = [];

    for (const doc of rootSnap.docs) {
        const jobId = doc.id;
        const evSnap = await doc.ref.collection('events').orderBy('timestamp', 'asc').get();
        if (evSnap.empty) continue;

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
        const status: PipelineJobSummary['status'] = completed ? 'completed' : (failed ? 'failed' : 'in_progress');

        const completedEv = events.find(e => e.type === 'budget_completed');

        summaries.push({
            jobId,
            source: inferSource(events),
            startedAt: new Date(startedAtMs).toISOString(),
            endedAt: completed || failed ? new Date(endedAtMs).toISOString() : undefined,
            durationMs: endedAtMs - startedAtMs,
            eventCount: events.length,
            eventsByType,
            status,
            totalEstimated: completedEv?.data?.total,
            itemCount: completedEv?.data?.itemCount,
            lastError: failed ? (events.find(e => e.type === 'extraction_failed_chunk')?.data?.error) : undefined,
        });
    }

    // Más recientes primero
    summaries.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    return summaries.slice(0, limit);
}

export async function getPipelineJobDetailAction(jobId: string): Promise<PipelineEventRow[]> {
    const evSnap = await adminFirestore
        .collection('pipeline_telemetry')
        .doc(jobId)
        .collection('events')
        .orderBy('timestamp', 'asc')
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

'use server';

/**
 * Fase 4c — lanzar y seguir el JOB de ingesta del libro nuevo a staging.
 *
 * `dispatchPriceBookIngestAction` reenvía el PDF + páginas confirmadas al
 * endpoint que crea el pipeline_job y dispara el Cloud Run Job worker (202).
 * `getPriceBookIngestStatusAction` lee el estado canónico de
 * `pipeline_jobs/{jobId}` + el progreso de `pipeline_telemetry/{jobId}/events`
 * (la UI hace polling en vez de SSE — más robusto para un job de minutos en
 * funciones serverless de Vercel).
 *
 * (Fichero aparte de `ingest-price-book.action.ts`, que es el trigger legacy
 * no-op `ingestPriceBookAction` del uploader huérfano.)
 */

import { adminFirestore } from '@/backend/shared/infrastructure/firebase/admin-app';

export type DispatchIngestResult =
  | { success: true; jobId: string; staging: string; pages: number; year: number }
  | { success: false; error: string };

export interface IngestDiffSummary {
  extracted: number;
  new: number;
  changed: number;
  unchanged: number;
  matched: number;
  avg_change_pct: number | null;
}

export interface IngestStatus {
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled' | 'unknown';
  phase?: string;
  message?: string;
  staging?: string;
  diff?: IngestDiffSummary;
  itemsSaved?: number;
  breakdownsSaved?: number;
  activeItemCount?: number;
  error?: string;
  eventCount: number;
}

export async function dispatchPriceBookIngestAction(args: {
  gcsUri: string;
  pages: string;
  year: number | string;
}): Promise<DispatchIngestResult> {
  try {
    const { gcsUri } = args;
    if (!gcsUri || !gcsUri.startsWith('gs://')) {
      return { success: false, error: 'Falta la referencia del PDF (gs://...).' };
    }
    const pages = String(args.pages ?? '');
    const year = String(args.year ?? '');
    if (!pages) return { success: false, error: 'No hay páginas confirmadas.' };
    if (!year) return { success: false, error: 'Falta el año.' };

    const AI_CORE_URL = process.env.AI_CORE_URL || 'http://127.0.0.1:8080';
    const token = process.env.INTERNAL_WORKER_TOKEN;

    const forward = new FormData();
    forward.append('gcsUri', gcsUri);
    forward.append('pages', pages);
    forward.append('year', year);

    const headers: Record<string, string> = {};
    if (token) headers['x-internal-token'] = token;

    const res = await fetch(`${AI_CORE_URL}/api/v1/jobs/price-book-extract`, {
      method: 'POST',
      headers,
      body: forward,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => `HTTP ${res.status}`);
      return { success: false, error: `No se pudo lanzar la ingesta: ${body}` };
    }
    const data = (await res.json()) as {
      jobId: string;
      staging: string;
      pages: number;
      year: number;
    };
    return {
      success: true,
      jobId: data.jobId,
      staging: data.staging,
      pages: data.pages,
      year: data.year,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error desconocido lanzando la ingesta.' };
  }
}

export async function getPriceBookIngestStatusAction(jobId: string): Promise<IngestStatus> {
  if (!jobId) return { status: 'unknown', eventCount: 0 };
  try {
    const jobSnap = await adminFirestore.collection('pipeline_jobs').doc(jobId).get();
    const job = jobSnap.exists ? (jobSnap.data() as any) : null;

    const evSnap = await adminFirestore
      .collection('pipeline_telemetry')
      .doc(jobId)
      .collection('events')
      .orderBy('timestamp', 'asc')
      .get();
    const events = evSnap.docs.map((d) => d.data() as any);

    const findLast = (t: string) => [...events].reverse().find((e) => e.type === t);
    const completedEv = findLast('price_book_ingest_completed');
    const failedEv = findLast('price_book_ingest_failed');
    const progressEv = findLast('price_book_ingest_progress');
    const startedEv = findLast('price_book_ingest_started');

    const status: IngestStatus['status'] = (job?.status as any) || 'unknown';
    const out: IngestStatus = { status, eventCount: events.length };

    out.phase = progressEv?.data?.phase;
    out.message = progressEv?.data?.message ?? startedEv?.data?.message;
    out.staging = completedEv?.data?.staging ?? startedEv?.data?.staging;

    if (completedEv) {
      out.diff = completedEv.data?.diff as IngestDiffSummary | undefined;
      out.itemsSaved = completedEv.data?.items_saved;
      out.breakdownsSaved = completedEv.data?.breakdowns_saved;
      out.activeItemCount = completedEv.data?.active_item_count;
    }
    if (failedEv) {
      out.error = failedEv.data?.errorMessage ?? job?.errorMessage;
    } else if (job?.errorMessage) {
      out.error = job.errorMessage;
    }
    return out;
  } catch (err: any) {
    return { status: 'unknown', eventCount: 0, error: err?.message };
  }
}

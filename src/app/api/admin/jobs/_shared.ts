/**
 * Shared helpers for the /api/admin/jobs/* REST endpoints.
 *
 * These endpoints exist so admins (and curl/Postman/scripts) can drive
 * the same actions the UI exposes — Cancel / Retry / Force-fail —
 * without going through Server Actions (which require a Next.js client
 * boundary).
 */

import { NextResponse } from 'next/server';
import { adminFirestore } from '@/backend/shared/infrastructure/firebase/admin-app';
import { verifyAuth } from '@/backend/auth/auth.middleware';

export type JobViewResponse = {
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

function toIso(value: any): string | null {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    if (typeof value.toDate === 'function') return (value.toDate() as Date).toISOString();
    return null;
}

export async function loadJobView(jobId: string): Promise<JobViewResponse | null> {
    const snap = await adminFirestore.collection('pipeline_jobs').doc(jobId).get();
    if (!snap.exists) return null;
    const d = snap.data() as any;
    return {
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
        createdAt: toIso(d.createdAt) || new Date().toISOString(),
        updatedAt: toIso(d.updatedAt) || new Date().toISOString(),
        startedAt: toIso(d.startedAt),
        finishedAt: toIso(d.finishedAt),
    };
}

export async function requireAdmin(): Promise<{ ok: true; uid: string; email?: string } | { ok: false; response: NextResponse }> {
    const auth = await verifyAuth(true);
    if (!auth) {
        return {
            ok: false,
            response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
        };
    }
    return { ok: true, uid: auth.userId, email: auth.email };
}

export function aiCoreUrl(): { base: string; token: string | undefined } {
    return {
        base: process.env.AI_CORE_URL || 'http://127.0.0.1:8080',
        token: process.env.INTERNAL_WORKER_TOKEN,
    };
}

export async function callDispatcher(
    path: string,
    method: 'GET' | 'POST' = 'POST',
): Promise<{ ok: true; status: number; body: any } | { ok: false; status: number; error: string }> {
    const { base, token } = aiCoreUrl();
    const url = `${base}${path}`;
    try {
        const response = await fetch(url, {
            method,
            headers: token ? { 'x-internal-token': token } : undefined,
        });
        let body: any = null;
        const text = await response.text();
        try { body = text ? JSON.parse(text) : null; } catch { body = text; }
        if (!response.ok) {
            const detail = typeof body === 'object' && body && 'detail' in body
                ? body.detail
                : (typeof body === 'string' ? body : `HTTP ${response.status}`);
            return { ok: false, status: response.status, error: String(detail) };
        }
        return { ok: true, status: response.status, body };
    } catch (err: any) {
        return { ok: false, status: 502, error: err?.message || 'fetch_failed' };
    }
}

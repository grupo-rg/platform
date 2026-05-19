/**
 * POST /api/admin/jobs/{jobId}/force-fail
 *
 * Admin override that writes status='failed' directly to the canonical
 * pipeline_jobs doc. Does NOT call the dispatcher (the dispatcher's
 * cancel endpoint is cooperative — it requires the worker to be alive
 * and polling for the flag). Use this when:
 *
 *   - A worker has demonstrably died (OOM, crash) and the cooperative
 *     cancel won't terminate the job.
 *   - You want to clear a zombi from the admin list so it stops showing
 *     up as "in progress".
 *
 * Side-effects:
 *   - errorMessage = "admin force-fail (zombie cleanup)" (configurable
 *     via JSON body { "reason": "..." }).
 *   - errorType = "AdminForceFail".
 *   - cancellation_requested = true (so any still-alive worker will see
 *     the flag at next poll and bail out).
 *   - Audit log written to audit_logs/{auto}.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminFirestore } from '@/backend/shared/infrastructure/firebase/admin-app';
import { FieldValue } from 'firebase-admin/firestore';
import { loadJobView, requireAdmin } from '../../_shared';

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ jobId: string }> },
) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { jobId } = await context.params;
    if (!jobId) return NextResponse.json({ error: 'missing_job_id' }, { status: 400 });

    let reason = 'admin force-fail (zombie cleanup)';
    try {
        const body = await request.json();
        if (typeof body?.reason === 'string' && body.reason.trim()) {
            reason = body.reason.trim();
        }
    } catch {
        // No JSON body — keep the default reason.
    }

    const ref = adminFirestore.collection('pipeline_jobs').doc(jobId);
    const snap = await ref.get();
    if (!snap.exists) {
        return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
    }
    const data = snap.data() as any;
    const previousStatus = data.status || 'unknown';

    if (previousStatus === 'failed' || previousStatus === 'completed' || previousStatus === 'canceled') {
        return NextResponse.json(
            { error: `job_already_terminal:${previousStatus}` },
            { status: 409 },
        );
    }

    const now = new Date();
    await ref.update({
        status: 'failed',
        errorMessage: reason,
        errorType: 'AdminForceFail',
        finishedAt: now,
        updatedAt: now,
        cancellation_requested: true,
    });

    try {
        await adminFirestore.collection('audit_logs').add({
            kind: 'pipeline_job_force_fail',
            actorUid: auth.uid,
            actorEmail: auth.email ?? null,
            jobId,
            previousStatus,
            reason,
            source: 'rest_api',
            timestamp: FieldValue.serverTimestamp(),
        });
    } catch (auditErr) {
        console.warn('[force-fail REST] audit log failed (non-fatal)', auditErr);
    }

    const view = await loadJobView(jobId);
    return NextResponse.json({
        ok: true,
        job: view,
        previousStatus,
    });
}

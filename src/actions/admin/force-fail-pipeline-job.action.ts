'use server';

/**
 * Admin "force-fail" Server Action.
 *
 * Marks a pipeline job as `failed` directly via the admin Firestore SDK,
 * bypassing the cooperative cancel mechanism. Use this when:
 *   - A worker has actually died (OOM, network partition) and the canonical
 *     doc is stuck in `queued`/`running` forever — the dispatcher's
 *     cooperative cancel won't help because there's nothing listening for
 *     the cancellation flag.
 *   - You want to clear a zombi from the admin list so it stops showing up
 *     as "in progress".
 *
 * This action only touches the canonical `pipeline_jobs/{jobId}` doc. It
 * does NOT issue `cancel_execution` against Cloud Run Jobs — if the
 * worker is still alive it would keep running until it next polled for
 * the flag and saw it. For genuinely-alive jobs prefer the cooperative
 * `adminCancelPipelineJobAction`.
 *
 * Audit: writes a row to `audit_logs/{auto}` with kind `pipeline_job_force_fail`,
 * `{ actorUid, actorEmail, jobId, previousStatus, reason }`.
 */

import { adminFirestore } from '@/backend/shared/infrastructure/firebase/admin-app';
import { verifyAuth } from '@/backend/auth/auth.middleware';
import { FieldValue } from 'firebase-admin/firestore';

export type AdminForceFailResult =
    | {
        success: true;
        jobId: string;
        previousStatus: string;
        status: 'failed';
    }
    | { success: false; error: string; status?: number };

export async function adminForceFailPipelineJobAction(
    jobId: string,
    reason: string = 'admin force-fail (zombie cleanup)',
): Promise<AdminForceFailResult> {
    const auth = await verifyAuth(true);
    if (!auth) return { success: false, error: 'forbidden', status: 403 };

    if (!jobId || typeof jobId !== 'string') {
        return { success: false, error: 'invalid_job_id', status: 400 };
    }

    try {
        const ref = adminFirestore.collection('pipeline_jobs').doc(jobId);
        const snap = await ref.get();
        if (!snap.exists) {
            return { success: false, error: 'job_not_found', status: 404 };
        }
        const data = snap.data() as any;
        const previousStatus = data.status || 'unknown';

        // Already terminal? Treat as no-op success — admin can run this
        // multiple times without harm.
        if (previousStatus === 'failed' || previousStatus === 'completed' || previousStatus === 'canceled') {
            return {
                success: false,
                error: `job_already_terminal:${previousStatus}`,
                status: 409,
            };
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

        // Audit log (best-effort).
        try {
            await adminFirestore.collection('audit_logs').add({
                kind: 'pipeline_job_force_fail',
                actorUid: auth.userId,
                actorEmail: auth.email ?? null,
                jobId,
                previousStatus,
                reason,
                timestamp: FieldValue.serverTimestamp(),
            });
        } catch (auditErr) {
            console.warn('[admin force-fail] audit log failed (non-fatal)', auditErr);
        }

        return {
            success: true,
            jobId,
            previousStatus,
            status: 'failed',
        };
    } catch (err: any) {
        return { success: false, error: err?.message || 'force_fail_failed' };
    }
}

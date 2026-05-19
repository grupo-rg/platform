'use server';

/**
 * Admin "force-cancel" Server Action.
 *
 * Proxies the cancel call to the ai-core dispatcher's
 * `POST /api/v1/jobs/{jobId}/cancel` endpoint, gated on the admin claim
 * (so a regular logged-in user can't trigger this even with the URL).
 *
 * This is the admin counterpart of `src/actions/pipeline/cancel-pipeline-job.action.ts`,
 * which is intended for the budget owner. They share the same downstream
 * endpoint but enforce different authorisation rules.
 */

import { verifyAuth } from '@/backend/auth/auth.middleware';

export type AdminCancelResult =
    | {
        success: true;
        jobId: string;
        status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled';
        cancellation_requested: boolean;
    }
    | { success: false; error: string; status?: number };

export async function adminCancelPipelineJobAction(
    jobId: string,
): Promise<AdminCancelResult> {
    const auth = await verifyAuth(true);
    if (!auth) return { success: false, error: 'forbidden', status: 403 };

    if (!jobId || typeof jobId !== 'string') {
        return { success: false, error: 'invalid_job_id', status: 400 };
    }

    try {
        const AI_CORE_URL = process.env.AI_CORE_URL || 'http://127.0.0.1:8080';
        const targetUrl = `${AI_CORE_URL}/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`;
        const token = process.env.INTERNAL_WORKER_TOKEN;

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: token ? { 'x-internal-token': token } : undefined,
        });

        if (!response.ok) {
            let detail = '';
            try {
                const errBody = await response.json();
                detail = errBody.detail || JSON.stringify(errBody);
            } catch {
                detail = await response.text().catch(() => `HTTP ${response.status}`);
            }
            return {
                success: false,
                error: detail,
                status: response.status,
            };
        }

        const body = await response.json();
        return {
            success: true,
            jobId: body.jobId,
            status: body.status,
            cancellation_requested: body.cancellation_requested,
        };
    } catch (err: any) {
        return { success: false, error: err?.message || 'Cancel failed' };
    }
}

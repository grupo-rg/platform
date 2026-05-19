'use server';

/**
 * Admin "force-retry" Server Action.
 *
 * Proxies to `POST /api/v1/jobs/{jobId}/retry` on the ai-core dispatcher.
 * Gated on the admin claim. The dispatcher will refuse the retry if the
 * job isn't in a terminal state (`failed`/`canceled`); that 409 surfaces
 * here as a `success: false` with `status: 409`.
 */

import { verifyAuth } from '@/backend/auth/auth.middleware';

export type AdminRetryResult =
    | {
        success: true;
        jobId: string;
        status: 'queued';
        executionName?: string;
    }
    | { success: false; error: string; status?: number };

export async function adminRetryPipelineJobAction(
    jobId: string,
): Promise<AdminRetryResult> {
    const auth = await verifyAuth(true);
    if (!auth) return { success: false, error: 'forbidden', status: 403 };

    if (!jobId || typeof jobId !== 'string') {
        return { success: false, error: 'invalid_job_id', status: 400 };
    }

    try {
        const AI_CORE_URL = process.env.AI_CORE_URL || 'http://127.0.0.1:8080';
        const targetUrl = `${AI_CORE_URL}/api/v1/jobs/${encodeURIComponent(jobId)}/retry`;
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
            executionName: body.executionName,
        };
    } catch (err: any) {
        return { success: false, error: err?.message || 'Retry failed' };
    }
}

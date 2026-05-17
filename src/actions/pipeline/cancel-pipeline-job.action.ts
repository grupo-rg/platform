'use server';

/**
 * Cancel a running (or queued) pipeline job.
 *
 * The dispatcher endpoint flips `cancellation_requested` in Firestore AND
 * issues `cancel_execution` on Cloud Run Jobs, so the worker (1) sees the
 * flag at its next poll and exits voluntarily and (2) is hit with SIGTERM
 * as a fallback if it doesn't get to the flag in time. Cancel is
 * idempotent on already-terminal executions.
 */

export type CancelResult =
  | {
      success: true;
      jobId: string;
      status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled';
      cancellation_requested: boolean;
    }
  | { success: false; error: string; status?: number };

export async function cancelPipelineJobAction(
  jobId: string,
): Promise<CancelResult> {
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

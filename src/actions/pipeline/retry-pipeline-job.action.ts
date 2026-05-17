'use server';

/**
 * Retry a failed or canceled pipeline job.
 *
 * The dispatcher transitions the Firestore doc back to `queued` and kicks
 * off a fresh Cloud Run Jobs execution. Checkpoints from the previous
 * attempt are preserved — the worker reads them and asks the runner to
 * skip those partidas (P4.b). Today (P4.a) the runner ignores resume
 * codes and starts over, but the lifecycle plumbing is already in place.
 */

export type RetryResult =
  | {
      success: true;
      jobId: string;
      status: 'queued';
      executionName?: string;
    }
  | { success: false; error: string; status?: number };

export async function retryPipelineJobAction(
  jobId: string,
): Promise<RetryResult> {
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

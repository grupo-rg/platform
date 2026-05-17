'use server';

/**
 * Dispatches a pipeline job via the new ai-core Cloud Run Jobs path.
 *
 * Replaces the legacy `extractMeasurementPdfAction` + `generateBudgetFromSpecsAction`
 * for the three job types. The Server Action is intentionally THIN — it just
 * proxies a JSON POST to the dispatcher; the heavy work (PDF upload to
 * Storage) is done in the browser via `uploadPdfForPipelineJob` before
 * this action is called.
 *
 * Why a single action for all jobTypes:
 *   - One code path → one place to evolve.
 *   - The legacy actions are kept side-by-side during the canary rollout
 *     (feature flag `NEXT_PUBLIC_USE_PIPELINE_JOBS`). At cutover they get
 *     removed in one commit, gated by the AST regression test on the
 *     Python side.
 */

export type JobType = 'measurements' | 'vision-extract' | 'nl-budget';

export interface DispatchInput {
  jobType: JobType;
  uid: string;
  leadId: string;
  budgetId: string;
  payload: {
    gcsUri?: string;
    strategy?: 'INLINE' | 'ANNEXED';
    narrative?: string;
    pdf_url?: string;
  };
}

export type DispatchResult =
  | {
      success: true;
      jobId: string;
      budgetId: string;
      status: 'queued';
      executionName?: string;
    }
  | {
      success: false;
      error: string;
      /** Present when the dispatcher created the doc before failing —
       * lets the UI surface a real "failed" state instead of pretending
       * the request never happened. */
      jobId?: string;
    };

export async function dispatchPipelineJobAction(
  input: DispatchInput,
): Promise<DispatchResult> {
  try {
    const AI_CORE_URL = process.env.AI_CORE_URL || 'http://127.0.0.1:8080';
    const targetUrl = `${AI_CORE_URL}/api/v1/jobs/dispatch`;
    const token = process.env.INTERNAL_WORKER_TOKEN;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['x-internal-token'] = token;
    }

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      // Try to parse the dispatcher's structured error body, fall back to text.
      let detail = '';
      let jobId: string | undefined;
      try {
        const errBody = await response.json();
        detail = errBody.detail || JSON.stringify(errBody);
        jobId = errBody.jobId;
      } catch {
        try {
          detail = await response.text();
        } catch {
          detail = `HTTP ${response.status}`;
        }
      }
      return {
        success: false,
        error: `Dispatch failed (${response.status}): ${detail}`,
        jobId,
      };
    }

    const body = await response.json();
    return {
      success: true,
      jobId: body.jobId,
      budgetId: input.budgetId,
      status: 'queued',
      executionName: body.executionName,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Unknown error during dispatch',
    };
  }
}

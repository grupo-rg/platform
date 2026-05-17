'use client';

import { v4 as uuidv4 } from 'uuid';

import { dispatchPipelineJobAction } from '@/actions/pipeline/dispatch-pipeline-job.action';
import {
  extractPdfMetadataAction,
  type ExtractedBudgetMetadata,
} from '@/actions/pipeline/extract-pdf-metadata.action';
import { uploadPdfForPipelineJob } from '@/lib/firebase/storage-uploader';

/**
 * End-to-end client-side orchestrator for the measurements pipeline job.
 *
 * Combines:
 *   1. Storage upload (client → Firebase Storage)
 *   2. Server Action dispatch (server → ai-core /api/v1/jobs/dispatch)
 *
 * So the caller (BudgetWizardChat) doesn't need to know about the
 * two-step nature of the new flow. Returns `{jobId, budgetId}` ready to
 * feed into `<BudgetGenerationProgress pipelineJobId={...} budgetId={...} />`.
 *
 * Designed so flipping `NEXT_PUBLIC_USE_PIPELINE_JOBS` to true and
 * swapping the old `extractMeasurementPdfAction(formData)` call for
 * `dispatchMeasurementsJob({...})` is a near-1:1 replacement at the
 * call site.
 */

export interface DispatchMeasurementsJobInput {
  file: File;
  uid: string;
  leadId: string;
  /** Optional — generated if omitted, so callers that don't have one upfront
   * can still use this helper. The Firestore docs key off this id. */
  budgetId?: string;
  strategy: 'INLINE' | 'ANNEXED';
  onUploadProgress?: (fraction: number) => void;
  /**
   * Hook the wizard uses to insert a confirmation step between the upload and
   * the dispatch: after uploading the PDF the helper calls
   * `extractPdfMetadataAction`, then invokes this callback so the caller can
   * show a Dialog with the extracted fields pre-filled. The callback returns
   * the *final* values (after user edits) that get sent in the dispatch
   * payload. Resolve `null` to cancel the dispatch entirely.
   *
   * If omitted: no extraction is run and no metadata is sent (legacy
   * behaviour preserved for tests and any non-wizard callers).
   */
  onMetadataConfirm?: (
    extracted: ExtractedBudgetMetadata,
  ) => Promise<{ clientName?: string; budgetTitle?: string } | null>;
}

export type DispatchMeasurementsJobResult =
  | {
      success: true;
      jobId: string;
      budgetId: string;
      status: 'queued';
    }
  | {
      success: false;
      error: string;
      /** Set when the server-side dispatcher already created a Firestore
       * doc before failing — UI can navigate to that job's failed state
       * instead of pretending the request never happened. */
      jobId?: string;
    };

export async function dispatchMeasurementsJob(
  input: DispatchMeasurementsJobInput,
): Promise<DispatchMeasurementsJobResult> {
  const budgetId = input.budgetId || uuidv4();
  // We pre-generate jobId client-side too so the Storage path is
  // deterministic — the dispatcher will overwrite the doc's jobId field if
  // it generates its own, but the Storage upload path won't change.
  const jobId = uuidv4();

  let gcsUri: string;
  try {
    const uploaded = await uploadPdfForPipelineJob({
      file: input.file,
      uid: input.uid,
      jobId,
      onProgress: input.onUploadProgress,
    });
    gcsUri = uploaded.gcsUri;
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Failed to upload PDF to Storage',
    };
  }

  let clientName: string | undefined;
  let budgetTitle: string | undefined;
  if (input.onMetadataConfirm) {
    const extractRes = await extractPdfMetadataAction({ gcsUri });
    const extracted: ExtractedBudgetMetadata = extractRes.success
      ? extractRes.metadata
      : { clientName: null, budgetTitle: null, projectAddress: null, confidence: 0 };
    const confirmed = await input.onMetadataConfirm(extracted);
    if (confirmed === null) {
      return { success: false, error: 'Cancelado por el usuario' };
    }
    clientName = confirmed.clientName?.trim() || undefined;
    budgetTitle = confirmed.budgetTitle?.trim() || undefined;
  }

  const dispatch = await dispatchPipelineJobAction({
    jobType: 'measurements',
    uid: input.uid,
    leadId: input.leadId,
    budgetId,
    payload: { gcsUri, strategy: input.strategy, clientName, budgetTitle },
  });

  if (!dispatch.success) {
    return {
      success: false,
      error: dispatch.error,
      jobId: dispatch.jobId,
    };
  }

  return {
    success: true,
    jobId: dispatch.jobId,
    budgetId,
    status: 'queued',
  };
}

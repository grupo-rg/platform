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

export type DispatchPhase =
  | 'uploading'
  | 'extracting_metadata'
  | 'awaiting_confirm'
  | 'dispatching';

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
   * Sprint 4 Fase J — emitted at every client-side transition so the caller
   * can mirror progress to durable storage (localStorage / Firestore) and
   * survive a reload mid-flow. Phases reflect what the helper is doing
   * RIGHT NOW; once the function returns, the job is either `running`
   * (success → worker dispatched) or terminated (failure / user cancel).
   *
   * `extra.extractedMetadata` is only present on `awaiting_confirm` so the
   * caller can cache the LLM output and re-open the dialog on reload if it
   * wants to (current wizard chooses to discard and ask the user to re-upload
   * the PDF, which is simpler and avoids stale-state restore bugs).
   */
  onPhaseChange?: (
    phase: DispatchPhase,
    extra?: { extractedMetadata?: ExtractedBudgetMetadata },
  ) => void;
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

  input.onPhaseChange?.('uploading');

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
    input.onPhaseChange?.('extracting_metadata');
    const extractRes = await extractPdfMetadataAction({ gcsUri });
    const extracted: ExtractedBudgetMetadata = extractRes.success
      ? extractRes.metadata
      : { clientName: null, budgetTitle: null, projectAddress: null, confidence: 0 };
    input.onPhaseChange?.('awaiting_confirm', { extractedMetadata: extracted });
    const confirmed = await input.onMetadataConfirm(extracted);
    if (confirmed === null) {
      return { success: false, error: 'Cancelado por el usuario' };
    }
    clientName = confirmed.clientName?.trim() || undefined;
    budgetTitle = confirmed.budgetTitle?.trim() || undefined;
  }

  input.onPhaseChange?.('dispatching');
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

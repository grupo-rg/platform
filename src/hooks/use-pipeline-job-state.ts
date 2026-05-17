/**
 * Pure UI-state derivation for the pipeline-jobs panel.
 *
 * Extracted from the hook so it stays exhaustively unit-testable without
 * pulling React + Firestore into the test environment. The hook itself
 * (`usePipelineJob`) just composes a Firestore `onSnapshot` subscription
 * with this function.
 *
 * The shape mirrors the `JobView` returned by the dispatcher's `GET
 * /api/v1/jobs/{jobId}` endpoint, so the UI works against the same
 * contract whether it reads via the REST endpoint or directly via
 * Firestore listener.
 */

export type PipelineJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled';

export type PipelineJobType = 'measurements' | 'vision-extract' | 'nl-budget';

export interface PipelineJobView {
  jobId: string;
  jobType: PipelineJobType;
  status: PipelineJobStatus;
  leadId: string;
  budgetId: string;
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
}

export interface PipelineJobUiState {
  canCancel: boolean;
  canRetry: boolean;
  /** True if the job is running and updatedAt is older than 5 min — UI
   * should show a soft warning banner ("la tarea está ralentizada"). */
  isStale: boolean;
  /** True if the job is running and started over 90 min ago — UI should
   * surface the Reintentar button prominently and warn the user. */
  isTimedOut: boolean;
  resolvedPartidaCount: number;
  /** Returns null because the parent doc doesn't carry totalPartidas; the
   * UI can show the count alone or compute % via a separate query. */
  progressPercent: number | null;
}

const STALE_THRESHOLD_MS = 5 * 60 * 1000;
const TIMEOUT_THRESHOLD_MS = 90 * 60 * 1000;

const ACTIVE_STATUSES: PipelineJobStatus[] = ['queued', 'running'];
const RETRYABLE_STATUSES: PipelineJobStatus[] = ['failed', 'canceled'];

export function derivePipelineJobUiState(
  job: PipelineJobView | null,
  now: Date,
): PipelineJobUiState {
  if (!job) {
    return {
      canCancel: false,
      canRetry: false,
      isStale: false,
      isTimedOut: false,
      resolvedPartidaCount: 0,
      progressPercent: null,
    };
  }

  const isActive = ACTIVE_STATUSES.includes(job.status);
  const updatedAtAge =
    now.getTime() - new Date(job.updatedAt).getTime();
  const startedAtAge = job.startedAt
    ? now.getTime() - new Date(job.startedAt).getTime()
    : 0;

  return {
    canCancel: isActive && !job.cancellation_requested,
    canRetry: RETRYABLE_STATUSES.includes(job.status),
    isStale: job.status === 'running' && updatedAtAge > STALE_THRESHOLD_MS,
    isTimedOut:
      job.status === 'running' &&
      !!job.startedAt &&
      startedAtAge > TIMEOUT_THRESHOLD_MS,
    resolvedPartidaCount: job.resolvedPartidaCount,
    // We don't know the total count yet at this level — UI displays the
    // running counter and treats it as relative progress.
    progressPercent: null,
  };
}

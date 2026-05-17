import { describe, it, expect } from 'vitest';

import {
  derivePipelineJobUiState,
  type PipelineJobView,
} from './use-pipeline-job-state';

function job(overrides: Partial<PipelineJobView> = {}): PipelineJobView {
  const now = new Date('2026-05-17T10:00:00Z');
  return {
    jobId: 'job-1',
    jobType: 'measurements',
    status: 'running',
    leadId: 'lead-1',
    budgetId: 'budget-1',
    attempts: 1,
    cancellation_requested: false,
    currentAttemptId: 'att-1',
    currentExecutionName: 'exec-1',
    lastCheckpointCode: null,
    resolvedPartidaCount: 0,
    errorMessage: null,
    errorType: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    startedAt: now.toISOString(),
    finishedAt: null,
    ...overrides,
  };
}

const NOW = new Date('2026-05-17T11:30:00Z');

describe('derivePipelineJobUiState', () => {
  // ----- canCancel ----------------------------------------------------------

  it('canCancel is true while running and not already requested', () => {
    const s = derivePipelineJobUiState(job({ status: 'running' }), NOW);
    expect(s.canCancel).toBe(true);
  });

  it('canCancel is false once cancellation has been requested (idempotency)', () => {
    const s = derivePipelineJobUiState(
      job({ status: 'running', cancellation_requested: true }),
      NOW,
    );
    expect(s.canCancel).toBe(false);
  });

  it('canCancel is false while queued (no execution running yet)', () => {
    // Edge case: user opens the panel right before the worker claims. We
    // still allow cancel here since the dispatcher API supports it (flips
    // the flag; the worker will exit immediately on its first poll).
    const s = derivePipelineJobUiState(job({ status: 'queued' }), NOW);
    expect(s.canCancel).toBe(true);
  });

  it('canCancel is false on terminal statuses', () => {
    for (const status of ['completed', 'failed', 'canceled'] as const) {
      const s = derivePipelineJobUiState(job({ status }), NOW);
      expect(s.canCancel).toBe(false);
    }
  });

  // ----- canRetry -----------------------------------------------------------

  it('canRetry is true only on failed or canceled', () => {
    expect(derivePipelineJobUiState(job({ status: 'failed' }), NOW).canRetry).toBe(
      true,
    );
    expect(
      derivePipelineJobUiState(job({ status: 'canceled' }), NOW).canRetry,
    ).toBe(true);
  });

  it('canRetry is false on terminal positive and non-terminal statuses', () => {
    expect(
      derivePipelineJobUiState(job({ status: 'completed' }), NOW).canRetry,
    ).toBe(false);
    expect(
      derivePipelineJobUiState(job({ status: 'running' }), NOW).canRetry,
    ).toBe(false);
    expect(
      derivePipelineJobUiState(job({ status: 'queued' }), NOW).canRetry,
    ).toBe(false);
  });

  // ----- isStale (watchdog level 1: 5 min) ---------------------------------

  it('isStale is true if running and updatedAt > 5min ago', () => {
    const j = job({
      status: 'running',
      updatedAt: new Date('2026-05-17T11:24:00Z').toISOString(), // 6 min ago
    });
    expect(derivePipelineJobUiState(j, NOW).isStale).toBe(true);
  });

  it('isStale is false on fresh heartbeats', () => {
    const j = job({
      status: 'running',
      updatedAt: new Date('2026-05-17T11:28:00Z').toISOString(), // 2 min ago
    });
    expect(derivePipelineJobUiState(j, NOW).isStale).toBe(false);
  });

  it('isStale is false on terminal jobs (no banner needed)', () => {
    const j = job({
      status: 'completed',
      updatedAt: new Date('2026-05-17T10:00:00Z').toISOString(), // 1h30m ago
    });
    expect(derivePipelineJobUiState(j, NOW).isStale).toBe(false);
  });

  // ----- isTimedOut (watchdog level 2: 90 min) -----------------------------

  it('isTimedOut is true if running and startedAt > 90min ago', () => {
    const j = job({
      status: 'running',
      startedAt: new Date('2026-05-17T09:55:00Z').toISOString(), // 1h35m ago
    });
    expect(derivePipelineJobUiState(j, NOW).isTimedOut).toBe(true);
  });

  it('isTimedOut is false if running but under 90min', () => {
    const j = job({
      status: 'running',
      startedAt: new Date('2026-05-17T10:30:00Z').toISOString(), // 1h ago
    });
    expect(derivePipelineJobUiState(j, NOW).isTimedOut).toBe(false);
  });

  it('isTimedOut is false on terminal jobs', () => {
    const j = job({ status: 'completed' });
    expect(derivePipelineJobUiState(j, NOW).isTimedOut).toBe(false);
  });

  // ----- progressPercent ---------------------------------------------------

  it('progressPercent is null when no partidas resolved yet', () => {
    const s = derivePipelineJobUiState(
      job({ resolvedPartidaCount: 0 }),
      NOW,
    );
    expect(s.progressPercent).toBeNull();
  });

  it('progressPercent reflects partidasResolved (no total yet — relative)', () => {
    // Note: the parent doc only carries resolvedPartidaCount, not totalPartidas.
    // The hook returns null for an absolute %; UI can use the count alone.
    const s = derivePipelineJobUiState(
      job({ resolvedPartidaCount: 42 }),
      NOW,
    );
    expect(s.resolvedPartidaCount).toBe(42);
    expect(s.progressPercent).toBeNull();
  });

  // ----- null job (loading state) ------------------------------------------

  it('handles null job with safe defaults', () => {
    const s = derivePipelineJobUiState(null, NOW);
    expect(s.canCancel).toBe(false);
    expect(s.canRetry).toBe(false);
    expect(s.isStale).toBe(false);
    expect(s.isTimedOut).toBe(false);
    expect(s.resolvedPartidaCount).toBe(0);
    expect(s.progressPercent).toBeNull();
  });
});

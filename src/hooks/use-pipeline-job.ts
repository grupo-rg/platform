'use client';

import { doc, onSnapshot, type DocumentData } from 'firebase/firestore';
import { useEffect, useState } from 'react';

import { getSafeDb } from '@/lib/firebase/client';

import {
  derivePipelineJobUiState,
  type PipelineJobUiState,
  type PipelineJobView,
} from './use-pipeline-job-state';

/**
 * Subscribes to `pipeline_jobs/{jobId}` and returns the current job snapshot
 * plus derived UI state (canCancel, canRetry, isStale, isTimedOut).
 *
 * The hook returns null while loading or when no jobId is given. The
 * Firestore subscription is torn down on unmount (or when jobId changes).
 *
 * Pure-UI logic lives in `use-pipeline-job-state.ts` and is exhaustively
 * unit-tested without React. This hook is a thin wrapper around it.
 */

export interface UsePipelineJobResult {
  job: PipelineJobView | null;
  ui: PipelineJobUiState;
  loading: boolean;
  error: string | null;
}

function snapshotToJobView(data: DocumentData): PipelineJobView {
  // Firestore returns Timestamps for datetime fields; serialise to ISO so
  // the UI state derivation can use new Date(string) uniformly.
  const toIso = (value: unknown): string | null => {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (value && typeof (value as any).toDate === 'function') {
      return (value as any).toDate().toISOString();
    }
    return null;
  };

  return {
    jobId: data.jobId,
    jobType: data.jobType,
    status: data.status,
    leadId: data.leadId,
    budgetId: data.budgetId,
    attempts: data.attempts ?? 0,
    cancellation_requested: !!data.cancellation_requested,
    currentAttemptId: data.currentAttemptId ?? null,
    currentExecutionName: data.currentExecutionName ?? null,
    lastCheckpointCode: data.lastCheckpointCode ?? null,
    resolvedPartidaCount: Array.isArray(data.resolvedPartidaCodes)
      ? data.resolvedPartidaCodes.length
      : 0,
    errorMessage: data.errorMessage ?? null,
    errorType: data.errorType ?? null,
    createdAt: toIso(data.createdAt) || new Date().toISOString(),
    updatedAt: toIso(data.updatedAt) || new Date().toISOString(),
    startedAt: toIso(data.startedAt),
    finishedAt: toIso(data.finishedAt),
  };
}

export function usePipelineJob(jobId: string | null): UsePipelineJobResult {
  const [job, setJob] = useState<PipelineJobView | null>(null);
  const [loading, setLoading] = useState<boolean>(!!jobId);
  const [error, setError] = useState<string | null>(null);
  // `now` ticks every 30 seconds so `isStale` / `isTimedOut` re-evaluate
  // even without a Firestore change event (worker might be SILENT, which
  // is exactly the case we need the watchdog to surface).
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    let unsub: (() => void) | null = null;
    try {
      const db = getSafeDb();
      const ref = doc(db, 'pipeline_jobs', jobId);
      unsub = onSnapshot(
        ref,
        (snapshot) => {
          if (!snapshot.exists()) {
            setJob(null);
            setLoading(false);
            return;
          }
          setJob(snapshotToJobView(snapshot.data()));
          setLoading(false);
        },
        (err) => {
          setError(err.message);
          setLoading(false);
        },
      );
    } catch (err: any) {
      setError(err?.message || 'Failed to subscribe to pipeline job');
      setLoading(false);
    }

    return () => {
      if (unsub) unsub();
    };
  }, [jobId]);

  useEffect(() => {
    // Watchdog tick. 30s keeps wall-clock UI checks cheap while still
    // reacting fast enough to alert the user about a stuck job (5min stale,
    // 90min timeout).
    const interval = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(interval);
  }, []);

  return {
    job,
    ui: derivePipelineJobUiState(job, now),
    loading,
    error,
  };
}

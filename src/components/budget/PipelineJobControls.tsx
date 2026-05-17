'use client';

import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { useState, useTransition } from 'react';

import { cancelPipelineJobAction } from '@/actions/pipeline/cancel-pipeline-job.action';
import { retryPipelineJobAction } from '@/actions/pipeline/retry-pipeline-job.action';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { usePipelineJob } from '@/hooks/use-pipeline-job';
import type { PipelineJobStatus } from '@/hooks/use-pipeline-job-state';

interface PipelineJobControlsProps {
  jobId: string | null;
}

/**
 * UI control bar for a long-running pipeline job.
 *
 * Renders status + Cancel/Retry buttons + the watchdog banners (stale at
 * 5 min, timed-out warning at 90 min). Replaces the silent "loading
 * forever" experience that motivated this whole rewrite — the user sees
 * a clear status and can recover without the operator.
 *
 * Designed to live ABOVE the existing `BudgetGenerationProgress` timeline.
 * The timeline keeps its SSE telemetry feed; this panel adds the
 * lifecycle-state controls that the legacy code didn't have.
 */
export function PipelineJobControls({ jobId }: PipelineJobControlsProps) {
  const { job, ui, loading, error } = usePipelineJob(jobId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!jobId) return null;
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Cargando estado del trabajo…</span>
      </div>
    );
  }
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>No se puede leer el estado del trabajo</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!job) {
    // Job doc not yet visible (race between dispatch return and Firestore
    // propagation, typically <1s).
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Preparando trabajo…</span>
      </div>
    );
  }

  const onCancel = () => {
    setActionError(null);
    startTransition(async () => {
      const result = await cancelPipelineJobAction(job.jobId);
      if (!result.success) {
        setActionError(`No se pudo cancelar: ${result.error}`);
      }
    });
  };

  const onRetry = () => {
    setActionError(null);
    startTransition(async () => {
      const result = await retryPipelineJobAction(job.jobId);
      if (!result.success) {
        setActionError(`No se pudo reintentar: ${result.error}`);
      }
    });
  };

  return (
    <div className="space-y-3 rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusBadge status={job.status} />
          <div className="text-xs text-muted-foreground">
            Intento {job.attempts}
            {job.resolvedPartidaCount > 0 && (
              <>
                {' · '}
                {job.resolvedPartidaCount} partidas resueltas
              </>
            )}
            {job.errorMessage && job.status === 'failed' && (
              <>
                {' · '}
                <span className="text-destructive">{job.errorMessage}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {ui.canCancel && (
            <Button
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="mr-1 h-4 w-4" />
              )}
              Cancelar
            </Button>
          )}
          {ui.canRetry && (
            <Button
              size="sm"
              onClick={onRetry}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-4 w-4" />
              )}
              Reintentar
            </Button>
          )}
        </div>
      </div>

      {actionError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {ui.isTimedOut && (
        <Alert variant="destructive">
          <Clock className="h-4 w-4" />
          <AlertTitle>El trabajo lleva más de 90 minutos en ejecución</AlertTitle>
          <AlertDescription>
            Esto suele indicar que algo se ha quedado bloqueado. Puedes
            cancelar y reintentar — los checkpoints ya generados se conservan
            para que el siguiente intento retome desde donde se quedó.
          </AlertDescription>
        </Alert>
      )}

      {ui.isStale && !ui.isTimedOut && (
        <Alert>
          <Clock className="h-4 w-4" />
          <AlertTitle>El trabajo está ralentizado</AlertTitle>
          <AlertDescription>
            No hemos recibido señales del worker en los últimos 5 minutos. Si
            sigue así, podrás reintentar a los 90 minutos.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: PipelineJobStatus }) {
  const styles: Record<
    PipelineJobStatus,
    { label: string; icon: React.ReactNode; className: string }
  > = {
    queued: {
      label: 'En cola',
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      className: 'bg-muted text-muted-foreground',
    },
    running: {
      label: 'En ejecución',
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      className: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100',
    },
    completed: {
      label: 'Completado',
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      className: 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100',
    },
    failed: {
      label: 'Fallido',
      icon: <AlertCircle className="h-3.5 w-3.5" />,
      className: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100',
    },
    canceled: {
      label: 'Cancelado',
      icon: <XCircle className="h-3.5 w-3.5" />,
      className: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-100',
    },
  };

  const s = styles[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${s.className}`}
    >
      {s.icon}
      {s.label}
    </span>
  );
}

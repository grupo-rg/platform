'use client';

/**
 * Banner shown above the wizard chat when the persisted session has a
 * `lastJobId` and that job is still running. Lets the user click through
 * to the budget progress view without losing the chat state.
 *
 * Uses `usePipelineJob` so the banner auto-hides as soon as the job
 * reaches a terminal state.
 */

import Link from 'next/link';
import { usePipelineJob } from '@/hooks/use-pipeline-job';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

export interface ActiveJobBannerProps {
    jobId: string | null;
    /** Optional budgetId. If present we route to the budget edit page;
     *  otherwise to the admin job detail page (admins only). */
    budgetId?: string | null;
    locale?: string;
}

export function ActiveJobBanner({ jobId, budgetId, locale = 'es' }: ActiveJobBannerProps) {
    const { job, loading } = usePipelineJob(jobId);

    if (!jobId) return null;
    if (loading) {
        return (
            <Alert className="border-blue-200 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-950/20">
                <Loader2 className="h-4 w-4 animate-spin" />
                <AlertTitle className="text-sm">Comprobando estado del job…</AlertTitle>
            </Alert>
        );
    }
    if (!job) return null;
    if (job.status !== 'queued' && job.status !== 'running') return null;

    const ageMs = Date.now() - new Date(job.startedAt || job.createdAt).getTime();
    const isStuck = ageMs > 5 * 60 * 1000;

    const href = budgetId
        ? `/${locale}/dashboard/admin/budgets/${budgetId}/edit`
        : `/${locale}/dashboard/admin/jobs/${jobId}`;

    return (
        <Alert className={isStuck ? 'border-amber-300 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20' : 'border-blue-200 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-950/20'}>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                    {isStuck ? (
                        <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-300 mt-0.5" />
                    ) : (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-300 mt-0.5" />
                    )}
                    <div>
                        <AlertTitle className="text-sm">
                            {isStuck
                                ? 'Tienes un job activo (lleva varios minutos)'
                                : 'Tienes un job activo en curso'}
                        </AlertTitle>
                        <AlertDescription className="text-xs">
                            Job <code className="font-mono">{jobId.slice(0, 8)}…</code> · iniciado hace {formatDistanceToNow(new Date(job.startedAt || job.createdAt), { locale: es })}
                            {job.resolvedPartidaCount > 0 && ` · ${job.resolvedPartidaCount} partidas resueltas`}
                        </AlertDescription>
                    </div>
                </div>
                <Link href={href}>
                    <Button size="sm" variant="outline" className="gap-1">
                        Ver progreso <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                </Link>
            </div>
        </Alert>
    );
}

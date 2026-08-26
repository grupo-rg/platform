/**
 * Admin "Pipeline Job Detail" page.
 *
 * Loads the canonical doc + telemetry events + attempts + checkpoints
 * for a single job and renders:
 *   - Header card with status, ids, basic metadata.
 *   - Stat cards: duration, attempts, partidas resolved, total estimated.
 *   - Action bar: Cancel / Retry / Force-fail.
 *   - Timeline of telemetry events (collapsible, filterable, paginated).
 *   - Attempts table.
 *   - Checkpoints table (paginated, searchable).
 */

import { notFound, redirect } from 'next/navigation';
import { verifyAuth } from '@/backend/auth/auth.middleware';
import { getPipelineJobFullDetailAction } from '@/actions/admin/get-pipeline-jobs.action';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { JobTimeline } from '@/components/admin/jobs/job-timeline';
import { JobAttempts } from '@/components/admin/jobs/job-attempts';
import { JobCheckpoints } from '@/components/admin/jobs/job-checkpoints';
import { JobActionBar } from '@/components/admin/jobs/job-action-bar';
import { ArrowLeft, Activity, Clock, Coins, Layers, Repeat2, AlertCircle, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { formatCurrency } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface PageProps {
    params: Promise<{ jobId: string; locale: string }>;
}

function formatDuration(ms: number): string {
    if (!ms || ms <= 0) return '—';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

function statusBadge(status: string, cancellationRequested?: boolean) {
    const cfg: Record<string, { label: string; className: string }> = {
        completed: { label: 'Completado', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' },
        failed: { label: 'Fallido', className: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30' },
        canceled: { label: 'Cancelado', className: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30' },
        running: { label: cancellationRequested ? 'Cancelando…' : 'En curso', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30' },
        queued: { label: 'En cola', className: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/30' },
        in_progress: { label: 'En curso', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30' },
    };
    const c = cfg[status] || { label: status, className: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/30' };
    return <Badge variant="outline" className={`text-sm py-1 px-3 ${c.className}`}>{c.label}</Badge>;
}

export default async function AdminJobDetailPage({ params }: PageProps) {
    const { jobId, locale } = await params;
    const auth = await verifyAuth(true);
    if (!auth) redirect(`/${locale}/dashboard`);

    const result = await getPipelineJobFullDetailAction(jobId);
    if (!result.ok) {
        if (result.error === 'forbidden') redirect(`/${locale}/dashboard`);
        // Otherwise show a friendly empty state instead of bailing.
    }
    const detail = result.ok ? result.data : null;
    if (!detail) notFound();

    const { summary, canonical, events, attempts, checkpoints } = detail;

    const status = canonical?.status || summary.status;
    const cancellationRequested = canonical?.cancellation_requested ?? summary.cancellation_requested;

    return (
        <div className="flex-1 space-y-6 max-w-7xl mx-auto p-4 md:p-8">
            {/* Back nav */}
            <Link
                href={`/${locale}/dashboard/admin/jobs`}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
                <ArrowLeft className="h-4 w-4" />
                Volver a la lista
            </Link>

            {/* Header */}
            <Card>
                <CardHeader>
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div className="space-y-2">
                            <div className="flex items-center gap-3 flex-wrap">
                                <div className="p-2 bg-primary/10 rounded-lg">
                                    <Activity className="w-5 h-5 text-primary" />
                                </div>
                                <CardTitle className="text-2xl font-mono">
                                    {jobId.slice(0, 8)}<span className="text-muted-foreground">…</span>
                                </CardTitle>
                                {statusBadge(status, cancellationRequested)}
                                {summary.jobType && (
                                    <Badge variant="outline" className="text-xs">{summary.jobType}</Badge>
                                )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span>jobId: <code className="font-mono text-foreground/80 bg-muted px-1 rounded">{jobId}</code></span>
                                {summary.leadId && (
                                    <span>leadId: <code className="font-mono text-foreground/80 bg-muted px-1 rounded">{summary.leadId}</code></span>
                                )}
                                {summary.budgetId && (
                                    <span className="inline-flex items-center gap-1">
                                        budgetId: <code className="font-mono text-foreground/80 bg-muted px-1 rounded">{summary.budgetId}</code>
                                        <Link href={`/${locale}/dashboard/admin/budgets/${summary.budgetId}/edit`} className="text-primary hover:underline">
                                            <ExternalLink className="h-3 w-3" />
                                        </Link>
                                    </span>
                                )}
                                {summary.uid && (
                                    <span>uid: <code className="font-mono text-foreground/80 bg-muted px-1 rounded">{summary.uid.slice(0, 12)}…</code></span>
                                )}
                            </div>
                        </div>
                        <JobActionBar jobId={jobId} status={status} cancellationRequested={!!cancellationRequested} />
                    </div>
                </CardHeader>
                <CardContent>
                    {/* Error message banner */}
                    {(canonical?.errorMessage || summary.lastError) && (
                        <div className="flex items-start gap-3 p-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50">
                            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                            <div className="min-w-0">
                                <div className="text-xs font-semibold text-red-800 dark:text-red-300">
                                    {canonical?.errorType || 'Error'}
                                </div>
                                <div className="text-xs text-red-700 dark:text-red-200 break-words">
                                    {canonical?.errorMessage || summary.lastError}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Timing strip */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4 text-xs">
                        <div>
                            <div className="text-muted-foreground">Inicio</div>
                            <div className="font-medium">
                                {format(new Date(summary.startedAt), 'd MMM yyyy HH:mm:ss', { locale: es })}
                            </div>
                            <div className="text-muted-foreground">
                                hace {formatDistanceToNow(new Date(summary.startedAt), { locale: es })}
                            </div>
                        </div>
                        {summary.endedAt && (
                            <div>
                                <div className="text-muted-foreground">Fin</div>
                                <div className="font-medium">
                                    {format(new Date(summary.endedAt), 'd MMM yyyy HH:mm:ss', { locale: es })}
                                </div>
                            </div>
                        )}
                        {summary.updatedAt && (
                            <div>
                                <div className="text-muted-foreground">Última actividad</div>
                                <div className="font-medium">
                                    {format(new Date(summary.updatedAt), 'd MMM HH:mm:ss', { locale: es })}
                                </div>
                                <div className="text-muted-foreground">
                                    hace {formatDistanceToNow(new Date(summary.updatedAt), { locale: es })}
                                </div>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard
                    icon={<Clock className="h-4 w-4" />}
                    label="Duración"
                    value={formatDuration(summary.durationMs)}
                    className="text-blue-600 dark:text-blue-400"
                />
                <StatCard
                    icon={<Repeat2 className="h-4 w-4" />}
                    label="Intentos"
                    value={String(canonical?.attempts ?? summary.attempts ?? attempts.length)}
                    className="text-purple-600 dark:text-purple-400"
                />
                <StatCard
                    icon={<Layers className="h-4 w-4" />}
                    label="Partidas resueltas"
                    value={String(canonical?.resolvedPartidaCount ?? checkpoints.length)}
                    className="text-emerald-600 dark:text-emerald-400"
                />
                <StatCard
                    icon={<Coins className="h-4 w-4" />}
                    label="Importe estimado"
                    value={typeof summary.totalEstimated === 'number'
                        ? formatCurrency(summary.totalEstimated)
                        : '—'}
                    className="text-amber-600 dark:text-amber-400"
                />
            </div>

            {/* Eventos por tipo (resumen) */}
            {Object.keys(summary.eventsByType).length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Eventos por tipo</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-wrap gap-2">
                            {Object.entries(summary.eventsByType)
                                .sort((a, b) => b[1] - a[1])
                                .map(([type, count]) => (
                                    <Badge key={type} variant="outline" className="font-mono text-xs gap-1">
                                        <span>{type}</span>
                                        <span className="text-muted-foreground">×{count}</span>
                                    </Badge>
                                ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            <JobTimeline events={events} />
            <JobAttempts attempts={attempts} />
            <JobCheckpoints checkpoints={checkpoints} />
        </div>
    );
}

function StatCard({
    icon,
    label,
    value,
    className,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    className: string;
}) {
    return (
        <Card>
            <CardContent className="p-4">
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-md bg-zinc-100 dark:bg-zinc-800 ${className}`}>
                        {icon}
                    </div>
                    <div>
                        <div className="text-xs text-muted-foreground">{label}</div>
                        <div className={`text-xl font-bold font-mono ${className}`}>{value}</div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

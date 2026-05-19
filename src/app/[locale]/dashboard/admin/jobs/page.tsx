import { getPipelineJobsAction, type PipelineJobSummary } from '@/actions/admin/get-pipeline-jobs.action';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { Link } from '@/i18n/navigation';
import { Activity, ChevronRight, CheckCircle2, Loader2, XCircle, FileText, MessageSquare } from 'lucide-react';

export const dynamic = 'force-dynamic';

function getStatusBadge(status: PipelineJobSummary['status']) {
    switch (status) {
        case 'completed':
            return (
                <Badge variant="secondary" className="bg-green-500/10 text-green-500 hover:bg-green-500/20">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Completado
                </Badge>
            );
        case 'failed':
            return (
                <Badge variant="secondary" className="bg-red-500/10 text-red-500 hover:bg-red-500/20">
                    <XCircle className="w-3 h-3 mr-1" /> Fallido
                </Badge>
            );
        case 'in_progress':
        default:
            return (
                <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20">
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" /> En curso
                </Badge>
            );
    }
}

function getSourceBadge(source: PipelineJobSummary['source']) {
    switch (source) {
        case 'pdf':
            return (
                <Badge variant="outline" className="text-xs">
                    <FileText className="w-3 h-3 mr-1" /> PDF
                </Badge>
            );
        case 'nl':
            return (
                <Badge variant="outline" className="text-xs">
                    <MessageSquare className="w-3 h-3 mr-1" /> NL
                </Badge>
            );
        default:
            return (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                    ?
                </Badge>
            );
    }
}

function formatDuration(durationMs: number): string {
    if (!durationMs || durationMs < 0) return '-';
    const seconds = Math.round(durationMs / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainSec = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainSec}s`;
    const hours = Math.floor(minutes / 60);
    const remainMin = minutes % 60;
    return `${hours}h ${remainMin}m`;
}

function formatEuros(amount?: number): string {
    if (amount == null) return '-';
    return new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
    }).format(amount);
}

export default async function AdminJobsPage() {
    const jobs = await getPipelineJobsAction(100);

    return (
        <div className="flex-1 space-y-6 max-w-6xl mx-auto p-4 md:p-8">
            <div className="flex flex-col gap-2 mb-8">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-primary/10 rounded-lg">
                        <Activity className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-display font-bold tracking-tight">Pipeline Jobs</h1>
                        <p className="text-muted-foreground">
                            Histórico de generaciones de presupuesto (PDF + lenguaje natural). Click en un job para ver métricas y partidas.
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid gap-3">
                {jobs.map((job) => (
                    <Link key={job.jobId} href={`/dashboard/admin/jobs/${job.jobId}` as any}>
                        <Card className="hover:bg-muted/50 transition-colors border-white/5 bg-[#121212]/50 backdrop-blur-xl">
                            <CardContent className="p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                <div className="space-y-2 flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {getStatusBadge(job.status)}
                                        {getSourceBadge(job.source)}
                                        <code className="text-xs bg-white/5 px-1.5 py-0.5 rounded">
                                            {job.jobId.substring(0, 8)}…
                                        </code>
                                    </div>
                                    <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                                        <span>
                                            Hace {formatDistanceToNow(new Date(job.startedAt), { addSuffix: false, locale: es })}
                                        </span>
                                        <span>·</span>
                                        <span>Duración: {formatDuration(job.durationMs)}</span>
                                        <span>·</span>
                                        <span>{job.eventCount} eventos</span>
                                        {job.itemCount != null && (
                                            <>
                                                <span>·</span>
                                                <span>{job.itemCount} partidas</span>
                                            </>
                                        )}
                                    </div>
                                    {job.lastError && (
                                        <p className="text-xs text-red-400 line-clamp-1">
                                            Error: {job.lastError}
                                        </p>
                                    )}
                                </div>

                                <div className="flex items-center gap-6 text-sm shrink-0">
                                    {job.totalEstimated != null && (
                                        <div className="text-right hidden sm:block">
                                            <p className="font-medium">{formatEuros(job.totalEstimated)}</p>
                                            <p className="text-muted-foreground text-xs">Estimado</p>
                                        </div>
                                    )}
                                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                                </div>
                            </CardContent>
                        </Card>
                    </Link>
                ))}

                {jobs.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                        No hay jobs registrados todavía.
                    </div>
                )}
            </div>
        </div>
    );
}

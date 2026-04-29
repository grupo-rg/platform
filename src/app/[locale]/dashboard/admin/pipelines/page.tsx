import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getPipelineJobsAction } from '@/actions/admin/get-pipeline-jobs.action';
import { ArrowRight, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

function formatDuration(ms: number): string {
    if (!ms || ms < 1000) return `${ms} ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return `${m}m ${rs}s`;
}

function StatusBadge({ status }: { status: 'completed' | 'failed' | 'in_progress' }) {
    const map = {
        completed: { label: 'Completado', icon: CheckCircle2, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
        failed: { label: 'Fallido', icon: AlertCircle, cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
        in_progress: { label: 'En curso', icon: Loader2, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
    };
    const m = map[status];
    const Icon = m.icon;
    return (
        <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${m.cls}`}>
            <Icon className={`w-3 h-3 ${status === 'in_progress' ? 'animate-spin' : ''}`} />
            {m.label}
        </span>
    );
}

export default async function PipelinesPage() {
    const jobs = await getPipelineJobsAction(50);

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold font-headline tracking-tight">Jobs de pipeline IA</h1>
                <p className="text-sm text-muted-foreground">
                    Últimos 50 jobs emitidos por los pipelines NL→Budget (Python) y PDF→Budget.
                </p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Actividad reciente</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {jobs.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-12 text-center">
                            Aún no hay jobs registrados. Cuando se dispare un pipeline, sus eventos aparecerán aquí.
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
                                    <tr>
                                        <th className="text-left px-4 py-2 font-medium">Job</th>
                                        <th className="text-left px-4 py-2 font-medium">Fuente</th>
                                        <th className="text-left px-4 py-2 font-medium">Inicio</th>
                                        <th className="text-right px-4 py-2 font-medium">Duración</th>
                                        <th className="text-right px-4 py-2 font-medium">Eventos</th>
                                        <th className="text-right px-4 py-2 font-medium">Total</th>
                                        <th className="text-center px-4 py-2 font-medium">Estado</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {jobs.map(j => (
                                        <tr key={j.jobId} className="border-t hover:bg-muted/30">
                                            <td className="px-4 py-2 font-mono text-xs truncate max-w-[180px]" title={j.jobId}>{j.jobId}</td>
                                            <td className="px-4 py-2"><span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{j.source}</span></td>
                                            <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(j.startedAt).toLocaleString('es-ES')}</td>
                                            <td className="px-4 py-2 text-right tabular-nums">{formatDuration(j.durationMs)}</td>
                                            <td className="px-4 py-2 text-right tabular-nums">{j.eventCount}</td>
                                            <td className="px-4 py-2 text-right tabular-nums">
                                                {typeof j.totalEstimated === 'number'
                                                    ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(j.totalEstimated)
                                                    : '—'}
                                            </td>
                                            <td className="px-4 py-2 text-center"><StatusBadge status={j.status} /></td>
                                            <td className="px-4 py-2 text-right">
                                                <Link href={`/dashboard/admin/pipelines/${j.jobId}` as any} className="text-primary hover:underline inline-flex items-center gap-1 text-xs">
                                                    Detalle <ArrowRight className="w-3 h-3" />
                                                </Link>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

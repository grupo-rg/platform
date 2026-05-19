import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    getJobMetricsAction,
    type JobMetricsFinal,
    type PartidaResolvedV2,
} from '@/actions/admin/get-job-metrics.action';

interface JobDetailPageProps {
    params: Promise<{
        jobId: string;
    }>;
}

/**
 * Sprint 1 — S1-B-01 part 3.
 *
 * Read-only admin view for a single pipeline job. Pulls the
 * `job_metrics_final` aggregate plus the last 50 `partida_resolved_v2`
 * events (see `getJobMetricsAction`) so the operator can audit
 * cost / latency / quality of a swarm run without trawling raw telemetry.
 *
 * Graceful states:
 *   - No metrics yet → empty-state card ("job en curso o sin métricas").
 *   - Synthesised metrics (`is_partial: true`) → render KPIs + "parcial" badge.
 */
export default async function JobDetailPage({ params }: JobDetailPageProps) {
    const { jobId } = await params;
    const cleanJobId = decodeURIComponent(jobId);

    const { jobMetrics, partidasResolved } = await getJobMetricsAction(cleanJobId);

    const headerJobId = cleanJobId.length > 8 ? `${cleanJobId.slice(0, 8)}...` : cleanJobId;
    const statusBadge = renderStatusBadge(jobMetrics);

    return (
        <div className="space-y-6 max-w-6xl mx-auto p-6">
            <header className="flex items-center justify-between">
                <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Job ID</p>
                    <h1 className="text-2xl font-semibold tracking-tight" title={cleanJobId}>
                        {headerJobId}
                    </h1>
                </div>
                {statusBadge}
            </header>

            {jobMetrics ? (
                <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard
                        label="Coste total (USD)"
                        value={jobMetrics.total_cost_usd.toFixed(2)}
                        tone="indigo"
                    />
                    <StatCard
                        label="Duración (min)"
                        value={(jobMetrics.duration_seconds / 60).toFixed(1)}
                        tone="amber"
                    />
                    <StatCard
                        label="Cache hit rate"
                        value={`${Math.round(jobMetrics.cache_hit_rate * 100)}%`}
                        tone="violet"
                    />
                    <StatCard
                        label="Partidas"
                        value={String(jobMetrics.partidas_total)}
                        tone="rose"
                    />
                    <StatCard
                        label="Tier Flash"
                        value={String(jobMetrics.tier_flash_count)}
                        tone="indigo"
                    />
                    <StatCard
                        label="Tier Pro"
                        value={String(jobMetrics.tier_pro_count)}
                        tone="amber"
                    />
                    <StatCard
                        label="p50 latency (ms)"
                        value={String(jobMetrics.latency_p50)}
                        tone="violet"
                    />
                    <StatCard
                        label="p95 latency (ms)"
                        value={String(jobMetrics.latency_p95)}
                        tone="rose"
                    />
                    <StatCard
                        label="Needs review"
                        value={String(jobMetrics.needs_review_count)}
                        tone="amber"
                    />
                    <StatCard
                        label="Tokens IN"
                        value={String(jobMetrics.total_tokens_in)}
                        tone="indigo"
                    />
                    <StatCard
                        label="Tokens OUT"
                        value={String(jobMetrics.total_tokens_out)}
                        tone="violet"
                    />
                </section>
            ) : (
                <Card>
                    <CardContent className="pt-6">
                        <p className="text-sm text-muted-foreground">
                            Job en curso o sin métricas finales. Vuelve cuando el swarm
                            haya terminado o consulta la traza completa en{' '}
                            <span className="font-mono">pipeline_telemetry/{cleanJobId}/events</span>.
                        </p>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Partidas resueltas (últimas {partidasResolved.length})</CardTitle>
                </CardHeader>
                <CardContent>
                    {partidasResolved.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            Aún no se ha emitido ninguna partida_resolved_v2 para este job.
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Código</TableHead>
                                        <TableHead>Tier</TableHead>
                                        <TableHead className="text-right">Coste (USD)</TableHead>
                                        <TableHead className="text-right">Latency (ms)</TableHead>
                                        <TableHead>Match</TableHead>
                                        <TableHead className="text-right">Confianza</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {partidasResolved.map((p, idx) => (
                                        <PartidaRow key={`${p.code}-${idx}`} partida={p} />
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function renderStatusBadge(metrics: JobMetricsFinal | null) {
    if (!metrics) {
        return (
            <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">
                Sin métricas
            </Badge>
        );
    }
    if (metrics.is_partial) {
        return (
            <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">
                Parcial (en curso)
            </Badge>
        );
    }
    return (
        <Badge variant="outline" className="border-emerald-400 text-emerald-700 dark:text-emerald-300">
            Completado
        </Badge>
    );
}

function PartidaRow({ partida }: { partida: PartidaResolvedV2 }) {
    const tierTone =
        partida.tier_used === 'flash'
            ? 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300'
            : partida.tier_used === 'pro'
              ? 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300'
              : 'bg-muted text-muted-foreground';
    return (
        <TableRow>
            <TableCell className="font-mono text-xs">{partida.code}</TableCell>
            <TableCell>
                <Badge variant="outline" className={tierTone}>
                    {partida.tier_used ?? '—'}
                </Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">
                {partida.cost_usd ? partida.cost_usd.toFixed(4) : '—'}
            </TableCell>
            <TableCell className="text-right tabular-nums">
                {partida.latency_ms ? partida.latency_ms : '—'}
            </TableCell>
            <TableCell className="text-xs">{partida.match_kind ?? '—'}</TableCell>
            <TableCell className="text-right tabular-nums">
                {partida.confidence_score ?? '—'}
            </TableCell>
        </TableRow>
    );
}

function StatCard({
    label,
    value,
    tone,
}: {
    label: string;
    value: string;
    tone: 'indigo' | 'amber' | 'violet' | 'rose';
}) {
    const toneClass = {
        indigo: 'text-indigo-600 dark:text-indigo-400',
        amber: 'text-amber-600 dark:text-amber-400',
        violet: 'text-violet-600 dark:text-violet-400',
        rose: 'text-rose-600 dark:text-rose-400',
    }[tone];

    return (
        <Card>
            <CardContent className="pt-6">
                <span className="text-sm text-muted-foreground">{label}</span>
                <div className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</div>
            </CardContent>
        </Card>
    );
}

/**
 * Sprint 3 — S3-09: dashboard "Salud del Modelo".
 *
 * Solo admin. Agrega:
 *   - Cards top: recall@10 (placeholder), latencias p50/p95 bi-encoder y
 *     cross-encoder, % needs_human_review, total correction_pairs.
 *   - Heatmap: top 20 capítulos del catálogo con más correcciones humanas.
 *   - Modelos activos (env vars con defaults documentados en S3-10).
 *   - Histórico de despliegues (best-effort desde `model_deployments`).
 */
import { Activity, AlertTriangle, Brain, Clock, Database, GitBranch, History, Layers, ShieldCheck } from 'lucide-react';
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
    getModelHealthAction,
    type ChapterCorrectionRow,
} from '@/actions/admin/get-model-health.action';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export const dynamic = 'force-dynamic';

function fmtMs(value: number | null): string {
    if (value == null) return 'N/A';
    if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
    return `${Math.round(value)} ms`;
}

function fmtPct(value: number | null): string {
    if (value == null) return 'N/A';
    return `${(value * 100).toFixed(1)}%`;
}

function HeatmapBar({ row, maxCount }: { row: ChapterCorrectionRow; maxCount: number }) {
    const pct = maxCount > 0 ? (row.count / maxCount) * 100 : 0;
    // Color de intensidad — amarillo (pocas) → rojo (muchas).
    const intensity = Math.min(1, row.count / Math.max(1, maxCount));
    const hue = 50 - Math.floor(intensity * 50); // 50 (amarillo) → 0 (rojo)
    const bg = `hsl(${hue}, 85%, 55%)`;
    return (
        <div className="flex items-center gap-3">
            <div className="w-20 shrink-0 font-mono text-xs uppercase">{row.chapter}</div>
            <div className="flex-1 h-6 bg-slate-100 dark:bg-white/5 rounded relative overflow-hidden">
                <div
                    className="h-full rounded transition-all"
                    style={{ width: `${pct}%`, backgroundColor: bg }}
                />
            </div>
            <div className="w-12 shrink-0 text-right font-mono text-xs tabular-nums">
                {row.count}
            </div>
        </div>
    );
}

export default async function ModelHealthDashboardPage() {
    const result = await getModelHealthAction();

    if (!result.success) {
        return (
            <div className="space-y-6 max-w-6xl mx-auto">
                <header className="space-y-2">
                    <div className="flex items-center gap-2">
                        <Brain className="h-6 w-6 text-muted-foreground" />
                        <h1 className="font-headline text-3xl">Salud del modelo</h1>
                    </div>
                </header>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3 text-rose-600">
                            <AlertTriangle className="h-5 w-5" />
                            <div>
                                <p className="font-semibold">
                                    {result.error === 'forbidden'
                                        ? 'Acceso restringido a administradores.'
                                        : 'No se pudieron cargar las métricas.'}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">{result.error}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const { cards, correctionsByChapter, activeModels, deployments, generatedAt } = result.data;
    const heatmapMax = Math.max(1, ...correctionsByChapter.map(r => r.count));

    return (
        <div className="space-y-8 max-w-6xl mx-auto">
            <header className="space-y-2">
                <div className="flex items-center gap-2">
                    <Brain className="h-6 w-6 text-muted-foreground" />
                    <h1 className="font-headline text-3xl">Salud del modelo</h1>
                </div>
                <p className="text-muted-foreground">
                    Métricas de retrieval, latencia y dataset RLHF para el pipeline de presupuestos.
                </p>
                <p className="text-xs text-muted-foreground">
                    Generado:{' '}
                    {format(new Date(generatedAt), "d MMM yyyy 'a las' HH:mm:ss", { locale: es })}
                </p>
            </header>

            {/* KPI Cards */}
            <section>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    KPIs últimos 30 días
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    <KpiCard
                        icon={<ShieldCheck className="h-4 w-4" />}
                        label="Recall@10"
                        primary={cards.recallAt10 == null ? 'N/A' : `${(cards.recallAt10 * 100).toFixed(1)}%`}
                        sub={cards.recallAt10 == null ? 'Sin golden set' : 'Último mes'}
                        tone="indigo"
                    />
                    <KpiCard
                        icon={<Clock className="h-4 w-4" />}
                        label="Bi-encoder p50 / p95"
                        primary={`${fmtMs(cards.biEncoderLatencyP50Ms)} / ${fmtMs(cards.biEncoderLatencyP95Ms)}`}
                        sub="vector_search_completed"
                        tone="emerald"
                    />
                    <KpiCard
                        icon={<Activity className="h-4 w-4" />}
                        label="Cross-encoder p50 / p95"
                        primary={`${fmtMs(cards.crossEncoderLatencyP50Ms)} / ${fmtMs(cards.crossEncoderLatencyP95Ms)}`}
                        sub="rerank_applied"
                        tone="violet"
                    />
                    <KpiCard
                        icon={<AlertTriangle className="h-4 w-4" />}
                        label="% needs_human_review"
                        primary={fmtPct(cards.needsHumanReviewPct)}
                        sub="item_resolved último mes"
                        tone="amber"
                    />
                    <KpiCard
                        icon={<Database className="h-4 w-4" />}
                        label="Correction pairs"
                        primary={cards.correctionPairsCount.toLocaleString('es-ES')}
                        sub="dataset RLHF total"
                        tone="rose"
                    />
                </div>
            </section>

            {/* Heatmap correcciones por capítulo */}
            <section>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Layers className="h-4 w-4 text-muted-foreground" />
                            Correcciones humanas por capítulo
                        </CardTitle>
                        <Badge variant="secondary" className="font-normal text-xs">
                            Top 20
                        </Badge>
                    </CardHeader>
                    <CardContent>
                        {correctionsByChapter.length === 0 ? (
                            <p className="text-center text-sm text-muted-foreground py-8">
                                Aún no hay correcciones registradas. El dataset RLHF está vacío.
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {correctionsByChapter.map(row => (
                                    <HeatmapBar
                                        key={row.chapter}
                                        row={row}
                                        maxCount={heatmapMax}
                                    />
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </section>

            {/* Modelos activos */}
            <section>
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <GitBranch className="h-4 w-4 text-muted-foreground" />
                            Modelos activos
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Componente</TableHead>
                                    <TableHead>Modelo / versión</TableHead>
                                    <TableHead className="text-right">Fuente</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {activeModels.map(m => (
                                    <TableRow key={m.component}>
                                        <TableCell className="font-medium">{m.component}</TableCell>
                                        <TableCell className="font-mono text-xs">{m.version}</TableCell>
                                        <TableCell className="text-right">
                                            <Badge
                                                variant={m.source === 'env' ? 'default' : 'outline'}
                                                className="text-[10px]"
                                            >
                                                {m.source === 'env' ? 'env var' : 'default'}
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </section>

            {/* Histórico de despliegues */}
            <section>
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <History className="h-4 w-4 text-muted-foreground" />
                            Histórico de despliegues
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        {deployments.length === 0 ? (
                            <div className="p-8 text-center text-sm text-muted-foreground">
                                Sin despliegues registrados.
                                <br />
                                <span className="text-xs">
                                    Cree documentos en{' '}
                                    <code className="font-mono">model_deployments/*</code> con
                                    los campos <code>deployedAt</code>, <code>image</code>,{' '}
                                    <code>changes</code>, <code>revisionId</code>.
                                </span>
                            </div>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Imagen</TableHead>
                                        <TableHead>Revisión</TableHead>
                                        <TableHead>Cambios</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {deployments.map(d => (
                                        <TableRow key={d.id}>
                                            <TableCell className="text-xs whitespace-nowrap">
                                                {format(
                                                    new Date(d.deployedAt),
                                                    "d MMM yyyy HH:mm",
                                                    { locale: es },
                                                )}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">
                                                {d.image || '—'}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">
                                                {d.revisionId || '—'}
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground max-w-md">
                                                {d.changes || '—'}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            </section>
        </div>
    );
}

function KpiCard({
    icon,
    label,
    primary,
    sub,
    tone,
}: {
    icon: React.ReactNode;
    label: string;
    primary: string;
    sub: string;
    tone: 'indigo' | 'emerald' | 'violet' | 'amber' | 'rose';
}) {
    const toneClass = {
        indigo: 'text-indigo-600 dark:text-indigo-400',
        emerald: 'text-emerald-600 dark:text-emerald-400',
        violet: 'text-violet-600 dark:text-violet-400',
        amber: 'text-amber-600 dark:text-amber-400',
        rose: 'text-rose-600 dark:text-rose-400',
    }[tone];
    return (
        <Card>
            <CardContent className="pt-5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                    <span className={toneClass}>{icon}</span>
                    <span>{label}</span>
                </div>
                <div className={`text-2xl font-semibold tabular-nums ${toneClass}`}>{primary}</div>
                <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>
            </CardContent>
        </Card>
    );
}


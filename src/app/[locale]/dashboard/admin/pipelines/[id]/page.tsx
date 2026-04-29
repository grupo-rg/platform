import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getPipelineJobDetailAction } from '@/actions/admin/get-pipeline-jobs.action';
import { ArrowLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function PipelineJobDetailPage({ params }: { params: Promise<{ id: string; locale: string }> }) {
    const { id, locale } = await params;
    const events = await getPipelineJobDetailAction(id);

    const t0 = events[0] ? new Date(events[0].timestamp).getTime() : 0;

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center gap-3">
                <Link href={`/${locale}/dashboard/admin/pipelines` as any} className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-primary">
                    <ArrowLeft className="w-4 h-4" /> Volver
                </Link>
            </div>

            <div>
                <h1 className="text-xl font-bold font-headline tracking-tight">
                    Job <span className="font-mono text-sm">{id}</span>
                </h1>
                <p className="text-sm text-muted-foreground">
                    {events.length} eventos registrados
                </p>
            </div>

            {events.length === 0 ? (
                <p className="text-sm text-muted-foreground py-12 text-center">No se encontraron eventos para este job.</p>
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm">Timeline</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ol className="space-y-3">
                            {events.map((ev, i) => {
                                const t = new Date(ev.timestamp).getTime();
                                const offset = t0 ? t - t0 : 0;
                                return (
                                    <li key={ev.id} className="border-l-2 border-primary/30 pl-4 py-1">
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                                                +{(offset / 1000).toFixed(2)}s
                                            </span>
                                            <span className="text-xs font-semibold text-primary uppercase tracking-wider">{ev.type}</span>
                                        </div>
                                        {ev.data && Object.keys(ev.data).length > 0 && (
                                            <pre className="text-[11px] font-mono text-slate-600 dark:text-slate-300 bg-muted/40 rounded p-2 mt-1 overflow-x-auto">
                                                {JSON.stringify(ev.data, null, 2)}
                                            </pre>
                                        )}
                                    </li>
                                );
                            })}
                        </ol>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

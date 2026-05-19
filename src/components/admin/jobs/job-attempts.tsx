'use client';

/**
 * Lists the attempts of a pipeline job. Each attempt corresponds to a
 * single Cloud Run Jobs execution (the dispatcher creates a new attempt
 * on every retry). Shows attempt number, status, duration, partidas
 * resolved during that attempt and any error message.
 */

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
import { History, CheckCircle2, AlertCircle, XCircle, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import type { PipelineJobAttemptRow } from '@/actions/admin/get-pipeline-jobs.action';

function attemptStatusBadge(status: string) {
    if (status === 'completed') {
        return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 gap-1 border border-emerald-500/30"><CheckCircle2 className="h-3 w-3" />Completado</Badge>;
    }
    if (status === 'failed') {
        return <Badge className="bg-red-500/15 text-red-700 dark:text-red-300 gap-1 border border-red-500/30"><AlertCircle className="h-3 w-3" />Fallido</Badge>;
    }
    if (status === 'canceled') {
        return <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-300 gap-1 border border-orange-500/30"><XCircle className="h-3 w-3" />Cancelado</Badge>;
    }
    if (status === 'running') {
        return <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-300 gap-1 border border-blue-500/30"><Loader2 className="h-3 w-3 animate-spin" />En curso</Badge>;
    }
    return <Badge variant="outline">{status}</Badge>;
}

function durationFromTo(start: string, end?: string): string {
    if (!end) return 'en curso';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms <= 0) return '—';
    const sec = Math.floor(ms / 1000);
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
}

export function JobAttempts({ attempts }: { attempts: PipelineJobAttemptRow[] }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                    <History className="h-5 w-5" />
                    Intentos ({attempts.length})
                </CardTitle>
            </CardHeader>
            <CardContent>
                {attempts.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground text-sm">
                        Este job no tiene attempts registrados (legacy o aún sin ejecutar).
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>#</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead>Inicio</TableHead>
                                    <TableHead>Duración</TableHead>
                                    <TableHead className="text-right">Partidas</TableHead>
                                    <TableHead className="text-right">Reanudar desde</TableHead>
                                    <TableHead>Error</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {attempts.map(a => (
                                    <TableRow key={a.attemptId}>
                                        <TableCell className="font-mono font-semibold">{a.attemptNumber}</TableCell>
                                        <TableCell>{attemptStatusBadge(a.status)}</TableCell>
                                        <TableCell className="text-xs">
                                            {format(new Date(a.startedAt), 'd MMM HH:mm:ss')}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {durationFromTo(a.startedAt, a.endedAt)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">{a.partidasResolved}</TableCell>
                                        <TableCell className="text-right font-mono text-muted-foreground">{a.resumeFromCount}</TableCell>
                                        <TableCell className="max-w-[300px]">
                                            {a.errorMessage ? (
                                                <span className="text-xs text-red-600 dark:text-red-400 line-clamp-2" title={a.errorMessage}>
                                                    {a.errorMessage}
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground text-xs">—</span>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

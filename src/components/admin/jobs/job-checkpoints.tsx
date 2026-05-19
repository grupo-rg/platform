'use client';

/**
 * Paginated table of partida-level checkpoints for a job. Each checkpoint
 * is a partida that the worker successfully resolved (and persisted) before
 * the job ended — so a failed/canceled job's checkpoints become the
 * "resume from" set on the next retry.
 *
 * Fields surfaced:
 *   - partidaCode (doc id, natural idempotency key)
 *   - match_kind / confidence_score (set by Agent A's reranker on every
 *     partida — see partida_resolved_v2)
 *   - tokenCost (per-partida LLM spend)
 *
 * TODO Agent A: if `partida.match_kind` / `confidence_score` change shape
 * in `partida_resolved_v2`, update getPipelineJobFullDetailAction
 * accordingly. The current reader is defensive — it tolerates both
 * snake_case and camelCase variants.
 */

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    CheckCheck,
    Search,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';
import type { PipelineJobCheckpointRow } from '@/actions/admin/get-pipeline-jobs.action';

const PAGE_SIZE = 50;

function matchKindBadge(kind?: string) {
    if (!kind) return <Badge variant="outline" className="text-[10px]">—</Badge>;
    const cfg: Record<string, string> = {
        exact: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
        fuzzy: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
        semantic: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30',
        new: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    };
    const className = cfg[kind] || 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/30';
    return <Badge variant="outline" className={`gap-1 text-[10px] ${className}`}>{kind}</Badge>;
}

function confidenceCell(score?: number) {
    if (typeof score !== 'number') return <span className="text-muted-foreground text-xs">—</span>;
    const pct = Math.round(score * 100);
    const color = score >= 0.85
        ? 'text-emerald-700 dark:text-emerald-300'
        : score >= 0.6
            ? 'text-amber-700 dark:text-amber-300'
            : 'text-red-700 dark:text-red-300';
    return <span className={`font-mono text-xs font-semibold ${color}`}>{pct}%</span>;
}

export function JobCheckpoints({ checkpoints }: { checkpoints: PipelineJobCheckpointRow[] }) {
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);

    const filtered = useMemo(() => {
        const needle = search.toLowerCase().trim();
        if (!needle) return checkpoints;
        return checkpoints.filter(c =>
            (c.partidaCode || '').toLowerCase().includes(needle) ||
            (c.matchKind || '').toLowerCase().includes(needle),
        );
    }, [checkpoints, search]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                    <CheckCheck className="h-5 w-5" />
                    Checkpoints ({checkpoints.length} partidas resueltas)
                </CardTitle>
                <div className="relative max-w-xs">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Filtrar por code…"
                        className="pl-9 h-9"
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    />
                </div>
            </CardHeader>
            <CardContent>
                {visible.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground text-sm">
                        {checkpoints.length === 0
                            ? 'Este job no tiene checkpoints todavía.'
                            : 'Ningún checkpoint coincide con la búsqueda.'}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Code</TableHead>
                                    <TableHead>Match kind</TableHead>
                                    <TableHead>Confianza</TableHead>
                                    <TableHead className="text-right">Coste tokens</TableHead>
                                    <TableHead>Resuelto</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {visible.map(c => (
                                    <TableRow key={c.partidaCode}>
                                        <TableCell className="font-mono text-xs">{c.partidaCode}</TableCell>
                                        <TableCell>{matchKindBadge(c.matchKind)}</TableCell>
                                        <TableCell>{confidenceCell(c.confidenceScore)}</TableCell>
                                        <TableCell className="text-right font-mono text-xs">
                                            {typeof c.tokenCost === 'number' ? c.tokenCost.toFixed(4) : '—'}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {c.resolvedAt
                                                ? new Date(c.resolvedAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'medium' })
                                                : '—'}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}

                {filtered.length > PAGE_SIZE && (
                    <div className="flex items-center justify-between mt-4 pt-3 border-t">
                        <div className="text-xs text-muted-foreground">
                            {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} de {filtered.length}
                        </div>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={safePage === 1}
                            >
                                <ChevronLeft className="h-3.5 w-3.5" />
                            </Button>
                            <span className="text-xs px-2">{safePage} / {totalPages}</span>
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                disabled={safePage === totalPages}
                            >
                                <ChevronRight className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

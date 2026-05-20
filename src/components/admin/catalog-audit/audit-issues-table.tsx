'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { AuditIssue, AuditSeverity } from '@/actions/admin/get-catalog-audit.action';

interface Props {
    issues: AuditIssue[];
    issueTypes: string[];
}

const PAGE_SIZE = 50;

const SEVERITY_STYLE: Record<AuditSeverity, string> = {
    error: 'bg-red-500/10 text-red-600 dark:text-red-400',
    warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    info: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
};

const SOURCE_STYLE: Record<string, string> = {
    json: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
    firestore: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
};

export function AuditIssuesTable({ issues, issueTypes }: Props) {
    const [search, setSearch] = useState('');
    const [severityFilter, setSeverityFilter] = useState<Set<AuditSeverity>>(
        new Set(['error', 'warning', 'info']),
    );
    const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set(issueTypes));
    const [sourceFilter, setSourceFilter] = useState<'all' | 'firestore-only' | 'json-only' | 'both'>('all');
    const [page, setPage] = useState(0);

    const filtered = useMemo(() => {
        const s = search.trim().toLowerCase();
        return issues.filter(it => {
            if (!severityFilter.has(it.severity)) return false;
            if (!typeFilter.has(it.issue_type)) return false;
            if (sourceFilter !== 'all') {
                const inFs = it.sources.includes('firestore');
                const inJson = it.sources.includes('json');
                if (sourceFilter === 'firestore-only' && !(inFs && !inJson)) return false;
                if (sourceFilter === 'json-only' && !(inJson && !inFs)) return false;
                if (sourceFilter === 'both' && !(inJson && inFs)) return false;
            }
            if (s) {
                const haystack = (it.code + ' ' + it.description + ' ' + it.current_value + ' ' + it.suggested_fix).toLowerCase();
                if (!haystack.includes(s)) return false;
            }
            return true;
        });
    }, [issues, search, severityFilter, typeFilter, sourceFilter]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages - 1);
    const view = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

    function toggleSet<T>(set: Set<T>, value: T): Set<T> {
        const copy = new Set(set);
        if (copy.has(value)) copy.delete(value);
        else copy.add(value);
        return copy;
    }

    return (
        <Card>
            <CardContent className="p-4 space-y-4">
                {/* Filters */}
                <div className="flex flex-wrap items-center gap-3">
                    <Input
                        placeholder="Buscar por código / descripción / suggested_fix…"
                        value={search}
                        onChange={e => { setSearch(e.target.value); setPage(0); }}
                        className="max-w-sm"
                    />

                    <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground mr-1">Severidad:</span>
                        {(['error', 'warning', 'info'] as AuditSeverity[]).map(sev => {
                            const active = severityFilter.has(sev);
                            return (
                                <button
                                    key={sev}
                                    onClick={() => { setSeverityFilter(toggleSet(severityFilter, sev)); setPage(0); }}
                                    className={`px-2 py-0.5 rounded text-xs border ${active ? SEVERITY_STYLE[sev] + ' border-current' : 'text-muted-foreground border-muted'}`}
                                >
                                    {sev}
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground mr-1">Origen:</span>
                        {(['all', 'firestore-only', 'json-only', 'both'] as const).map(src => (
                            <button
                                key={src}
                                onClick={() => { setSourceFilter(src); setPage(0); }}
                                className={`px-2 py-0.5 rounded text-xs border ${sourceFilter === src ? 'bg-primary/10 text-primary border-primary' : 'text-muted-foreground border-muted'}`}
                            >
                                {src === 'all' ? 'todos' : src.replace('-', ' ')}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                    <span className="text-xs text-muted-foreground mr-1">Tipo:</span>
                    {issueTypes.map(t => {
                        const active = typeFilter.has(t);
                        return (
                            <button
                                key={t}
                                onClick={() => { setTypeFilter(toggleSet(typeFilter, t)); setPage(0); }}
                                className={`px-2 py-0.5 rounded text-xs border ${active ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700' : 'text-muted-foreground border-muted line-through opacity-60'}`}
                            >
                                {t}
                            </button>
                        );
                    })}
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[140px]">Tipo</TableHead>
                                <TableHead className="w-[80px]">Severidad</TableHead>
                                <TableHead className="w-[110px]">Código</TableHead>
                                <TableHead>Descripción</TableHead>
                                <TableHead className="w-[280px]">Valor actual</TableHead>
                                <TableHead className="w-[280px]">Sugerencia</TableHead>
                                <TableHead className="w-[110px]">Origen</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {view.map((it, idx) => (
                                <TableRow key={`${it.issue_type}-${it.code}-${idx}`}>
                                    <TableCell className="text-xs">
                                        <code className="bg-muted px-1 py-0.5 rounded">{it.issue_type}</code>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="secondary" className={SEVERITY_STYLE[it.severity]}>
                                            {it.severity}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-xs font-mono">{it.code || '—'}</TableCell>
                                    <TableCell className="text-xs max-w-md truncate" title={it.description}>
                                        {it.description || '—'}
                                    </TableCell>
                                    <TableCell className="text-xs max-w-xs truncate" title={it.current_value}>
                                        {it.current_value || '—'}
                                    </TableCell>
                                    <TableCell className="text-xs max-w-xs truncate" title={it.suggested_fix}>
                                        {it.suggested_fix || '—'}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex gap-1 flex-wrap">
                                            {it.sources.map(s => (
                                                <Badge key={s} variant="secondary" className={`text-[10px] ${SOURCE_STYLE[s]}`}>
                                                    {s}
                                                </Badge>
                                            ))}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {view.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground text-sm">
                                        Sin issues que coincidan con los filtros.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div>
                        Mostrando {view.length === 0 ? 0 : safePage * PAGE_SIZE + 1}–{safePage * PAGE_SIZE + view.length} de {filtered.length} (filtrados) · {issues.length} totales
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                            Anterior
                        </Button>
                        <span>Página {safePage + 1} de {totalPages}</span>
                        <Button variant="outline" size="sm" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>
                            Siguiente
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

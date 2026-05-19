'use client';

/**
 * Admin pipeline-jobs table with filters, search, sorting, pagination and
 * per-row admin actions (Cancel / Retry / Force-fail).
 *
 * Server side already returns up to 200 summaries. We do filtering and
 * sorting in the browser so the admin gets snappy interactions without
 * needing Firestore composite indexes for every column.
 */

import { useEffect, useMemo, useState, useTransition } from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuLabel,
    DropdownMenuCheckboxItem,
    DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    Search,
    Filter,
    MoreHorizontal,
    XCircle,
    RefreshCw,
    AlertTriangle,
    Loader2,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    ArrowUpDown,
    CheckCircle2,
    AlertCircle,
    ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { sileo } from 'sileo';

import type {
    PipelineJobSummary,
    JobStatus,
    JobSource,
} from '@/actions/admin/get-pipeline-jobs.action';
import { adminCancelPipelineJobAction } from '@/actions/admin/cancel-pipeline-job.action';
import { adminRetryPipelineJobAction } from '@/actions/admin/retry-pipeline-job.action';
import { adminForceFailPipelineJobAction } from '@/actions/admin/force-fail-pipeline-job.action';

type SortKey = 'createdAt' | 'duration' | 'partidas';

const PAGE_SIZE = 25;

const STATUS_OPTIONS: { value: JobStatus; label: string }[] = [
    { value: 'completed', label: 'Completados' },
    { value: 'failed', label: 'Fallidos' },
    { value: 'canceled', label: 'Cancelados' },
    { value: 'in_progress', label: 'En curso' },
    { value: 'queued', label: 'En cola' },
    { value: 'running', label: 'Ejecutando' },
];

const SOURCE_OPTIONS: { value: JobSource; label: string }[] = [
    { value: 'pdf', label: 'PDF / mediciones' },
    { value: 'nl', label: 'Lenguaje natural' },
    { value: 'unknown', label: 'Desconocido' },
];

function statusBadge(status: JobStatus, cancellationRequested?: boolean) {
    if (status === 'completed') {
        return (
            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Completado
            </Badge>
        );
    }
    if (status === 'failed') {
        return (
            <Badge className="bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30 gap-1">
                <AlertCircle className="h-3 w-3" />
                Fallido
            </Badge>
        );
    }
    if (status === 'canceled') {
        return (
            <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/30 gap-1">
                <XCircle className="h-3 w-3" />
                Cancelado
            </Badge>
        );
    }
    if (status === 'queued') {
        return (
            <Badge className="bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border border-zinc-500/30 gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                En cola
            </Badge>
        );
    }
    return (
        <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30 gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {cancellationRequested ? 'Cancelando…' : 'En curso'}
        </Badge>
    );
}

function sourceBadge(source: JobSource) {
    const cfg: Record<JobSource, { label: string; className: string }> = {
        pdf: { label: 'PDF', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30' },
        nl: { label: 'NL', className: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30' },
        unknown: { label: '—', className: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border border-zinc-500/30' },
    };
    const c = cfg[source];
    return <Badge variant="outline" className={`gap-1 ${c.className}`}>{c.label}</Badge>;
}

function formatDuration(ms: number): string {
    if (ms <= 0) return '—';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

export interface JobsTableProps {
    jobs: PipelineJobSummary[];
    /** Optional callback parent uses to refresh data after admin actions
     *  (e.g. router.refresh()). */
    onRefresh?: () => void;
}

export function JobsTable({ jobs, onRefresh }: JobsTableProps) {
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<Set<JobStatus>>(new Set());
    const [sourceFilter, setSourceFilter] = useState<Set<JobSource>>(new Set());
    const [fromDate, setFromDate] = useState<string>('');
    const [toDate, setToDate] = useState<string>('');
    const [sortKey, setSortKey] = useState<SortKey>('createdAt');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [page, setPage] = useState(1);

    const [pendingJobId, setPendingJobId] = useState<string | null>(null);
    const [pendingAction, setPendingAction] = useState<'cancel' | 'retry' | 'force-fail' | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<{
        open: boolean;
        title: string;
        description: string;
        onConfirm: () => void;
    }>({ open: false, title: '', description: '', onConfirm: () => {} });
    const [, startTransition] = useTransition();

    // Reset to page 1 when filters change so the user doesn't end up on an
    // empty page after narrowing the result set.
    useEffect(() => {
        setPage(1);
    }, [search, statusFilter, sourceFilter, fromDate, toDate, sortKey, sortDir]);

    const filtered = useMemo(() => {
        const fromTs = fromDate ? new Date(fromDate).getTime() : undefined;
        const toTs = toDate ? new Date(toDate + 'T23:59:59').getTime() : undefined;
        const needle = search.toLowerCase().trim();

        return jobs.filter(j => {
            if (statusFilter.size > 0) {
                const candidates: JobStatus[] = [j.status];
                if (j.status === 'queued' || j.status === 'running') {
                    candidates.push('in_progress');
                }
                if (!candidates.some(s => statusFilter.has(s))) return false;
            }
            if (sourceFilter.size > 0 && !sourceFilter.has(j.source)) return false;
            const startedTs = new Date(j.startedAt).getTime();
            if (fromTs && startedTs < fromTs) return false;
            if (toTs && startedTs > toTs) return false;
            if (needle) {
                const haystack = `${j.jobId} ${j.leadId || ''} ${j.budgetId || ''} ${j.uid || ''}`.toLowerCase();
                if (!haystack.includes(needle)) return false;
            }
            return true;
        });
    }, [jobs, search, statusFilter, sourceFilter, fromDate, toDate]);

    const sorted = useMemo(() => {
        const sign = sortDir === 'asc' ? 1 : -1;
        return [...filtered].sort((a, b) => {
            if (sortKey === 'createdAt') {
                return (new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()) * sign;
            }
            if (sortKey === 'duration') {
                return ((a.durationMs || 0) - (b.durationMs || 0)) * sign;
            }
            // partidas
            const ap = a.itemCount ?? a.resolvedPartidaCount ?? 0;
            const bp = b.itemCount ?? b.resolvedPartidaCount ?? 0;
            return (ap - bp) * sign;
        });
    }, [filtered, sortKey, sortDir]);

    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const startIdx = (safePage - 1) * PAGE_SIZE;
    const visible = sorted.slice(startIdx, startIdx + PAGE_SIZE);

    const toggleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    };

    const toggleSetItem = <T,>(set: Set<T>, value: T, setter: (next: Set<T>) => void) => {
        const next = new Set(set);
        if (next.has(value)) next.delete(value); else next.add(value);
        setter(next);
    };

    const clearFilters = () => {
        setSearch('');
        setStatusFilter(new Set());
        setSourceFilter(new Set());
        setFromDate('');
        setToDate('');
    };

    const handleCancel = (jobId: string) => {
        setConfirmDialog({
            open: true,
            title: 'Cancelar job',
            description: 'Esto envía señal de cancelación cooperativa al worker. Los checkpoints ya generados se conservan.',
            onConfirm: () => {
                setConfirmDialog(d => ({ ...d, open: false }));
                setPendingJobId(jobId);
                setPendingAction('cancel');
                startTransition(async () => {
                    const res = await adminCancelPipelineJobAction(jobId);
                    setPendingJobId(null);
                    setPendingAction(null);
                    if (res.success) {
                        sileo.success({
                            title: 'Cancelación solicitada',
                            description: `Job ${jobId.slice(0, 8)}… está siendo cancelado.`,
                            duration: 4000,
                        });
                        onRefresh?.();
                    } else {
                        sileo.error({
                            title: 'No se pudo cancelar',
                            description: res.error,
                            duration: 5000,
                        });
                    }
                });
            },
        });
    };

    const handleRetry = (jobId: string) => {
        setConfirmDialog({
            open: true,
            title: 'Reintentar job',
            description: 'Se lanzará una nueva ejecución conservando los checkpoints del intento anterior.',
            onConfirm: () => {
                setConfirmDialog(d => ({ ...d, open: false }));
                setPendingJobId(jobId);
                setPendingAction('retry');
                startTransition(async () => {
                    const res = await adminRetryPipelineJobAction(jobId);
                    setPendingJobId(null);
                    setPendingAction(null);
                    if (res.success) {
                        sileo.success({
                            title: 'Job reencolado',
                            description: `Nueva ejecución arrancada para ${jobId.slice(0, 8)}….`,
                            duration: 4000,
                        });
                        onRefresh?.();
                    } else {
                        sileo.error({
                            title: 'No se pudo reintentar',
                            description: res.error,
                            duration: 5000,
                        });
                    }
                });
            },
        });
    };

    const handleForceFail = (jobId: string) => {
        setConfirmDialog({
            open: true,
            title: 'Force-fail job',
            description: 'OVERRIDE: marca el job como FAILED directamente en Firestore. Úsalo SOLO para limpiar zombis (workers muertos por OOM). No detiene un worker vivo.',
            onConfirm: () => {
                setConfirmDialog(d => ({ ...d, open: false }));
                setPendingJobId(jobId);
                setPendingAction('force-fail');
                startTransition(async () => {
                    const res = await adminForceFailPipelineJobAction(jobId);
                    setPendingJobId(null);
                    setPendingAction(null);
                    if (res.success) {
                        sileo.success({
                            title: 'Job forzado a failed',
                            description: `Previo: ${res.previousStatus}.`,
                            duration: 4000,
                        });
                        onRefresh?.();
                    } else {
                        sileo.error({
                            title: 'No se pudo forzar fallo',
                            description: res.error,
                            duration: 5000,
                        });
                    }
                });
            },
        });
    };

    const activeFilterCount =
        (statusFilter.size > 0 ? 1 : 0) +
        (sourceFilter.size > 0 ? 1 : 0) +
        (fromDate ? 1 : 0) +
        (toDate ? 1 : 0);

    return (
        <div className="space-y-4">
            {/* Toolbar: search + filters */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-3 bg-zinc-50/50 dark:bg-zinc-900/30 rounded-xl border border-zinc-200/50 dark:border-zinc-800/50">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="jobId, leadId, budgetId, uid…"
                        className="pl-9 bg-white dark:bg-zinc-950/50 rounded-lg"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-2">
                            <Filter className="h-4 w-4" />
                            Filtros
                            {activeFilterCount > 0 && (
                                <Badge variant="secondary" className="ml-1 h-5 px-1.5">{activeFilterCount}</Badge>
                            )}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-72">
                        <DropdownMenuLabel>Estado</DropdownMenuLabel>
                        {STATUS_OPTIONS.map(opt => (
                            <DropdownMenuCheckboxItem
                                key={opt.value}
                                checked={statusFilter.has(opt.value)}
                                onCheckedChange={() => toggleSetItem(statusFilter, opt.value, setStatusFilter)}
                            >
                                {opt.label}
                            </DropdownMenuCheckboxItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Fuente</DropdownMenuLabel>
                        {SOURCE_OPTIONS.map(opt => (
                            <DropdownMenuCheckboxItem
                                key={opt.value}
                                checked={sourceFilter.has(opt.value)}
                                onCheckedChange={() => toggleSetItem(sourceFilter, opt.value, setSourceFilter)}
                            >
                                {opt.label}
                            </DropdownMenuCheckboxItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Desde</DropdownMenuLabel>
                        <div className="px-2 pb-2">
                            <input
                                type="date"
                                value={fromDate}
                                onChange={(e) => setFromDate(e.target.value)}
                                className="w-full h-8 rounded-md border bg-background px-2 text-xs"
                            />
                        </div>
                        <DropdownMenuLabel>Hasta</DropdownMenuLabel>
                        <div className="px-2 pb-2">
                            <input
                                type="date"
                                value={toDate}
                                onChange={(e) => setToDate(e.target.value)}
                                className="w-full h-8 rounded-md border bg-background px-2 text-xs"
                            />
                        </div>
                        {activeFilterCount > 0 && (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={clearFilters} className="text-red-600">
                                    Limpiar filtros
                                </DropdownMenuItem>
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>

                <div className="text-xs text-muted-foreground sm:ml-auto">
                    {sorted.length} de {jobs.length} jobs
                </div>
            </div>

            {/* Table */}
            <div className="relative overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
                <Table>
                    <TableHeader className="bg-zinc-50/80 dark:bg-zinc-900/40">
                        <TableRow className="hover:bg-transparent border-zinc-100 dark:border-zinc-800">
                            <TableHead className="font-semibold">Job</TableHead>
                            <TableHead className="font-semibold">Fuente</TableHead>
                            <TableHead className="font-semibold">Estado</TableHead>
                            <TableHead
                                className="font-semibold cursor-pointer select-none"
                                onClick={() => toggleSort('createdAt')}
                            >
                                <div className="flex items-center gap-1">
                                    Inicio <ArrowUpDown className="h-3 w-3" />
                                </div>
                            </TableHead>
                            <TableHead
                                className="font-semibold cursor-pointer select-none"
                                onClick={() => toggleSort('duration')}
                            >
                                <div className="flex items-center gap-1">
                                    Duración <ArrowUpDown className="h-3 w-3" />
                                </div>
                            </TableHead>
                            <TableHead
                                className="font-semibold text-right cursor-pointer select-none"
                                onClick={() => toggleSort('partidas')}
                            >
                                <div className="flex items-center gap-1 justify-end">
                                    Partidas <ArrowUpDown className="h-3 w-3" />
                                </div>
                            </TableHead>
                            <TableHead className="w-[60px]" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {visible.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                                    {sorted.length === 0 && jobs.length > 0
                                        ? 'Ningún job coincide con los filtros.'
                                        : 'No hay jobs registrados.'}
                                </TableCell>
                            </TableRow>
                        ) : (
                            visible.map(job => {
                                const isPending = pendingJobId === job.jobId;
                                const isActive = job.status === 'queued' || job.status === 'running' || job.status === 'in_progress';
                                const isRetryable = job.status === 'failed' || job.status === 'canceled';
                                const partidaCount = job.itemCount ?? job.resolvedPartidaCount ?? 0;
                                return (
                                    <TableRow key={job.jobId} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                                        <TableCell className="font-mono text-xs">
                                            <div className="flex flex-col gap-0.5 min-w-[200px]">
                                                <Link
                                                    href={`/dashboard/admin/jobs/${job.jobId}`}
                                                    className="font-semibold text-foreground hover:text-primary transition-colors"
                                                >
                                                    {job.jobId.slice(0, 8)}…
                                                </Link>
                                                {job.leadId && (
                                                    <span className="text-muted-foreground text-[10px]">
                                                        lead: {job.leadId.slice(0, 8)}…
                                                    </span>
                                                )}
                                                {job.budgetId && (
                                                    <span className="text-muted-foreground text-[10px]">
                                                        budget: {job.budgetId.slice(0, 8)}…
                                                    </span>
                                                )}
                                                {!job.hasCanonicalDoc && (
                                                    <Badge variant="outline" className="w-fit text-[9px] text-amber-700 dark:text-amber-300 border-amber-500/40">
                                                        legacy
                                                    </Badge>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>{sourceBadge(job.source)}</TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                {statusBadge(job.status, job.cancellation_requested)}
                                                {job.lastError && (
                                                    <span className="text-[10px] text-red-600 dark:text-red-400 line-clamp-1 max-w-[200px]" title={job.lastError}>
                                                        {job.lastError}
                                                    </span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col text-xs">
                                                <span className="font-medium">
                                                    {format(new Date(job.startedAt), 'd MMM yyyy', { locale: es })}
                                                </span>
                                                <span className="text-muted-foreground text-[10px]">
                                                    {format(new Date(job.startedAt), 'HH:mm', { locale: es })} · hace {formatDistanceToNow(new Date(job.startedAt), { locale: es })}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {formatDuration(job.durationMs)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-xs">
                                            {partidaCount}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center justify-end gap-1">
                                                <Link href={`/dashboard/admin/jobs/${job.jobId}`}>
                                                    <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Ver detalle">
                                                        <ExternalLink className="h-3.5 w-3.5" />
                                                    </Button>
                                                </Link>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={isPending}>
                                                            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        {isActive && (
                                                            <DropdownMenuItem onClick={() => handleCancel(job.jobId)}>
                                                                <XCircle className="mr-2 h-4 w-4" />
                                                                Cancelar
                                                            </DropdownMenuItem>
                                                        )}
                                                        {isRetryable && (
                                                            <DropdownMenuItem onClick={() => handleRetry(job.jobId)}>
                                                                <RefreshCw className="mr-2 h-4 w-4" />
                                                                Reintentar
                                                            </DropdownMenuItem>
                                                        )}
                                                        {isActive && (
                                                            <>
                                                                <DropdownMenuSeparator />
                                                                <DropdownMenuItem
                                                                    onClick={() => handleForceFail(job.jobId)}
                                                                    className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950/30"
                                                                >
                                                                    <AlertTriangle className="mr-2 h-4 w-4" />
                                                                    Force-fail (admin)
                                                                </DropdownMenuItem>
                                                            </>
                                                        )}
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Pagination */}
            {sorted.length > 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-1 py-2">
                    <div className="text-xs text-muted-foreground">
                        {startIdx + 1}–{Math.min(startIdx + PAGE_SIZE, sorted.length)} de {sorted.length}
                    </div>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setPage(1)}
                            disabled={safePage === 1}
                            aria-label="Primera página"
                        >
                            <ChevronsLeft className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={safePage === 1}
                            aria-label="Página anterior"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-xs text-muted-foreground px-3 min-w-[5rem] text-center">
                            Página {safePage} / {totalPages}
                        </span>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={safePage === totalPages}
                            aria-label="Página siguiente"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setPage(totalPages)}
                            disabled={safePage === totalPages}
                            aria-label="Última página"
                        >
                            <ChevronsRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}

            <AlertDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(d => ({ ...d, open }))}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
                        <AlertDialogDescription>{confirmDialog.description}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                confirmDialog.onConfirm();
                            }}
                            className={pendingAction === 'force-fail' ? 'bg-red-600 hover:bg-red-700 text-white' : ''}
                        >
                            Confirmar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

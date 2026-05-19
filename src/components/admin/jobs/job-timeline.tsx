'use client';

/**
 * Collapsible timeline of telemetry events for one pipeline job.
 *
 * Renders the events returned by `getPipelineJobFullDetailAction` with a
 * filter dropdown (one entry per event type seen) and pagination by 50
 * events per page so the DOM stays light even on multi-thousand-event
 * jobs.
 */

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
    DropdownMenuLabel,
    DropdownMenuCheckboxItem,
    DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
    ChevronDown,
    ChevronRight,
    Filter,
    Clock,
    ChevronLeft,
    ChevronRight as ChevronRightIcon,
} from 'lucide-react';
import { format } from 'date-fns';
import type { PipelineEventRow } from '@/actions/admin/get-pipeline-jobs.action';

const PAGE_SIZE = 50;

const EVENT_COLOR_BY_KEYWORD: Array<[RegExp, string]> = [
    [/error|failed|fail/i, 'border-l-red-500 bg-red-50 dark:bg-red-950/20'],
    [/completed|success|done/i, 'border-l-emerald-500 bg-emerald-50 dark:bg-emerald-950/20'],
    [/start|begin|init/i, 'border-l-blue-500 bg-blue-50 dark:bg-blue-950/20'],
    [/cancel/i, 'border-l-orange-500 bg-orange-50 dark:bg-orange-950/20'],
    [/warning|warn|stale|timeout/i, 'border-l-amber-500 bg-amber-50 dark:bg-amber-950/20'],
];

function colorForType(type: string): string {
    for (const [rx, cls] of EVENT_COLOR_BY_KEYWORD) {
        if (rx.test(type)) return cls;
    }
    return 'border-l-zinc-400 bg-zinc-50 dark:bg-zinc-900/30';
}

export function JobTimeline({ events }: { events: PipelineEventRow[] }) {
    const [page, setPage] = useState(1);
    const [filter, setFilter] = useState<Set<string>>(new Set());
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const eventTypes = useMemo(() => {
        const map: Record<string, number> = {};
        for (const e of events) map[e.type] = (map[e.type] || 0) + 1;
        return Object.entries(map).sort((a, b) => b[1] - a[1]);
    }, [events]);

    const filtered = useMemo(() => {
        if (filter.size === 0) return events;
        return events.filter(e => filter.has(e.type));
    }, [events, filter]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    const toggleType = (t: string) => {
        const next = new Set(filter);
        if (next.has(t)) next.delete(t); else next.add(t);
        setFilter(next);
        setPage(1);
    };

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
                <div>
                    <CardTitle className="flex items-center gap-2 text-lg">
                        <Clock className="h-5 w-5" />
                        Timeline ({events.length} eventos
                        {filter.size > 0 && `, ${filtered.length} filtrados`})
                    </CardTitle>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-2">
                            <Filter className="h-4 w-4" />
                            Filtrar tipos
                            {filter.size > 0 && (
                                <Badge variant="secondary" className="ml-1 h-5 px-1.5">{filter.size}</Badge>
                            )}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-72 max-h-[60vh] overflow-y-auto">
                        <DropdownMenuLabel>Mostrar solo</DropdownMenuLabel>
                        {eventTypes.length === 0 ? (
                            <div className="px-2 py-1.5 text-xs text-muted-foreground">Sin eventos</div>
                        ) : (
                            eventTypes.map(([type, count]) => (
                                <DropdownMenuCheckboxItem
                                    key={type}
                                    checked={filter.has(type)}
                                    onCheckedChange={() => toggleType(type)}
                                >
                                    <span className="flex items-center justify-between w-full">
                                        <span className="font-mono text-xs">{type}</span>
                                        <span className="text-muted-foreground text-[10px] ml-2">{count}</span>
                                    </span>
                                </DropdownMenuCheckboxItem>
                            ))
                        )}
                        {filter.size > 0 && (
                            <>
                                <DropdownMenuSeparator />
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="w-full justify-start text-red-600"
                                    onClick={() => { setFilter(new Set()); setPage(1); }}
                                >
                                    Limpiar
                                </Button>
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardHeader>
            <CardContent>
                {visible.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                        {events.length === 0
                            ? 'Este job no tiene eventos de telemetría.'
                            : 'Ningún evento coincide con los filtros.'}
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        {visible.map((event, idx) => {
                            const isExpanded = expandedId === event.id;
                            const hasData = event.data && Object.keys(event.data).length > 0;
                            const globalIdx = (safePage - 1) * PAGE_SIZE + idx;
                            return (
                                <div
                                    key={event.id}
                                    className={`border-l-4 rounded-r-md transition-colors ${colorForType(event.type)}`}
                                >
                                    <button
                                        type="button"
                                        onClick={() => hasData && setExpandedId(isExpanded ? null : event.id)}
                                        disabled={!hasData}
                                        className={`w-full flex items-start gap-2 px-3 py-2 text-left ${hasData ? 'cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.02]' : 'cursor-default'}`}
                                    >
                                        <div className="flex-shrink-0 mt-0.5">
                                            {hasData ? (
                                                isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
                                            ) : (
                                                <span className="block w-3.5 h-3.5" />
                                            )}
                                        </div>
                                        <div className="flex-shrink-0 text-[10px] text-muted-foreground font-mono w-12">
                                            #{globalIdx + 1}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-baseline gap-2 flex-wrap">
                                                <span className="font-mono text-xs font-semibold">{event.type}</span>
                                                <span className="text-[10px] text-muted-foreground">
                                                    {format(new Date(event.timestamp), 'HH:mm:ss.SSS')}
                                                </span>
                                            </div>
                                            {hasData && !isExpanded && (
                                                <div className="text-[10px] text-muted-foreground truncate font-mono mt-0.5">
                                                    {previewData(event.data)}
                                                </div>
                                            )}
                                        </div>
                                    </button>
                                    {isExpanded && hasData && (
                                        <div className="px-3 pb-3 pt-1 border-t border-black/5 dark:border-white/5">
                                            <pre className="text-[10px] font-mono whitespace-pre-wrap break-all bg-zinc-900 text-zinc-100 dark:bg-zinc-950 rounded p-2 max-h-64 overflow-auto">
                                                {JSON.stringify(event.data, null, 2)}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {filtered.length > PAGE_SIZE && (
                    <div className="flex items-center justify-between mt-4 pt-3 border-t">
                        <div className="text-xs text-muted-foreground">
                            Mostrando {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} de {filtered.length}
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
                                <ChevronRightIcon className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function previewData(data: any): string {
    if (!data) return '';
    const str = JSON.stringify(data);
    return str.length > 120 ? `${str.slice(0, 120)}…` : str;
}

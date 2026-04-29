'use client';

/**
 * Fase 10.2 — barra de stats agregadas del presupuesto en construcción.
 *
 * Sustituye al `PhaseStepper` cuando hay flujo de PDF (donde ese stepper
 * se queda vacío porque `BudgetRequirement` no se rellena en el path de
 * extracción visual). Aquí mostramos datos agregados vivos: páginas,
 * capítulos, partidas, PEM total y anomalías detectadas.
 *
 * Es un sub-componente sticky que vive bajo el header del chat (mismo slot
 * donde antes vivía el `PhaseStepper`).
 */
import React from 'react';
import { cn } from '@/lib/utils';
import { FileText, Layers3, ListChecks, Wallet, AlertTriangle } from 'lucide-react';
import { computeBudgetStats } from './budget-summary-stats';
import type { SubEvent } from '@/components/budget/budget-generation-events';

interface BudgetSummaryBarProps {
    /** Sub-events acumulados por `BudgetGenerationProgress` (todas las fases). */
    subEvents: SubEvent[];
    /** Total de tareas anunciado por la fase de extracción (preliminar). */
    totalTasks?: number;
    className?: string;
}

export function BudgetSummaryBar({ subEvents, totalTasks, className }: BudgetSummaryBarProps) {
    const stats = computeBudgetStats(subEvents);
    const hasPartidas = stats.partidasCount > 0;
    const tasksLabel = hasPartidas
        ? `${stats.partidasCount}${totalTasks ? ` / ${totalTasks}` : ''}`
        : (totalTasks ? `0 / ${totalTasks}` : '—');

    return (
        <div
            className={cn(
                'w-full max-w-3xl mx-auto rounded-xl border border-slate-200 dark:border-white/10',
                'bg-white/85 dark:bg-white/[0.03] backdrop-blur-sm px-4 py-3',
                className,
            )}
            data-testid="budget-summary-bar"
        >
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <Stat icon={ListChecks} label="Partidas" value={tasksLabel} active={hasPartidas} />
                <Divider />
                <Stat icon={Layers3} label="Capítulos" value={stats.chaptersCount > 0 ? String(stats.chaptersCount) : '—'} active={stats.chaptersCount > 0} />
                <Divider />
                <Stat
                    icon={Wallet}
                    label="PEM"
                    value={stats.pemTotal > 0 ? stats.formattedPem : '—'}
                    active={stats.pemTotal > 0}
                    valueClassName="font-mono tabular-nums"
                />
                {stats.anomaliesCount > 0 && (
                    <>
                        <Divider />
                        <Stat
                            icon={AlertTriangle}
                            label="Revisión"
                            value={String(stats.anomaliesCount)}
                            active
                            tone="warning"
                        />
                    </>
                )}
            </div>
        </div>
    );
}

function Stat({
    icon: Icon,
    label,
    value,
    active,
    valueClassName,
    tone = 'default',
}: {
    icon: any;
    label: string;
    value: string;
    active: boolean;
    valueClassName?: string;
    tone?: 'default' | 'warning';
}) {
    return (
        <div className="flex items-center gap-2 min-w-0">
            <div
                className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors',
                    !active && 'bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-500',
                    active && tone === 'default' && 'bg-primary/10 text-primary',
                    active && tone === 'warning' && 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
                )}
            >
                <Icon className="w-4 h-4" />
            </div>
            <div className="flex flex-col min-w-0">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {label}
                </span>
                <span
                    className={cn(
                        'text-sm font-semibold leading-tight truncate',
                        active ? 'text-slate-800 dark:text-white' : 'text-slate-400 dark:text-slate-500',
                        valueClassName,
                    )}
                >
                    {value}
                </span>
            </div>
        </div>
    );
}

function Divider() {
    return <div className="hidden sm:block h-8 w-px bg-slate-200 dark:bg-white/10" />;
}

'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { BudgetRequirement } from '@/backend/budget/domain/budget-requirements';
import { ClipboardList, Wrench, Scale, ListChecks, CheckCircle2 } from 'lucide-react';

type PhaseKey = 'scope' | 'state' | 'scale' | 'chapters' | 'validation';

const PHASES: Array<{ key: PhaseKey; label: string; icon: any }> = [
    { key: 'scope',      label: 'Alcance',    icon: ClipboardList },
    { key: 'state',      label: 'Estado',     icon: Wrench },
    { key: 'scale',      label: 'Escala',     icon: Scale },
    { key: 'chapters',   label: 'Capítulos',  icon: ListChecks },
    { key: 'validation', label: 'Validación', icon: CheckCircle2 },
];

/**
 * Deriva el estado de cada fase del aparejador a partir de los
 * `updatedRequirements` que el agente va enviando turno a turno.
 */
function deriveStatus(req: Partial<BudgetRequirement>): Record<PhaseKey, 'pending' | 'active' | 'done'> {
    const specs = req.specs || {};
    const extra = req as any;
    const scopeDone = Boolean(specs.propertyType && specs.interventionType);
    const scaleDone = Boolean(extra.projectScale && extra.projectScale !== 'unknown');
    const stateDone = scopeDone && scaleDone; // si ya clasificó escala, implica análisis de estado
    const chapters = extra.phaseChecklist as Record<string, string> | undefined;
    const chaptersDone = Boolean(chapters && Object.keys(chapters).length > 0);
    const allAddressed = chapters
        ? Object.values(chapters).every(v => v === 'addressed' || v === 'not_applicable')
        : false;
    const validationDone = Boolean((req as any).isReadyForGeneration);

    const flags: Record<PhaseKey, boolean> = {
        scope: scopeDone,
        state: stateDone,
        scale: scaleDone,
        chapters: chaptersDone && allAddressed,
        validation: validationDone,
    };

    const status: Record<PhaseKey, 'pending' | 'active' | 'done'> = {
        scope: 'pending',
        state: 'pending',
        scale: 'pending',
        chapters: 'pending',
        validation: 'pending',
    };

    // Una fase está `active` si es la primera no completada
    let foundActive = false;
    for (const p of PHASES) {
        if (flags[p.key]) {
            status[p.key] = 'done';
        } else if (!foundActive) {
            status[p.key] = 'active';
            foundActive = true;
        }
    }
    return status;
}

export function PhaseStepper({ requirements, className }: { requirements: Partial<BudgetRequirement>; className?: string }) {
    const status = deriveStatus(requirements);
    // No mostrar el stepper si el usuario aún no ha dado ningún dato
    const anyStarted = Object.values(status).some(s => s === 'done' || s === 'active');
    if (!anyStarted) return null;

    return (
        <div className={cn(
            'w-full max-w-3xl mx-auto rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/[0.02] backdrop-blur-sm px-4 py-3',
            className,
        )}>
            <ol className="flex items-center justify-between gap-1">
                {PHASES.map((p, idx) => {
                    const s = status[p.key];
                    const Icon = s === 'done' ? CheckCircle2 : p.icon;
                    const isLast = idx === PHASES.length - 1;
                    return (
                        <li key={p.key} className="flex items-center flex-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                                <div className={cn(
                                    'w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-colors',
                                    s === 'done' && 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
                                    s === 'active' && 'bg-primary/10 text-primary ring-2 ring-primary/30',
                                    s === 'pending' && 'bg-slate-100 text-slate-400 dark:bg-white/5 dark:text-slate-500',
                                )}>
                                    <Icon className="w-3.5 h-3.5" />
                                </div>
                                <span className={cn(
                                    'text-xs font-medium truncate hidden sm:inline',
                                    s === 'done' && 'text-slate-700 dark:text-slate-200',
                                    s === 'active' && 'text-primary',
                                    s === 'pending' && 'text-slate-400 dark:text-slate-500',
                                )}>
                                    {p.label}
                                </span>
                            </div>
                            {!isLast && (
                                <div className={cn(
                                    'flex-1 h-px mx-2 transition-colors',
                                    s === 'done' ? 'bg-emerald-300 dark:bg-emerald-700/50' : 'bg-slate-200 dark:bg-white/10',
                                )} />
                            )}
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}

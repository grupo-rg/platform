'use client';

import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    CheckCircle2,
    Loader2,
    Sparkles,
    Search,
    Hammer,
    Scale,
    FileText,
    ChevronDown,
    AlertCircle,
    Package,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    eventToPhase,
    buildSubEvent,
    type PhaseId,
    type SubEvent,
} from './budget-generation-events';

// Re-export contract functions for anything still importing from here.
export { eventToPhase, buildSubEvent } from './budget-generation-events';

export type GenerationStep =
    | 'idle'
    | 'extracting'
    | 'searching'
    | 'calculating'
    | 'complete'
    | 'error';

interface GenerationProgress {
    step: GenerationStep;
    extractedItems?: number;
    matchedItems?: number;
    currentItem?: string;
    error?: string;
}

interface BudgetGenerationProgressProps {
    progress: GenerationProgress;
    className?: string;
    onComplete?: (budgetId: string) => void;
    budgetId?: string;
    /** Fase 10.2 — bubble up al padre los subEvents agregados, para que un
     *  componente externo (p.ej. `BudgetSummaryBar`) los use. */
    onSubEventsChange?: (allSubEvents: SubEvent[]) => void;
}

const PHASE_META: Record<PhaseId, { label: string; icon: any; accent: string }> = {
    extracting:  { label: 'Análisis del proyecto',  icon: FileText, accent: 'text-blue-500'    },
    searching:   { label: 'Búsqueda de precios',    icon: Search,   accent: 'text-amber-500'   },
    calculating: { label: 'Consolidación',          icon: Scale,    accent: 'text-purple-500'  },
    complete:    { label: 'Presupuesto generado',   icon: CheckCircle2, accent: 'text-emerald-500' },
};

const PHASE_ORDER: PhaseId[] = ['extracting', 'searching', 'calculating', 'complete'];

type PhaseState = {
    id: PhaseId;
    status: 'pending' | 'active' | 'done' | 'error';
    startedAt?: number;
    completedAt?: number;
    subEvents: SubEvent[];
    // métricas acumuladas para el resumen de la fase
    totalTasks?: number;
    resolvedCount?: number;
};

type TimelineState = {
    phases: Record<PhaseId, PhaseState>;
    activePhase: PhaseId | null;
    startedAt: number;
    errorMessage?: string;
};

const initialState = (): TimelineState => ({
    phases: {
        extracting:  { id: 'extracting',  status: 'pending', subEvents: [] },
        searching:   { id: 'searching',   status: 'pending', subEvents: [] },
        calculating: { id: 'calculating', status: 'pending', subEvents: [] },
        complete:    { id: 'complete',    status: 'pending', subEvents: [] },
    },
    activePhase: null,
    startedAt: Date.now(),
});

type Action =
    | { type: 'ENTER_PHASE'; phase: PhaseId; ts: number }
    | { type: 'ADD_SUB'; phase: PhaseId; sub: SubEvent }
    | { type: 'SET_TOTAL_TASKS'; phase: PhaseId; total: number }
    | { type: 'FINISH'; ts: number }
    | { type: 'FAIL'; message: string; ts: number };

function reducer(state: TimelineState, action: Action): TimelineState {
    switch (action.type) {
        case 'ENTER_PHASE': {
            if (state.activePhase === action.phase) return state;
            const phases = { ...state.phases };
            // cerrar fases previas
            for (const p of PHASE_ORDER) {
                if (p === action.phase) break;
                if (phases[p].status === 'active' || phases[p].status === 'pending') {
                    phases[p] = { ...phases[p], status: 'done', completedAt: action.ts };
                }
            }
            phases[action.phase] = { ...phases[action.phase], status: 'active', startedAt: action.ts };
            return { ...state, phases, activePhase: action.phase };
        }
        case 'ADD_SUB': {
            const phase = state.phases[action.phase];
            const resolvedCount = action.sub.kind === 'resolved'
                ? (phase.resolvedCount ?? 0) + 1
                : phase.resolvedCount;
            // mantener últimos 50 sub-eventos por fase
            const subEvents = [...phase.subEvents, action.sub].slice(-50);
            return {
                ...state,
                phases: {
                    ...state.phases,
                    [action.phase]: { ...phase, subEvents, resolvedCount },
                },
            };
        }
        case 'SET_TOTAL_TASKS':
            return {
                ...state,
                phases: {
                    ...state.phases,
                    [action.phase]: { ...state.phases[action.phase], totalTasks: action.total },
                },
            };
        case 'FINISH': {
            const phases = { ...state.phases };
            for (const p of PHASE_ORDER) {
                if (phases[p].status === 'active' || phases[p].status === 'pending') {
                    phases[p] = { ...phases[p], status: 'done', completedAt: action.ts };
                }
            }
            phases.complete = { ...phases.complete, status: 'done', completedAt: action.ts };
            return { ...state, phases, activePhase: null };
        }
        case 'FAIL': {
            const active = state.activePhase;
            if (!active) return { ...state, errorMessage: action.message };
            return {
                ...state,
                phases: {
                    ...state.phases,
                    [active]: { ...state.phases[active], status: 'error', completedAt: action.ts },
                },
                errorMessage: action.message,
            };
        }
        default:
            return state;
    }
}


function useElapsedSince(startedAt: number, running: boolean): string {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!running) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [running]);
    const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    return `${mm}:${ss}`;
}

export function BudgetGenerationProgress({ progress, className, onComplete, budgetId, onSubEventsChange }: BudgetGenerationProgressProps) {
    const telemetryId = budgetId;
    const { step, extractedItems, error } = progress;

    const [state, dispatch] = useReducer(reducer, undefined, initialState);
    const eventSourceRef = useRef<EventSource | null>(null);
    const processedEvents = useRef<Set<string | number>>(new Set());
    const onCompleteRef = useRef(onComplete);
    onCompleteRef.current = onComplete;
    const onSubEventsChangeRef = useRef(onSubEventsChange);
    onSubEventsChangeRef.current = onSubEventsChange;

    // Fase 10.2 — emite el conjunto plano de subEvents al padre cada vez que
    // el estado cambia. Permite a `BudgetSummaryBar` calcular stats agregadas.
    useEffect(() => {
        if (!onSubEventsChangeRef.current) return;
        const allSubs: SubEvent[] = [];
        for (const phaseId of PHASE_ORDER) {
            allSubs.push(...state.phases[phaseId].subEvents);
        }
        onSubEventsChangeRef.current(allSubs);
    }, [state]);

    // Derivar fase desde el prop `step` si no hay stream (p.ej. PDF fast-track)
    useEffect(() => {
        if (step === 'idle') return;
        if (step === 'extracting') dispatch({ type: 'ENTER_PHASE', phase: 'extracting', ts: Date.now() });
        else if (step === 'searching') dispatch({ type: 'ENTER_PHASE', phase: 'searching', ts: Date.now() });
        else if (step === 'calculating') dispatch({ type: 'ENTER_PHASE', phase: 'calculating', ts: Date.now() });
        else if (step === 'complete') dispatch({ type: 'FINISH', ts: Date.now() });
        else if (step === 'error') dispatch({ type: 'FAIL', message: error || 'Error desconocido', ts: Date.now() });
    }, [step, error]);

    useEffect(() => {
        if (typeof extractedItems === 'number') {
            dispatch({ type: 'SET_TOTAL_TASKS', phase: 'searching', total: extractedItems });
        }
    }, [extractedItems]);

    // Stream Firestore → eventos
    useEffect(() => {
        if (!telemetryId || step === 'idle' || step === 'complete' || step === 'error') return;

        if (eventSourceRef.current) eventSourceRef.current.close();
        const url = `/api/budget/stream?budgetId=${telemetryId}`;
        const es = new EventSource(url);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
            try {
                const parsed = JSON.parse(event.data);
                const uniqueKey = parsed.id || parsed.timestamp;
                if (processedEvents.current.has(uniqueKey)) return;
                processedEvents.current.add(uniqueKey);

                const phase = eventToPhase(parsed.type);
                const ts = typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now();

                if (parsed.type === 'subtasks_extracted' && parsed.data?.totalTasks) {
                    dispatch({ type: 'SET_TOTAL_TASKS', phase: 'searching', total: parsed.data.totalTasks });
                }

                if (parsed.type === 'budget_completed') {
                    dispatch({ type: 'FINISH', ts });
                    onCompleteRef.current?.(parsed.data?.budgetId);
                    return;
                }

                if (phase) {
                    dispatch({ type: 'ENTER_PHASE', phase, ts });
                    const sub = buildSubEvent(parsed, uniqueKey, ts);
                    if (sub) dispatch({ type: 'ADD_SUB', phase, sub });
                }
            } catch {
                // heartbeat u otro mensaje no-JSON
            }
        };

        es.onerror = () => {
            // transient — no rompemos la UI, dejamos que navegador reconecte
        };

        return () => {
            if (eventSourceRef.current) eventSourceRef.current.close();
        };
    }, [telemetryId, step]);

    const running = step !== 'idle' && step !== 'complete' && step !== 'error';
    const elapsed = useElapsedSince(state.startedAt, running);

    const { completedCount, progressPct } = useMemo(() => {
        const done = PHASE_ORDER.filter(p => state.phases[p].status === 'done').length;
        const pct = (done / PHASE_ORDER.length) * 100;
        return { completedCount: done, progressPct: pct };
    }, [state.phases]);

    if (step === 'idle') return null;

    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.2 }}
            className={cn(
                // Bubble compacta estilo chat — sin shadow fuerte, sin borde grueso.
                // Queda a la izquierda como cualquier burbuja del bot y no "ocupa" todo.
                'w-full max-w-md rounded-2xl rounded-bl-none bg-white/90 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 overflow-hidden backdrop-blur-sm',
                className
            )}
        >
            {/* Header compacto — una sola línea con icono, título, tiempo y barra ultra fina. */}
            <div className="px-4 pt-3 pb-2.5">
                <div className="flex items-center gap-2">
                    {running ? (
                        <div className="relative shrink-0">
                            <Sparkles className="w-3.5 h-3.5 text-primary" />
                            <span className="absolute inset-0 animate-ping opacity-50">
                                <Sparkles className="w-3.5 h-3.5 text-primary" />
                            </span>
                        </div>
                    ) : step === 'complete' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    ) : step === 'error' ? (
                        <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                    ) : null}
                    <span className="text-[15px] font-medium text-slate-700 dark:text-white/90 flex-1">
                        {step === 'complete'
                            ? 'Presupuesto generado'
                            : step === 'error'
                                ? 'Hubo un problema'
                                : 'Generando presupuesto'}
                    </span>
                    <span className="text-[12px] text-slate-400 dark:text-white/40 tabular-nums font-mono shrink-0">
                        {completedCount}/{PHASE_ORDER.length} · {elapsed}
                    </span>
                </div>
                {/* Barra de progreso ultra fina integrada bajo el header. */}
                <div className="h-[3px] w-full rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden mt-2">
                    <motion.div
                        className="h-full bg-primary"
                        initial={{ width: 0 }}
                        animate={{ width: `${progressPct}%` }}
                        transition={{ duration: 0.4, ease: 'easeOut' }}
                    />
                </div>
            </div>

            {/* Fases — separador sutil, sin borders duros. */}
            <div className="px-1 pb-1">
                {PHASE_ORDER.map((phaseId) => (
                    <PhaseRow key={phaseId} phase={state.phases[phaseId]} />
                ))}
            </div>

            {state.errorMessage && (
                <div className="px-4 py-2 bg-red-50/60 dark:bg-red-950/20 border-t border-red-200/50 dark:border-red-900/30">
                    <p className="text-[13px] text-red-700 dark:text-red-300">
                        <AlertCircle className="w-3 h-3 inline mr-1" />
                        {state.errorMessage}
                    </p>
                </div>
            )}
        </motion.div>
    );
}

function PhaseRow({ phase }: { phase: PhaseState }) {
    const meta = PHASE_META[phase.id];
    const Icon = meta.icon;
    const [expanded, setExpanded] = useState(phase.status === 'active');

    // auto-expandir cuando la fase se activa, auto-colapsar cuando termina
    useEffect(() => {
        if (phase.status === 'active') setExpanded(true);
        else if (phase.status === 'done') setExpanded(false);
    }, [phase.status]);

    const summary = buildPhaseSummary(phase);
    const recentSubs = phase.subEvents.slice(-5);
    const extra = Math.max(0, phase.subEvents.length - recentSubs.length);

    const isPending = phase.status === 'pending';

    return (
        <div
            className={cn(
                'transition-colors rounded-lg',
                phase.status === 'active' && 'bg-primary/5 dark:bg-primary/10',
            )}
        >
            <button
                type="button"
                onClick={() => setExpanded(e => !e)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left group"
                disabled={phase.subEvents.length === 0}
            >
                {/* Icono compacto: 18px, sin caja ocupando espacio. */}
                <div
                    className={cn(
                        'w-4 h-4 flex items-center justify-center shrink-0 transition-colors',
                        phase.status === 'active' && 'text-primary',
                        phase.status === 'done' && 'text-emerald-500 dark:text-emerald-400',
                        phase.status === 'error' && 'text-red-500 dark:text-red-400',
                        isPending && 'text-slate-300 dark:text-white/20',
                    )}
                >
                    {phase.status === 'active' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : phase.status === 'done' ? (
                        <CheckCircle2 className="w-4 h-4" />
                    ) : phase.status === 'error' ? (
                        <AlertCircle className="w-4 h-4" />
                    ) : (
                        <Icon className="w-4 h-4" />
                    )}
                </div>
                <div className="flex-1 min-w-0 flex items-baseline gap-2">
                    <span className={cn(
                        'text-[14px] font-medium',
                        isPending ? 'text-slate-400 dark:text-white/30' : 'text-slate-700 dark:text-white/90',
                    )}>
                        {meta.label}
                    </span>
                    {summary && (
                        <span className="text-[13px] text-slate-400 dark:text-white/40 truncate">
                            · {summary}
                        </span>
                    )}
                </div>
                {phase.subEvents.length > 0 && (
                    <ChevronDown
                        className={cn(
                            'w-3 h-3 text-slate-300 dark:text-white/30 shrink-0 transition-transform',
                            expanded && 'rotate-180'
                        )}
                    />
                )}
            </button>

            <AnimatePresence initial={false}>
                {expanded && phase.subEvents.length > 0 && (
                    <motion.ul
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="overflow-hidden pl-8 pr-3 pb-2 space-y-1"
                    >
                        {extra > 0 && (
                            <li className="text-[12px] text-slate-400 dark:text-white/30 italic">
                                …y {extra} anteriores
                            </li>
                        )}
                        <AnimatePresence initial={false}>
                            {recentSubs.map(sub => (
                                <motion.li
                                    key={sub.id}
                                    initial={{ opacity: 0, x: -4 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.15 }}
                                    className="flex items-start gap-1.5"
                                >
                                    <SubEventIcon kind={sub.kind} />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[13px] text-slate-600 dark:text-white/70 truncate">
                                            {sub.title}
                                        </p>
                                        {sub.detail && (
                                            <p className="text-[12px] text-slate-400 dark:text-white/40 truncate">
                                                {sub.detail}
                                            </p>
                                        )}
                                    </div>
                                </motion.li>
                            ))}
                        </AnimatePresence>
                    </motion.ul>
                )}
            </AnimatePresence>
        </div>
    );
}

function SubEventIcon({ kind }: { kind: SubEvent['kind'] }) {
    const cls = 'w-3.5 h-3.5 mt-[2px] shrink-0';
    if (kind === 'resolved') return <CheckCircle2 className={cn(cls, 'text-emerald-500')} />;
    if (kind === 'search')   return <Search        className={cn(cls, 'text-amber-500')} />;
    if (kind === 'error')    return <AlertCircle   className={cn(cls, 'text-red-500')} />;
    return <Package className={cn(cls, 'text-slate-400')} />;
}

function buildPhaseSummary(phase: PhaseState): string | null {
    if (phase.status === 'pending') return null;
    if (phase.id === 'extracting') {
        const total = phase.subEvents.find(s => s.title.includes('tareas identificadas'));
        return total ? total.title : (phase.status === 'active' ? 'Analizando…' : 'Análisis completado');
    }
    if (phase.id === 'searching') {
        const searches = phase.subEvents.filter(s => s.kind === 'search').length;
        if (phase.totalTasks) return `${searches} consultas · ${phase.totalTasks} tareas`;
        return searches > 0 ? `${searches} consultas` : (phase.status === 'active' ? 'Buscando precios…' : 'Precios obtenidos');
    }
    if (phase.id === 'calculating') {
        const resolved = phase.resolvedCount ?? 0;
        if (phase.status === 'active') return `${resolved} partidas resueltas`;
        return `${resolved} partidas consolidadas`;
    }
    if (phase.id === 'complete') {
        return phase.status === 'done' ? 'Listo para revisar' : null;
    }
    return null;
}

'use client';

import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Terminal, Database, Scale, CheckCircle2, Loader2, Sparkles, ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import { useWidgetContext } from '@/context/budget-widget-context';

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
}

const AGENT_NODES = [
    { id: 'extracting', name: 'Arquitecto IA', role: 'Deconstrucción Semántica', icon: Terminal, color: 'text-blue-400' },
    { id: 'searching', name: 'Aparejador RAG', role: 'Vector Search 2025', icon: Database, color: 'text-emerald-400' },
    { id: 'calculating', name: 'Juez Cognitivo', role: 'Consolidación de Precios', icon: Scale, color: 'text-purple-400' },
    { id: 'complete', name: 'Sistema', role: 'Finalizado', icon: CheckCircle2, color: 'text-zinc-400' },
];

function getStepIndex(step: GenerationStep): number {
    const idx = AGENT_NODES.findIndex(s => s.id === step);
    return idx === -1 ? 0 : idx;
}

export function BudgetGenerationProgress({ progress, className, onComplete, budgetId }: BudgetGenerationProgressProps) {
    const t = useTranslations('budgetRequest.demoProgress');
    const telemetryId = budgetId;
    const { step, extractedItems, matchedItems, currentItem, error } = progress;
    const currentStepIndex = getStepIndex(step);

    // Track recently resolved items for inline display (Logs)
    const [terminalLogs, setTerminalLogs] = useState<{ id: string, text: string, type: string, timestamp: string }[]>([]);
    const [localExtractedItems, setLocalExtractedItems] = useState(extractedItems || 0);
    const [localResolvedCount, setLocalResolvedCount] = useState(0);
    const [localStep, setLocalStep] = useState<GenerationStep>(step);

    // Auto-update local state initially
    useEffect(() => {
        setLocalStep(step);
        if (step === 'idle' || step === 'extracting') setLocalResolvedCount(0);
    }, [step]);

    const activeStep = localStep;
    const activeStepIndex = getStepIndex(activeStep);

    const eventSourceRef = useRef<EventSource | null>(null);
    const processedEvents = useRef<Set<string | number>>(new Set());
    const logEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll logs
    useEffect(() => {
        if (logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [terminalLogs]);


    // Fake terminal strings for UI flavor based on generic progress if real stream fails/delays
    useEffect(() => {
        if (step === 'extracting') {
            addLog('[Arquitecto] Analizando requisitos estructurales...', 'system');
            addLog(`[Arquitecto] Estimando ${extractedItems || 0} capítulos base...`, 'info');
        } else if (step === 'searching') {
            addLog(`[Aparejador] Conectando a VectorDB [price_book_2025]...`, 'system');
            if (currentItem) addLog(`[Aparejador] Expandiendo query: "${currentItem}"`, 'warning');
        } else if (step === 'calculating') {
            addLog(`[Juez] Verificando mermas y rendimientos...`, 'system');
        } else if (step === 'complete') {
            addLog(`[Sistema] Presupuesto compilado con éxito.`, 'success');
        }
    }, [step, extractedItems, currentItem]);

    const addLog = (text: string, type: 'info' | 'system' | 'success' | 'warning' | 'error' = 'info') => {
        const now = new Date();
        const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;

        setTerminalLogs(prev => {
            const newLog = { id: Math.random().toString(36).substr(2, 9), text, type, timestamp: time };
            return [...prev, newLog].slice(-15); // Keep last 15
        });
    };

    useEffect(() => {
        if (!telemetryId || step === 'idle' || step === 'complete' || step === 'error') return;

        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }

        const url = `/api/budget/stream?budgetId=${telemetryId}`;
        const es = new EventSource(url);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
            try {
                const parsed = JSON.parse(event.data);
                const uniqueKey = parsed.id || parsed.timestamp;
                if (processedEvents.current.has(uniqueKey)) return;
                processedEvents.current.add(uniqueKey);

                if (parsed.type === 'subtasks_extracted') {
                    if (parsed.data.totalTasks) setLocalExtractedItems(parsed.data.totalTasks);
                    setLocalStep('searching');
                } else if (parsed.type === 'item_resolved') {
                    setLocalStep('calculating');
                    setLocalResolvedCount(prev => prev + 1);

                    const item = parsed.data.item;
                    const price = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(item.totalPrice || 0);
                    const agentPrefix = parsed.data.type === 'MATERIAL' ? '[Aparejador]' : '[Juez]';
                    addLog(`${agentPrefix} Resolved: [${item.code || item.code}] ${item.description?.substring(0, 40) || ''}... -> ${price}`, 'success');
                } else if (parsed.type === 'vector_search' || parsed.type === 'restructuring' || parsed.type === 'vector_search_started' || parsed.type === 'batch_pricing_submitted' || parsed.type === 'extraction_started' || parsed.type === 'batch_restructure_submitted') {
                    if (parsed.type.includes('vector') || parsed.type.includes('pricing')) {
                        setLocalStep('searching');
                        addLog(`[Aparejador] ${parsed.data.query}`, 'system');
                    } else {
                        setLocalStep('extracting');
                        addLog(`[Arquitecto] ${parsed.data.query}`, 'system');
                    }
                } else if (parsed.type === 'budget_completed') {
                    setLocalStep('complete');
                    addLog(`[Sistema] Presupuesto finalizado con éxito. Redirigiendo...`, 'success');
                    if (onComplete) {
                        onComplete(parsed.data.budgetId);
                    }
                }
            } catch (e) {
                // Ignore parse errors from heartbeats
            }
        };

        return () => {
            if (eventSourceRef.current) eventSourceRef.current.close();
        };
    }, [telemetryId, step]);

    if (step === 'idle') return null;

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={cn(
                "w-full flex-1 rounded-2xl bg-[#0A0A0A] border border-white/10 overflow-hidden shadow-2xl flex flex-col font-mono",
                className
            )}
        >
            {/* Header: Terminal Style */}
            <div className="flex items-center justify-between px-4 py-2 bg-white/[0.03] border-b border-white/5 shrink-0">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
                    <span className="text-[10px] text-white/50 tracking-widest uppercase">Basis Core Pipeline</span>
                </div>
                <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/50" />
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500/20 border border-amber-500/50" />
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500/20 border border-green-500/50" />
                </div>
            </div>

            {/* Agent Nodes (Timeline) */}
            <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-white/5 bg-zinc-950/50">
                {AGENT_NODES.map((node, idx) => {
                    const Icon = node.icon;
                    const isActive = node.id === activeStep;
                    const isComplete = idx < activeStepIndex || activeStep === 'complete';

                    return (
                        <div key={node.id} className={cn(
                            "flex-1 p-2 md:p-3 flex flex-row md:flex-col items-center md:items-start gap-2 md:gap-3 transition-all duration-500 relative overflow-hidden",
                            isActive ? "bg-white/[0.02]" : "opacity-40 grayscale"
                        )}>
                            {isActive && node.id !== 'complete' && (
                                <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-primary to-transparent animate-pulse" />
                            )}
                            <div className={cn(
                                "flex items-center justify-center w-6 h-6 md:w-8 md:h-8 rounded-lg border",
                                isActive ? `bg-white/5 border-white/20 ${node.color}` : "bg-transparent border-white/10 text-white/40",
                                isComplete && 'border-green-500/30 text-green-500 bg-green-500/5'
                            )}>
                                {isActive && node.id !== 'complete' ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : isComplete ? (
                                    <CheckCircle2 className="w-4 h-4" />
                                ) : (
                                    <Icon className="w-4 h-4" />
                                )}
                            </div>
                            <div className="flex flex-col">
                                <span className={cn(
                                    "text-xs font-semibold uppercase tracking-wider",
                                    isActive ? "text-white" : "text-white/40"
                                )}>
                                    {node.name}
                                </span>
                                <span className="text-[10px] text-white/30 truncate max-w-[120px]">
                                    {node.role}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Telemetry Stream (Logs) */}
            <div className="bg-black/80 flex-1 min-h-[300px] p-4 overflow-y-auto custom-scrollbar relative flex flex-col">
                <div className="space-y-1.5 flex-1">
                    <AnimatePresence initial={false}>
                        {terminalLogs.map((log) => (
                            <motion.div
                                key={log.id}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="flex items-start gap-3 group"
                            >
                                <span className="text-[10px] text-zinc-600 shrink-0 select-none">
                                    [{log.timestamp}]
                                </span>
                                <ChevronRight className="w-3 h-3 text-zinc-700 shrink-0 mt-[1px] group-hover:text-primary transition-colors" />
                                <span className={cn(
                                    "text-[11px] leading-relaxed break-all font-mono",
                                    log.type === 'info' && "text-zinc-300",
                                    log.type === 'system' && "text-blue-400",
                                    log.type === 'success' && "text-emerald-400",
                                    log.type === 'warning' && "text-amber-400",
                                    log.type === 'error' && "text-red-400"
                                )}>
                                    {log.text}
                                </span>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                    <div ref={logEndRef} className="h-4" />
                </div>

                <div ref={logEndRef} className="h-4 shrink-0" />

                {isActiveStreaming(activeStep) && (
                    <div className="sticky bottom-0 left-0 w-full flex items-center gap-2 p-2 bg-zinc-900 border border-white/10 shadow-xl rounded-lg mt-2 shrink-0 overflow-hidden">
                        <div className="w-2.5 h-2.5 bg-primary rounded-full animate-pulse shadow-[0_0_8px_rgba(var(--primary),0.8)]" />
                        <span className="text-[11px] font-bold text-white uppercase tracking-[0.15em]">
                            {localExtractedItems ? `PROCESANDO ${localResolvedCount || 0}/${localExtractedItems} VARS` : 'ESCUCHANDO TELEMETRÍA...'}
                        </span>
                    </div>
                )}
            </div>

            {/* Error State */}
            {error && (
                <div className="p-4 bg-red-500/10 border-t border-red-500/20">
                    <div className="flex items-center gap-2 text-red-500">
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        <p className="text-xs font-medium uppercase tracking-wider">Exception: {error}</p>
                    </div>
                </div>
            )}
        </motion.div>
    );
}

function isActiveStreaming(step: GenerationStep) {
    return step === 'extracting' || step === 'searching' || step === 'calculating';
}

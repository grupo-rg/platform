
'use client';

import React, { useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Terminal, Eye, Database, Activity, FileText } from 'lucide-react';
import { IngestionJob } from '@/backend/price-book/domain/ingestion-job';
import { formatCurrency } from '@/lib/utils';

interface IngestionDashboardProps {
    job: IngestionJob;
    onCancel?: () => void;
}

export function IngestionDashboard({ job, onCancel }: IngestionDashboardProps) {
    const logsEndRef = useRef<HTMLDivElement>(null);
    const streamEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll logs
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [job.logs]);

    // Auto-scroll data stream (simulated by lastItem updates)
    useEffect(() => {
        streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [job.currentMeta?.lastItem]);

    const { currentMeta, progress, status, logs = [], totalItems = 0 } = job;
    const currentPage = currentMeta?.pageNumber || 0;
    const totalPages = currentMeta?.totalPages || 0;
    const currentChapter = currentMeta?.currentChapter || 'Initializing...';

    // Derived state for "extracted items" list simulation
    // Since we don't stream the full list in the job object (too big), we might only show the last few or 
    // rely on the logs/meta to populate a local buffer if we wanted a persistent list.
    // For now, let's just show the "Coming Soon" or simulate it if we had a list.
    // Actually, let's allow the parent to pass items or just show the metadata "lastItem" as a highlight.

    // Simplification: We will visualize the "Last Extracted Item" prominently in the stream panel
    // and maybe keep a local history of the last 5 items received via polling if we wanted, 
    // but React state would reset on poll. 
    // Ideally the backend *could* return the last 10 items in `currentMeta`.

    return (
        <div className="space-y-6 w-full max-w-5xl mx-auto">

            {/* 1. Header & Control Panel */}
            <Card className="p-5 bg-white/80 backdrop-blur-md border border-slate-200 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-400 to-orange-600" />

                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
                    <div>
                        <h2 className="text-xl font-bold font-headline flex items-center gap-2">
                            <Activity className="w-5 h-5 text-orange-500" />
                            Ingestión de Precios en Tiempo Real
                        </h2>
                        <p className="text-sm text-slate-500">Conectado al motor neuronal Gemini 2.5 Flash</p>
                    </div>
                    <Badge variant={status === 'processing' ? 'default' : 'secondary'} className="text-xs px-3 py-1 uppercase tracking-wider">
                        {status === 'processing' ? <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Processing</span> : status}
                    </Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
                    <div className="col-span-2 space-y-2">
                        <div className="flex justify-between text-xs font-medium text-slate-600">
                            <span>Progreso Global</span>
                            <span>{progress}%</span>
                        </div>
                        <Progress value={progress} className="h-2 bg-slate-100" indicatorClassName="bg-orange-500" />
                    </div>
                    <div className="flex justify-between items-center bg-slate-50 px-3 py-2 rounded border border-slate-100 text-sm">
                        <span className="text-slate-500">Páginas Procesadas</span>
                        <span className="font-mono font-bold text-slate-800">{currentPage} <span className="text-slate-400">/ {totalPages || '?'}</span></span>
                    </div>
                </div>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[400px]">

                {/* 2. Panel A: Machine Vision (The "Eye") */}
                <Card className="bg-slate-950 text-slate-200 border-slate-800 p-0 overflow-hidden flex flex-col relative shadow-2xl">
                    <div className="p-3 border-b border-slate-800 bg-slate-900/50 flex justify-between items-center text-xs font-mono text-slate-400">
                        <span className="flex items-center gap-2"><Eye className="w-4 h-4 text-green-500" /> VISION_FEED_V1</span>
                        <span className="animate-pulse text-green-500">LIVE</span>
                    </div>

                    <div className="flex-1 relative flex flex-col items-center justify-center p-8 bg-[url('/grid.svg')] bg-center">
                        {/* Scanning Overlay Effect */}
                        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-green-500/5 to-transparent animate-scan" style={{ animationDuration: '3s' }}></div>

                        <div className="z-10 text-center space-y-6 max-w-md">
                            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-500/10 border border-green-500/30 text-green-400 mb-4 animate-pulse">
                                <FileText className="w-10 h-10" />
                            </div>

                            <div className="space-y-1">
                                <h3 className="text-2xl font-mono font-bold text-white tracking-tight">
                                    {status === 'processing' ? `Analizando Página ${currentPage}` : 'En espera...'}
                                </h3>
                                <p className="text-green-400/70 font-mono text-sm">
                                    {currentChapter || "Cargando contexto..."}
                                </p>
                            </div>

                            {/* Decorative Metrics */}
                            <div className="grid grid-cols-2 gap-4 text-xs font-mono text-slate-500 mt-8">
                                <div className="border border-slate-800 p-2 rounded bg-slate-900/50">
                                    LATENCY: <span className="text-green-400">45ms</span>
                                </div>
                                <div className="border border-slate-800 p-2 rounded bg-slate-900/50">
                                    CONFIDENCE: <span className="text-green-400">98.2%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </Card>

                {/* 3. Panel B: Data Stream */}
                <Card className="bg-white border-slate-200 p-0 flex flex-col shadow-sm">
                    <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center text-xs font-semibold uppercase text-slate-500">
                        <span className="flex items-center gap-2"><Database className="w-4 h-4 text-orange-500" /> Extracted Stream</span>
                        <Badge variant="outline" className="bg-white">{totalItems} items</Badge>
                    </div>

                    <ScrollArea className="flex-1 bg-slate-50/30 p-4">
                        <div className="space-y-3">
                            {/* If we have a last item, show it as the "Hero" newly arrived item */}
                            {currentMeta?.lastItem && (
                                <div className="animate-in slide-in-from-top-5 duration-500">
                                    <div className="p-3 bg-white border border-orange-200 rounded-lg shadow-sm border-l-4 border-l-orange-500">
                                        <div className="flex justify-between items-start mb-1">
                                            <Badge variant="outline" className="text-orange-600 border-orange-200 bg-orange-50 text-[10px]">{currentMeta.lastItem.code}</Badge>
                                            <span className="font-mono text-sm font-bold">{formatCurrency(currentMeta.lastItem.price)}</span>
                                        </div>
                                        <p className="text-xs text-slate-600 line-clamp-2">{currentMeta.lastItem.description}</p>
                                    </div>
                                    <div className="text-center py-2 text-[10px] text-slate-400 uppercase tracking-widest font-mono">Previous Items</div>
                                </div>
                            )}

                            {/* Simulated previous items from logs if feasible, or just placeholders/empty state */}
                            {!currentMeta?.lastItem && (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm italic">
                                    <Loader2 className="w-8 h-8 mb-2 opacity-20 animate-spin" />
                                    Esperando datos...
                                </div>
                            )}
                            <div ref={streamEndRef} />
                        </div>
                    </ScrollArea>
                </Card>
            </div>

            {/* 4. Terminal Logs */}
            <div className="bg-slate-950 rounded-lg border border-slate-800 h-48 flex flex-col shadow-inner overflow-hidden font-mono text-xs">
                <div className="flex items-center px-4 py-2 bg-slate-900 border-b border-slate-800 text-slate-400">
                    <Terminal className="w-3 h-3 mr-2" />
                    <span className="uppercase tracking-wider text-[10px]">System Output</span>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-1 text-green-400/80">
                    {logs.map((log, i) => (
                        <div key={i} className="break-words">
                            <span className="text-slate-600 mr-2">[{new Date().toLocaleTimeString()}]</span>
                            <span className={log.includes("Error") ? "text-red-400" : ""}>{log}</span>
                        </div>
                    ))}
                    <div ref={logsEndRef} />
                    <div className="animate-pulse text-green-500">_</div>
                </div>
            </div>

        </div>
    );
}

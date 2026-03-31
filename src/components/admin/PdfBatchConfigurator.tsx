"use client";

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Database, FileJson, Calculator, CheckCircle2, AlertTriangle, Layers, BookOpen, Eye, Activity } from 'lucide-react';
import pdfIndexData from '@/lib/pdf_index_2025.json';

interface Chapter {
    name: string;
    printedPage: number;
    subchapters: { name: string; printedPage: number }[];
}

const chapters = pdfIndexData as Chapter[];

export function PdfBatchConfigurator() {
    const [pageOffset, setPageOffset] = useState<number>(12); // Default based on user screenshot
    const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);
    const [activePdfPage, setActivePdfPage] = useState<number>(1);
    const [excludedPagesInput, setExcludedPagesInput] = useState<string>('');
    const [isGenerating, setIsGenerating] = useState<boolean>(false);

    // Explicit overrides for start and end physical pages per chapter
    const [customRanges, setCustomRanges] = useState<Record<number, { start?: number, end?: number }>>({});

    // Parse excluded pages string like "31, 32, 45-48" into a Set of numbers
    const excludedPages = useMemo(() => {
        const excluded = new Set<number>();
        if (!excludedPagesInput.trim()) return excluded;

        const parts = excludedPagesInput.split(',');
        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;

            if (trimmed.includes('-')) {
                const [startStr, endStr] = trimmed.split('-');
                const start = parseInt(startStr, 10);
                const end = parseInt(endStr, 10);
                if (!isNaN(start) && !isNaN(end) && start <= end) {
                    for (let i = start; i <= end; i++) {
                        excluded.add(i);
                    }
                }
            } else {
                const num = parseInt(trimmed, 10);
                if (!isNaN(num)) {
                    excluded.add(num);
                }
            }
        }
        return excluded;
    }, [excludedPagesInput]);

    const handleToggleSelectAll = () => {
        if (selectedIndexes.length === chapters.length) {
            setSelectedIndexes([]);
        } else {
            setSelectedIndexes(chapters.map((_, i) => i));
        }
    };

    const handleToggleChapter = (index: number) => {
        setSelectedIndexes(prev =>
            prev.includes(index)
                ? prev.filter(i => i !== index)
                : [...prev, index]
        );
    };

    const handleViewChapter = (physicalPage: number, e: React.MouseEvent) => {
        e.stopPropagation();
        setActivePdfPage(physicalPage);
    };

    const handleCustomRangeChange = (index: number, type: 'start' | 'end', val: string) => {
        const num = parseInt(val, 10);
        setCustomRanges(prev => {
            const ranges = { ...prev };
            if (!ranges[index]) ranges[index] = {};

            if (isNaN(num)) {
                delete ranges[index][type];
                if (Object.keys(ranges[index]).length === 0) delete ranges[index];
            } else {
                ranges[index][type] = num;
            }
            return ranges;
        });
    };

    // Calculate details for each chapter dynamically.
    // We use a static offset relative to the printed page so the UI Viewer matches the real PDF.
    // Excluded pages ONLY affect the `validPages` array (what gets sent to Vertex AI), 
    // they DO NOT shift the physical start/end bounds of the chapters.
    const chapterDetails = useMemo(() => {
        return chapters.map((chapter, index) => {
            const startPrinted = chapter.printedPage;

            // Determine how many printed pages this chapter spans.
            // Notice: Adjacent chapters often share a physical boundary page. We overlap them slightly.
            const endPrinted = index < chapters.length - 1
                ? chapters[index + 1].printedPage
                : chapter.printedPage + 20; // fallback for the very last chapter

            const defaultStartPhysical = startPrinted + pageOffset;
            const defaultEndPhysical = endPrinted + pageOffset;

            // Use the custom overrides if the user has provided them, else default
            const startPhysical = customRanges[index]?.start !== undefined ? customRanges[index].start : defaultStartPhysical;
            const endPhysical = customRanges[index]?.end !== undefined ? customRanges[index].end : defaultEndPhysical;

            // Collect valid pages for processing, skipping any exclusions
            let activePagesInChapter = 0;
            const validPages = [];

            for (let p = startPhysical; p <= endPhysical; p++) {
                if (!excludedPages.has(p)) {
                    activePagesInChapter++;
                    validPages.push(p);
                }
            }

            return {
                ...chapter,
                index,
                startPrinted,
                endPrinted,
                startPhysical,
                endPhysical,
                totalPages: activePagesInChapter,
                validPages
            };
        });
    }, [pageOffset, excludedPages, customRanges]);

    // Calculate aggregated totals based on selection
    const totals = useMemo(() => {
        const selectedDetails = chapterDetails.filter(c => selectedIndexes.includes(c.index));
        const totalPages = selectedDetails.reduce((acc, curr) => acc + curr.totalPages, 0);

        // Standard Vertex pricing for Gemini 2.5 Flash
        const estInputTokens = totalPages * 1800;
        const estOutputTokens = totalPages * 1500;

        // Cost in USD (approx EUR) - $0.075 / 1M Input, $0.30 / 1M Output
        const inputCost = (estInputTokens / 1_000_000) * 0.075;
        const outputCost = (estOutputTokens / 1_000_000) * 0.30;
        const totalCostEuros = inputCost + outputCost;

        return {
            totalPages,
            estInputTokens,
            estOutputTokens,
            totalCostEuros
        };
    }, [chapterDetails, selectedIndexes]);

    const handleGenerateJob = async () => {
        const selectedData = chapterDetails.filter(c => selectedIndexes.includes(c.index));

        // Build the payload that the backend will use
        const jobPayload = selectedData.map(c => ({
            name: c.name,
            startPhysical: c.startPhysical,
            endPhysical: c.endPhysical,
            validPages: c.validPages,
            chapterIndex: c.index
        }));

        setIsGenerating(true);
        try {
            const res = await fetch('/api/admin/batch-jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(jobPayload)
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Error al guardar la configuración');
            }

            alert(`✅ ¡Configuración Guardada!\n\nArchivo guardado en:\n${data.configPath}\n\nYa puedes ejecutar el script de Vertex AI desde tu terminal.`);
        } catch (error: any) {
            console.error("Error generating job:", error);
            alert(`❌ Hubo un error al generar la configuración:\n${error.message}`);
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="flex flex-col xl:flex-row gap-6 h-[800px] xl:h-[85vh]">

            {/* Left Pane: Configurator & Selection (Scrollable) */}
            <div className="w-full xl:w-4/12 flex flex-col gap-6 overflow-y-auto pr-2 pb-10 custom-scrollbar">

                {/* Configuration Card */}
                <Card className="shadow-lg border-blue-100 dark:border-blue-900 shrink-0">
                    <div className="bg-blue-50 dark:bg-blue-950/40 p-3 border-b border-blue-100 dark:border-blue-900 flex items-center gap-2">
                        <Database className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        <h2 className="text-sm font-semibold text-blue-900 dark:text-blue-300">Ajuste de Paginación</h2>
                    </div>
                    <CardContent className="p-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <div>
                                    <Label htmlFor="offset" className="text-xs font-semibold mb-1 block uppercase tracking-wider text-zinc-500">
                                        Offset Físico
                                    </Label>
                                    <Input
                                        id="offset"
                                        type="number"
                                        value={pageOffset}
                                        onChange={(e) => setPageOffset(Number(e.target.value))}
                                        className="font-mono bg-zinc-50 dark:bg-zinc-900 border-zinc-200"
                                    />
                                    <p className="text-[11px] text-muted-foreground mt-1 leading-tight">
                                        Diferencia entre pág. impresa y visual. (Ej: +12)
                                    </p>
                                </div>
                                <div>
                                    <Label htmlFor="excluded" className="text-xs font-semibold mb-1 block uppercase tracking-wider text-zinc-500">
                                        Omitir Páginas Físicas (Ad/Tapas)
                                    </Label>
                                    <Input
                                        id="excluded"
                                        type="text"
                                        placeholder="Ej: 31, 32, 45-48"
                                        value={excludedPagesInput}
                                        onChange={(e) => setExcludedPagesInput(e.target.value)}
                                        className="font-mono bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900 focus-visible:ring-amber-500"
                                    />
                                    <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1 leading-tight font-medium">
                                        Las páginas omitidas no se procesarán.
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-col justify-center bg-zinc-50 dark:bg-zinc-900/50 p-3 rounded-lg border border-zinc-100 dark:border-zinc-800">
                                <div className="text-[10px] uppercase font-bold text-zinc-400 mb-1">Mapeo Actual</div>
                                <div className="text-sm font-mono font-medium flex flex-col gap-2">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <span>P. Impresa</span>
                                        <span className="text-blue-500">+ {pageOffset}</span>
                                        <span>=</span>
                                        <span className="text-blue-600 dark:text-blue-400 font-bold">P. Física</span>
                                    </div>
                                    {excludedPages.size > 0 && (
                                        <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-2 p-2 bg-amber-100/50 dark:bg-amber-900/20 rounded border border-amber-200 dark:border-amber-900/50">
                                            Se omitirán <strong>{excludedPages.size}</strong> páginas del total para ahorrar tokens.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Chapter Selection Tree */}
                <Card className="shadow-lg min-h-[400px] flex-1 flex flex-col overflow-hidden border-zinc-200 dark:border-zinc-800">
                    <div className="bg-zinc-50 dark:bg-zinc-900/80 p-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-2">
                            <Layers className="w-4 h-4 text-zinc-500" />
                            <h2 className="text-sm font-semibold">Índice del Libro</h2>
                        </div>
                        <Button variant="ghost" size="sm" onClick={handleToggleSelectAll} className="h-7 text-xs px-2">
                            {selectedIndexes.length === chapters.length ? 'Deseleccionar' : 'Seleccionar Todo'}
                        </Button>
                    </div>

                    <div className="overflow-y-auto flex-1 p-0">
                        <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                            {chapterDetails.map((cap) => {
                                const isSelected = selectedIndexes.includes(cap.index);
                                const isViewing = activePdfPage >= cap.startPhysical && activePdfPage <= cap.endPhysical;

                                return (
                                    <div
                                        key={cap.index}
                                        onClick={() => handleToggleChapter(cap.index)}
                                        className={`
                                            group flex items-center gap-3 p-3 cursor-pointer transition-all
                                            ${isSelected ? 'bg-blue-50/40 dark:bg-blue-900/10' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/30'}
                                            ${isViewing ? 'border-l-4 border-l-blue-500 pl-2' : 'border-l-4 border-l-transparent'}
                                        `}
                                    >
                                        <Checkbox
                                            checked={isSelected}
                                            className="mt-0.5 pointer-events-none"
                                        />

                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                                                {cap.name}
                                            </div>
                                            <div className="text-[11px] text-zinc-500 font-mono mt-0.5 flex gap-2 items-center flex-wrap">
                                                <span className="opacity-70">Imp. {cap.startPrinted}-{cap.endPrinted}</span>
                                                <span className="opacity-30">|</span>
                                                <div
                                                    className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded border border-blue-100 dark:border-blue-900/50"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <span className="text-blue-700 dark:text-blue-400 font-medium tracking-tight">Fis. Inicial:</span>
                                                    <Input
                                                        type="number"
                                                        className="h-5 w-12 text-[10px] px-1 py-0 font-mono font-bold bg-white dark:bg-zinc-950 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400"
                                                        placeholder={cap.startPhysical.toString()}
                                                        value={customRanges[cap.index]?.start !== undefined ? customRanges[cap.index].start : ''}
                                                        onChange={(e) => handleCustomRangeChange(cap.index, 'start', e.target.value)}
                                                    />
                                                    <span className="text-blue-700 dark:text-blue-400 font-medium tracking-tight ml-1">Fis. Final:</span>
                                                    <Input
                                                        type="number"
                                                        className="h-5 w-12 text-[10px] px-1 py-0 font-mono font-bold bg-white dark:bg-zinc-950 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400"
                                                        placeholder={cap.endPhysical.toString()}
                                                        value={customRanges[cap.index]?.end !== undefined ? customRanges[cap.index].end : ''}
                                                        onChange={(e) => handleCustomRangeChange(cap.index, 'end', e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex flex-col items-end gap-1 shrink-0">
                                            <Badge variant="outline" className="text-[10px] h-5 font-mono px-1.5 bg-white dark:bg-zinc-950">
                                                {cap.totalPages} Pags
                                            </Badge>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className={`h-6 w-6 rounded-full transition-opacity ${isViewing ? 'opacity-100 text-blue-600 bg-blue-100' : 'opacity-0 group-hover:opacity-100'}`}
                                                onClick={(e) => handleViewChapter(cap.startPhysical, e)}
                                                title="Ver en Visor PDF"
                                            >
                                                <Eye className="w-3.5 h-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </Card>

                {/* Estimation Footer (Sticky Bottom inside scroll) */}
                <Card className="shadow-xl border-emerald-100 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 shrink-0">
                    <CardContent className="p-4 flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-[10px] font-bold uppercase text-emerald-800 dark:text-emerald-500 tracking-wider">Total Selección</div>
                                <div className="text-2xl font-black text-emerald-900 dark:text-emerald-400 font-mono">
                                    {totals.totalPages} <span className="text-sm font-medium text-emerald-700/70">Páginas</span>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-[10px] font-bold uppercase text-emerald-800 dark:text-emerald-500 tracking-wider">Coste Est. (API Batch)</div>
                                <div className="text-2xl font-black text-emerald-900 dark:text-emerald-400 font-mono">
                                    ${totals.totalCostEuros.toFixed(3)}
                                </div>
                            </div>
                        </div>

                        <Button
                            className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/20"
                            disabled={selectedIndexes.length === 0 || isGenerating}
                            onClick={handleGenerateJob}
                        >
                            {isGenerating ? (
                                <Activity className="w-4 h-4 animate-spin" />
                            ) : (
                                <FileJson className="w-4 h-4" />
                            )}
                            {isGenerating ? 'Guardando...' : 'Guardar Configuración de Extracción'}
                        </Button>
                    </CardContent>
                </Card>

            </div>

            {/* Right Pane: Interactive PDF Viewer */}
            <div className="w-full xl:w-8/12 h-[500px] xl:h-full bg-zinc-950 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col relative group">
                {/* Viewer Top Bar */}
                <div className="h-12 bg-white/10 backdrop-blur-md border-b border-white/10 flex items-center justify-between px-4 shrink-0 absolute top-0 w-full z-10 transition-opacity opacity-0 group-hover:opacity-100">
                    <div className="flex items-center gap-2 text-white">
                        <BookOpen className="w-4 h-4 text-blue-400" />
                        <span className="text-sm font-medium drop-shadow-md">Visor Modo Estudio (Palma 2025)</span>
                    </div>
                    <Badge variant="outline" className="bg-black/50 border-white/20 text-white font-mono drop-shadow-md">
                        Página {activePdfPage}
                    </Badge>
                </div>

                {/* PDF Object window using URL hash for page navigation */}
                <div className="flex-1 w-full relative bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
                    {activePdfPage ? (
                        <iframe
                            key={`pdf-page-${activePdfPage}`} // Forces React to recreate the iframe so the browser doesn't swallow the #page hash change
                            src={`/admin/Palma47_2025_COAATMCA.pdf#page=${activePdfPage}&view=FitH`}
                            className="w-full h-full border-0 absolute inset-0"
                            title={`PDF Viewer - Page ${activePdfPage}`}
                        />
                    ) : (
                        <div className="text-zinc-500 font-medium">Selecciona un 'Ojo' para cargar el PDF</div>
                    )}
                </div>
            </div>

        </div>
    );
}

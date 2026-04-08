import React, { useState, useTransition } from 'react';
import { formatCurrency } from '@/lib/utils';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    GripVertical,
    MoreHorizontal,
    Package,
    Hammer,
    Sparkles,
    Search,
    ListTree,
    Trash2,
    Copy,
    AlertTriangle,
    Loader2,
    Percent,
    Wand2
} from "lucide-react";
import { Reorder, useDragControls } from "framer-motion";
import { cn } from "@/lib/utils";
import { EditableBudgetLineItem, ExecutionMode } from "@/types/budget-editor";
import { EditableCell } from "../EditableCell"; // Adjust relative path
import { sileo } from 'sileo';
import { generateBreakdownAction } from '@/actions/budget/smart-actions';
import { ICLFeedbackModal } from './ICLFeedbackModal';
import { BrainCircuit } from 'lucide-react';
import { useBudgetEditorContext } from '../BudgetEditorContext';

interface TableRowItemProps {
    item: EditableBudgetLineItem;
    onUpdate: (id: string, changes: Partial<EditableBudgetLineItem>) => void;
    onRemove: (id: string) => void;
    onDuplicate: (id: string) => void;
    showGhostMode?: boolean;
    executionMode?: ExecutionMode;
    onOpenBreakdown: (item: EditableBudgetLineItem) => void;
    onOpenMarkup: (id: string) => void;
    isReadOnly?: boolean;
    leadId?: string;
}

export const TableRowItem = React.memo(({
    item, onUpdate, onRemove, onDuplicate, showGhostMode, executionMode, onOpenBreakdown, onOpenMarkup, isReadOnly, leadId
}: TableRowItemProps) => {
    const controls = useDragControls();
    const [isPending, startTransition] = useTransition();

    // Deviation Analysis
    const currentPrice = item.item?.unitPrice || 0;
    const originalPrice = item.originalState?.unitPrice || currentPrice;
    const deviation = originalPrice > 0 ? Math.abs((currentPrice - originalPrice) / originalPrice) : 0;
    const isDeviated = deviation > 0.2;
    const needsReview = item.item?.needsHumanReview;

    // AI Candidates Inline State
    const [isAiModalOpen, setIsAiModalOpen] = useState(false);
    const [isIclModalOpen, setIsIclModalOpen] = useState(false);
    const allCandidates = (item.item?.candidates || item.item?.alternativeCandidates || []);
    const hasCandidates = allCandidates.length > 0;

    // Delta Detection for Frictionless ICL Feedback
    const hasManualDelta = item.originalState && item.item?.unitPrice !== undefined && (Math.abs(item.item.unitPrice - item.originalState.unitPrice) > 0.01);
    const showIclPrompt = (hasManualDelta || item.isDirty) && !isReadOnly;

    // Execution Only logic
    let deduct = 0;
    if (executionMode === 'execution' && item.item?.breakdown) {
        deduct = item.item.breakdown
            .filter((comp: any) => comp.is_variable === true || comp.is_variable === 'true' || comp.isVariable === true)
            .reduce((acc: number, comp: any) => {
                const cPrice = comp.unitPrice || comp.price || 0;
                const cQuantity = comp.quantity || comp.yield || 1;
                return acc + (comp.totalPrice || comp.total || (cPrice * cQuantity));
            }, 0) * (item.item?.quantity || 1);
    } else if (executionMode === 'labor' && item.item?.breakdown) {
        const laborCosts = item.item.breakdown
            .filter((comp: any) => comp.code && String(comp.code).toLowerCase().startsWith('mo'))
            .reduce((acc: number, comp: any) => {
                const cPrice = comp.unitPrice || comp.price || 0;
                const cQuantity = comp.quantity || comp.yield || 1;
                return acc + (comp.totalPrice || comp.total || (cPrice * cQuantity));
            }, 0);
        const totalLaborCosts = laborCosts * (item.item?.quantity || 1);
        deduct = (item.item?.totalPrice || 0) - totalLaborCosts;
    }
    
    const activePrice = Math.max(0, (item.item?.totalPrice || 0) - deduct);
    const displayTotal = Number(activePrice.toFixed(2));
    const displayUnitPrice = Number(((item.item?.quantity || 1) > 0 ? displayTotal / item.item!.quantity : 0).toFixed(2));

    const handleTotalChange = (val: string | number) => {
        const newTotal = Number(val);
        const quantity = item.item?.quantity || 1;
        const newUnitPrice = newTotal / (quantity === 0 ? 1 : quantity);
        onUpdate(item.id, { item: { ...item.item!, unitPrice: newUnitPrice } });
    };

    const handleGenerateBreakdown = (forceShowCandidates: boolean = false) => {
        if (!item.originalTask) return;

        sileo.show({
            title: forceShowCandidates ? "Buscando similares..." : "Generando descompuesto...",
            description: "La IA está analizando la partida.",
            icon: <Loader2 className="h-5 w-5 animate-spin text-purple-600" />
        });

        startTransition(async () => {
            const result = await generateBreakdownAction(item.originalTask!, leadId);
            if (result.success && result.items && result.items.length > 0) {
                if (forceShowCandidates && (result as any).candidates?.length > 0) {
                    sileo.info({ title: "Candidatos encontrados", description: "Revisa las opciones extraídas del catálogo." });
                    onUpdate(item.id, {
                        item: {
                            ...item.item!,
                            candidates: (result as any).candidates
                        }
                    });
                    setIsAiModalOpen(true);
                } else {
                    const match: any = result.items[0];

                    onUpdate(item.id, {
                        item: {
                            ...item.item!,
                            unitPrice: match.unitPrice,
                            description: match.description,
                            unit: match.unit || item.item?.unit || 'ud',
                            code: match.code,
                            totalPrice: match.unitPrice * (item.item?.quantity || 1),
                            breakdown: match.breakdown
                        },
                        isDirty: true
                    });
                    sileo.success({ title: "Descompuesto generado", description: `${result.items.length} elementos analizados.` });
                }
            } else if ((result as any).humanInTheLoop && (result as any).candidates?.length > 0) {
                // The AI rejected all, but we have candidates. Show them inline.
                sileo.info({ title: "Atención requerida", description: "La IA encontró opciones pero necesita tu decisión." });
                onUpdate(item.id, {
                    item: {
                        ...item.item!,
                        candidates: (result as any).candidates
                    }
                });
                setIsAiModalOpen(true);
            } else {
                sileo.error({ title: "Sin resultados", description: result.error || "No se pudo generar el descompuesto." });
            }
        });
    };

    const hasBreakdown = (item.item?.breakdown?.length ?? 0) > 0;

    return (
        <Reorder.Item
            value={item}
            id={item.id}
            as="div"
            dragListener={false}
            dragControls={controls}
            className="flex flex-col group relative hover:bg-slate-50 dark:hover:bg-white/5 hover:text-foreground transition-all duration-300 border-b border-slate-100 dark:border-white/5 data-[state=selected]:bg-slate-100 font-sans"
        >
            <div className={cn(
                "flex items-start w-full min-w-[800px]",
                hasBreakdown && "bg-gradient-to-r from-purple-500/5 via-transparent to-transparent dark:from-purple-500/10",
                isDeviated && "bg-amber-50/30 dark:bg-amber-900/10",
                needsReview && "bg-amber-50/50 dark:bg-amber-900/20 border-l-2 border-l-amber-500",
                isPending && "opacity-50 pointer-events-none scale-[0.99] blur-[1px]",
                item.item?.code === 'GENERIC-EXPLICIT' && "bg-amber-50/50 dark:bg-amber-900/20"
            )}>
            {/* Left AI Highlight Bar & Drag Handle */}
            <div className="w-[40px] shrink-0 p-2 text-center text-slate-300 relative">
                {hasBreakdown && (
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-purple-400 to-indigo-600 rounded-r-md opacity-80" />
                )}
                <div onPointerDown={(e) => controls.start(e)} className="cursor-grab active:cursor-grabbing flex justify-center mt-1.5 border-l-0">
                    <GripVertical className="w-4 h-4" />
                </div>
            </div>

            {/* Type Icon */}
            <div className="w-[50px] shrink-0 p-2 text-center pt-3">
                {isPending ? (
                    <div className="flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-purple-500" /></div>
                ) : (
                    item.type === 'MATERIAL' ? (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="w-8 h-8 rounded-md bg-blue-50 dark:bg-blue-900/20 text-blue-600 flex items-center justify-center mx-auto cursor-help">
                                        <Package className="w-4 h-4" />
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>Material</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    ) : (
                        <div className="w-8 h-8 rounded-md bg-slate-100 dark:bg-white/10 text-slate-500 flex items-center justify-center mx-auto">
                            <Hammer className="w-4 h-4" />
                        </div>
                    )
                )}
            </div>

            {/* Code & Description - TEXTAREA for wrapping */}
            <div className="flex-1 min-w-[300px] p-2">
                <div className="flex flex-col gap-1">
                    <Textarea
                        value={item.originalTask || ""}
                        onChange={(e) => onUpdate(item.id, { originalTask: e.target.value })}
                        disabled={isReadOnly}
                        className="min-h-[24px] resize-y p-0 border-none shadow-none focus-visible:ring-0 bg-transparent text-sm font-medium leading-relaxed overflow-hidden"
                        placeholder="Descripción de la partida..."
                        rows={1}
                        onInput={(e) => {
                            const target = e.target as HTMLTextAreaElement;
                            target.style.height = 'auto';
                            target.style.height = `${target.scrollHeight}px`;
                        }}
                    />
                    <div className="flex items-center gap-2 mt-1">
                        <span className={cn(
                            "text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors",
                            item.item?.code === 'GENERIC-EXPLICIT'
                                ? "text-amber-700 bg-amber-100 border border-amber-200 dark:bg-amber-900/40 dark:text-amber-400 dark:border-amber-800/50 font-semibold"
                                : "text-slate-400 bg-slate-50 dark:bg-white/5"
                        )}>
                            {item.item?.code || "---"}
                        </span>
                        {/* Unified Audit & Breakdown Button */}
                        <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                                "h-5 px-2 text-[10px] font-semibold transition-all shadow-sm flex items-center gap-1.5",
                                hasBreakdown
                                    ? "bg-gradient-to-r from-purple-100 to-indigo-100 text-purple-700 hover:from-purple-200 hover:to-indigo-200 dark:from-purple-900/30 dark:to-indigo-900/30 dark:text-purple-300 ring-1 ring-purple-500/20"
                                    : "bg-slate-100/80 text-slate-600 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 dark:bg-white/5 dark:text-slate-400 dark:border-white/10 dark:hover:bg-white/10 dark:hover:text-slate-200"
                            )}
                            onClick={() => onOpenBreakdown(item)}
                        >
                            <Sparkles className={cn("w-3 h-3", hasBreakdown ? "text-indigo-500 animate-[pulse_2s_ease-in-out_infinite]" : "text-amber-500/80")} />
                            Auditar & Detalles
                        </Button>

                        {/* Search Similar Items Button */}
                        {!isReadOnly && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 px-2 text-[10px] font-semibold transition-all shadow-sm bg-slate-50 text-slate-600 hover:bg-slate-100 dark:bg-white/5 dark:text-slate-300 border border-slate-100 dark:border-white/10 disabled:opacity-50 disabled:pointer-events-none"
                                onClick={() => handleGenerateBreakdown(true)}
                                disabled={isPending}
                            >
                                <Search className="w-3 h-3 mr-1" />
                                Buscar similares
                            </Button>
                        )}



                        {/* Frictionless ICL Micro-Interaction */}
                        {showIclPrompt && (
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => setIsIclModalOpen(true)}
                                className="h-5 px-2 text-[10px] font-semibold transition-all shadow-sm bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800 animate-in fade-in zoom-in duration-300"
                            >
                                <BrainCircuit className="w-3 h-3 mr-1" />
                                Enseñar a la IA el motivo
                            </Button>
                        )}

                        {isDeviated && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span className="flex items-center justify-center p-1 rounded-full text-amber-500 bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 transition-colors cursor-help">
                                            <AlertTriangle className="w-3.5 h-3.5" />
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>Desviación de {Math.round(deviation * 100)}% calculada</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                        {needsReview && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span className="flex items-center justify-center p-1 rounded-full text-amber-600 bg-amber-50 hover:bg-amber-100 border border-amber-200 dark:bg-amber-900/30 dark:border-amber-800 dark:hover:bg-amber-900/50 transition-colors cursor-help">
                                            <AlertTriangle className="w-3.5 h-3.5" />
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>Candidatos débiles. Revisión IA Sugerida.</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                    </div>
                </div>
            </div>

            {/* Unit */}
            <div className="w-[80px] shrink-0 p-2 pt-3">
                <EditableCell
                    value={item.item?.unit || 'ud'}
                    onChange={(val) => onUpdate(item.id, { item: { ...item.item!, unit: val as string } })}
                    className="text-center text-xs font-medium text-slate-500 bg-transparent border-transparent hover:bg-slate-100 dark:hover:bg-white/5 focus:bg-white dark:focus:bg-zinc-900 w-full"
                />
            </div>

            {/* Quantity */}
            <div className="w-[100px] shrink-0 p-2 text-right pt-3">
                <EditableCell
                    value={item.item?.quantity || 0}
                    onChange={(val) => onUpdate(item.id, { item: { ...item.item!, quantity: Number(val) } })}
                    type="number"
                    className="text-right text-sm font-mono text-slate-700 dark:text-slate-200 bg-transparent border-transparent hover:bg-slate-100 dark:hover:bg-white/5 focus:bg-white dark:focus:bg-zinc-900 w-full pr-2"
                />
            </div>

            {/* Unit Price */}
            <div className="w-[120px] shrink-0 p-2 text-right pt-3">
                <div className="relative group/price">
                    <EditableCell
                        value={displayUnitPrice}
                        onChange={(val) => onUpdate(item.id, { item: { ...item.item!, unitPrice: Number(val) } })}
                        type="currency"
                        className={cn(
                            "text-right text-sm font-mono text-slate-700 dark:text-slate-200 bg-transparent border-transparent hover:bg-slate-100 dark:hover:bg-white/5 focus:bg-white dark:focus:bg-zinc-900 w-full",
                            item.item?.unitPrice === 0 && "text-red-500 font-bold"
                        )}
                    />
                    {showGhostMode && item.originalState && (
                        <div className="absolute -bottom-4 right-2 text-[10px] text-slate-400 line-through">
                            {item.originalState.unitPrice.toFixed(2)}€
                        </div>
                    )}
                </div>
            </div>

            {/* Total Price */}
            <div className="w-[120px] shrink-0 p-2 text-right font-bold text-slate-700 dark:text-white font-mono bg-slate-50/30 dark:bg-white/5 pt-3">
                <EditableCell
                    value={displayTotal}
                    onChange={handleTotalChange}
                    type="currency"
                    className="text-right bg-transparent border-transparent w-full"
                />
            </div>

            {/* Actions */}
            <div className="w-[50px] shrink-0 p-2 text-center pt-2">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-600">
                            <MoreHorizontal className="w-4 h-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64 p-2 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-xl border-purple-200/50 dark:border-purple-900/50 shadow-2xl rounded-xl">
                        {!isReadOnly && (
                            <>
                                <DropdownMenuLabel className={cn(
                                    "flex items-center gap-2 text-xs uppercase tracking-widest font-bold mb-1",
                                    isReadOnly ? "text-slate-300 dark:text-slate-600" : "text-slate-400"
                                )}>
                                    <Sparkles className={cn("w-3.5 h-3.5", isReadOnly ? "text-purple-300 dark:text-purple-800" : "text-purple-500")} />
                                    Acciones Cógnitivas IA
                                </DropdownMenuLabel>
                                <DropdownMenuItem 
                                    onClick={(e) => {
                                        if (isReadOnly) {
                                            e.preventDefault();
                                            return;
                                        }
                                        handleGenerateBreakdown(false);
                                    }} 
                                    disabled={isReadOnly}
                                    className={cn(
                                        "text-sm font-medium focus:bg-purple-50 dark:focus:bg-purple-900/20 focus:text-purple-700 dark:focus:text-purple-300 rounded-lg px-3 py-2 transition-colors",
                                        isReadOnly ? "opacity-50 pointer-events-none" : "cursor-pointer"
                                    )}
                                >
                                    <div className="flex flex-col gap-0.5">
                                        <span className="flex items-center gap-2"><Wand2 className="w-4 h-4 text-purple-600 dark:text-purple-400" />Buscar Partida en Catálogo</span>
                                        <span className="text-[10px] text-slate-400 font-normal">Alinea con Catálogos Oficiales o presenta Opciones RAG</span>
                                    </div>
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                    onClick={(e) => {
                                        if (isReadOnly) {
                                            e.preventDefault();
                                            return;
                                        }
                                        setIsIclModalOpen(true);
                                    }} 
                                    disabled={isReadOnly}
                                    className={cn(
                                        "text-sm font-medium focus:bg-indigo-50 dark:focus:bg-indigo-900/20 focus:text-indigo-700 dark:focus:text-indigo-300 rounded-lg px-3 py-2 transition-colors",
                                        isReadOnly ? "opacity-50 pointer-events-none" : "cursor-pointer"
                                    )}
                                >
                                    <div className="flex flex-col gap-0.5">
                                        <span className="flex items-center gap-2"><BrainCircuit className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />Registrar Criterio Heurístico</span>
                                        <span className="text-[10px] text-slate-400 font-normal">Enseña a la IA el motivo de la corrección</span>
                                    </div>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                            </>
                        )}

                        <DropdownMenuItem className="cursor-pointer" onClick={() => onOpenBreakdown(item)}>
                            <Search className="w-4 h-4 mr-2" />
                            Ver Detalles
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />
                        <DropdownMenuItem 
                            onClick={(e) => {
                                if (isReadOnly) {
                                    e.preventDefault();
                                    return;
                                }
                                onOpenMarkup(item.id);
                            }} 
                            disabled={isReadOnly}
                            className={isReadOnly ? "opacity-50 pointer-events-none" : "cursor-pointer"}
                        >
                            <Percent className="w-4 h-4 mr-2 text-slate-500" />
                            Ajustar Precio a Partida
                        </DropdownMenuItem>

                        <DropdownMenuItem 
                            onClick={(e) => {
                                if (isReadOnly) {
                                    e.preventDefault();
                                    return;
                                }
                                onDuplicate(item.id);
                            }} 
                            disabled={isReadOnly}
                            className={isReadOnly ? "opacity-50 pointer-events-none" : "cursor-pointer"}
                        >
                            <Copy className="w-4 h-4 mr-2" />
                            Duplicar
                        </DropdownMenuItem>
                        
                        <DropdownMenuItem 
                            className={cn(
                                "text-red-600 focus:text-red-700 focus:bg-red-50",
                                "cursor-pointer",
                                isReadOnly && "opacity-50 pointer-events-none"
                            )}
                            disabled={isReadOnly}
                            onClick={(e) => {
                                if (isReadOnly) {
                                    e.preventDefault();
                                    return;
                                }
                                onRemove(item.id);
                            }}
                        >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Eliminar
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            
            {/* Renders ICL Feedback Modal */}
            {isIclModalOpen && (
                <ICLFeedbackModal
                    open={isIclModalOpen}
                    onOpenChange={setIsIclModalOpen}
                    item={item}
                    leadId={leadId}
                />
            )}
        </div>
        </Reorder.Item>
    );
}, (prev, next) => {
    // Memoization deep-diff to avoid hundreds of useless re-renders on dragging and typing
    if (prev.showGhostMode !== next.showGhostMode) return false;
    if (prev.executionMode !== next.executionMode) return false;
    if (prev.isReadOnly !== next.isReadOnly) return false;
    if (JSON.stringify(prev.item.item) !== JSON.stringify(next.item.item)) return false;
    if (prev.item.isDirty !== next.item.isDirty) return false;
    if (prev.item.originalTask !== next.item.originalTask) return false;
    return true;
});

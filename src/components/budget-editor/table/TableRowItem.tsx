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
    Layers,
    Scale,
    Trash2,
    Copy,
    AlertTriangle,
    Loader2,
    Percent,
    Wand2
} from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { EditableBudgetLineItem, ExecutionMode } from "@/types/budget-editor";
import { EditableCell } from "../EditableCell"; // Adjust relative path
import { sileo } from 'sileo';
import { generateBreakdownAction } from '@/actions/budget/smart-actions';
import { ICLFeedbackModal } from './ICLFeedbackModal';
import { BrainCircuit } from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import { MeasurementsPanel } from './MeasurementsPanel';
import { useBudgetEditorContext } from '../BudgetEditorContext';
import {
    BudgetMode,
    computePartidaTotalForMode,
    executionModeToBudgetMode,
} from '@/lib/budget/budget-mode-calculator';
import { detectDivergence } from '@/lib/budget/reconciliation';
import { ReconciliationChip } from '../ReconciliationChip';
import { useMarkupFactor } from '@/hooks/use-markup-factor';
import { logCorrectionPairAction } from '@/actions/ai-training/log-correction-pair.action';

interface TableRowItemProps {
    item: EditableBudgetLineItem;
    onUpdate: (id: string, changes: Partial<EditableBudgetLineItem>, transient?: boolean) => void;
    onRemove: (id: string) => void;
    onDuplicate: (id: string) => void;
    showGhostMode?: boolean;
    executionMode?: ExecutionMode;
    onOpenBreakdown: (item: EditableBudgetLineItem) => void;
    onOpenMarkup: (id: string) => void;
    /** Phase 17 — abre modal de reconciliación con foco en esta partida. */
    onOpenReconciliation?: (partidaId: string) => void;
    isReadOnly?: boolean;
    leadId?: string;
}

export const TableRowItem = React.memo(({
    item, onUpdate, onRemove, onDuplicate, showGhostMode, executionMode, onOpenBreakdown, onOpenMarkup, onOpenReconciliation, isReadOnly, leadId
}: TableRowItemProps) => {
    const {
        attributes,
        listeners,
        setNodeRef: setSortableRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: item.id, disabled: isReadOnly });
    const dragStyle: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : undefined,
        zIndex: isDragging ? 20 : undefined,
        position: 'relative',
    };
    const [isPending, startTransition] = useTransition();
    const { state, budgetId } = useBudgetEditorContext();
    // Phase 17.4 — factor de display centralizado en `useMarkupFactor`.
    const { markupFactor, isMarkupBaked } = useMarkupFactor();

    // BC3 doble precio: si el presupuesto viene de un .bc3 con precios, mostramos
    // dos columnas (Precio BC3 vs Precio IA) y el usuario elige la fuente activa.
    const hasDualPrice = state.items.some((i: any) => i.item?.bc3_unit_price != null);
    const bc3Price: number | null | undefined = item.item?.bc3_unit_price;
    const aiPrice = item.item?.ai_unit_price ?? item.item?.unitPrice ?? 0;
    const activePriceSource = item.item?.active_price_source ?? (bc3Price != null ? 'bc3' : 'ai');
    const priceDivergence = (bc3Price != null && bc3Price > 0 && item.item?.ai_unit_price != null)
        ? Math.abs(item.item.ai_unit_price - bc3Price) / bc3Price
        : 0;

    // Sprint 3 — S3-07 partial.
    //
    // Wrapper que intercepta `onUpdate` y, si el cambio toca campos materiales
    // (code, unitPrice, unit, quantity), dispara `logCorrectionPairAction`
    // fire-and-forget. Comparamos la propuesta IA (capturada en
    // `item.originalState` por `use-budget-editor.ts` en SET_ITEMS) contra los
    // valores resultantes tras el merge.
    //
    // El logger es invisible al usuario: errores se loguean por consola y el
    // editor sigue funcionando.
    const handleUpdate = (id: string, changes: Partial<EditableBudgetLineItem>) => {
        onUpdate(id, changes);

        try {
            // Pre-condición: necesitamos budgetId, originalState (baseline IA)
            // y al menos un campo del payload `item` mutado.
            if (!budgetId) return;
            if (!item.originalState) return;
            if (!changes.item) return;

            const incoming = changes.item;
            const baseline = item.originalState;
            const aiCode = item.item?.code || '';
            // Construimos el "antes" (baseline) y el "después" mezclando lo
            // que ya tenía la partida con el delta entrante.
            const aiProposed = {
                code: aiCode,
                description: baseline.description || item.item?.description || '',
                unitPrice: Number(baseline.unitPrice ?? 0),
                matchConfidence: Number(item.item?.matchConfidence ?? 0),
                unit: baseline.unit || item.item?.unit || 'ud',
                quantity: Number(baseline.quantity ?? item.item?.quantity ?? 1),
            };
            const humanChosen = {
                code: (incoming as any).code ?? aiCode,
                description: (incoming as any).description ?? item.item?.description ?? '',
                unitPrice: Number((incoming as any).unitPrice ?? item.item?.unitPrice ?? 0),
                unit: (incoming as any).unit ?? item.item?.unit ?? 'ud',
                quantity: Number((incoming as any).quantity ?? item.item?.quantity ?? 1),
            };

            // Si ningún campo material cambia respecto a baseline, no hay
            // corrección que registrar (incluye renombrados de description).
            const codeEq = (aiProposed.code || '').trim() === (humanChosen.code || '').trim();
            const priceEq = Math.abs(aiProposed.unitPrice - humanChosen.unitPrice) < 0.001;
            const unitEq = (aiProposed.unit || '').trim().toLowerCase() === (humanChosen.unit || '').trim().toLowerCase();
            const qtyEq = Math.abs(aiProposed.quantity - humanChosen.quantity) < 0.001;
            if (codeEq && priceEq && unitEq && qtyEq) return;

            // Fire-and-forget; el server-action ya filtra no-ops y errores
            // de auth sin lanzar.
            void logCorrectionPairAction({
                budgetId,
                partidaCode: item.item?.code || aiProposed.code || 'unknown',
                queryText: item.originalTask || item.item?.description || '',
                aiProposed,
                humanChosen,
            }).catch(err => {
                console.warn('[RLHF] logCorrectionPair failed (non-fatal)', err);
            });
        } catch (err) {
            console.warn('[RLHF] logCorrectionPair wrapper threw (non-fatal)', err);
        }
    };

    // Deviation Analysis
    const currentPrice = item.item?.unitPrice || 0;
    const originalPrice = item.originalState?.unitPrice || currentPrice;
    const deviation = originalPrice > 0 ? Math.abs((currentPrice - originalPrice) / originalPrice) : 0;
    const isDeviated = deviation > 0.2;
    const needsReview = item.item?.needsHumanReview;
    // Wave 2 — procedencia de la partida (match_kind) visible en la fila para
    // dirigir la revisión: 'from_scratch' (compuesta) y '1:N' (combinada) son las
    // de mayor incertidumbre; '1:1' (match directo de catálogo) no se marca para
    // no añadir ruido. El dato ya viaja en item.item.match_kind desde el backend.
    const matchKind = item.item?.match_kind;
    const provenance = matchKind === 'from_scratch'
        ? { label: 'Compuesta', tip: 'Partida compuesta desde cero (mano de obra + materiales + medios auxiliares). Revisa rendimientos y precios.', cls: 'text-violet-700 bg-violet-50 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800' }
        : matchKind === '1:N'
            ? { label: 'Combinada', tip: 'Combinada a partir de varias partidas del catálogo.', cls: 'text-sky-700 bg-sky-50 border-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800' }
            : null;

    // Wave 2 — factor de calibración catálogo→real aplicado al PEM. Transparencia
    // "nada oculto" (spec §6/§8): visible sólo cuando el pricer aplicó un factor
    // ≠ 1.0. Los campos los stampa el pricer Python en ai_resolution.
    const appliedCalFactor: number | undefined = item.item?.aiResolution?.applied_calibration_factor;
    const preCalPrice: number | undefined = item.item?.aiResolution?.pre_calibration_unit_price;
    const hasCalibration = typeof appliedCalFactor === 'number' && Math.abs(appliedCalFactor - 1) > 0.001;

    // AI Candidates Inline State
    const [isAiModalOpen, setIsAiModalOpen] = useState(false);
    const [isIclModalOpen, setIsIclModalOpen] = useState(false);
    const [measOpen, setMeasOpen] = useState(false);
    const measurements = item.item?.measurements;
    const hasMeasurements = (measurements?.length ?? 0) > 0;
    const allCandidates = (item.item?.candidates || item.item?.alternativeCandidates || []);
    const hasCandidates = allCandidates.length > 0;

    // Delta Detection for Frictionless ICL Feedback
    const hasManualDelta = item.originalState && item.item?.unitPrice !== undefined && (Math.abs(item.item.unitPrice - item.originalState.unitPrice) > 0.01);
    const showIclPrompt = (hasManualDelta || item.isDirty) && !isReadOnly;

    // Fase 11.D — modo de presupuesto centralizado en helper puro.
    // Mapea executionMode legacy ('complete'|'execution'|'labor') a BudgetMode
    // y delega la suma a `computePartidaTotalForMode`. Misma semántica que el
    // código previo, ahora con doble señal (code prefix + is_variable + type).
    const budgetMode: BudgetMode = executionModeToBudgetMode(executionMode);
    const totalPriceFromBreakdown = computePartidaTotalForMode(
        item.item?.breakdown,
        item.item?.unitPrice ?? 0,
        item.item?.quantity ?? 0,
        budgetMode,
    );
    const activePrice = budgetMode === BudgetMode.COMPLETE
        ? (item.item?.totalPrice || 0)
        : totalPriceFromBreakdown;
    // Phase 15 — multiplicar por markupFactor para mostrar precios all-in al usuario.
    // Internamente seguimos almacenando raw PEM. Cuando el usuario edita un valor,
    // dividimos por markupFactor para guardar el raw PEM equivalente.
    const displayTotal = Number((activePrice * markupFactor).toFixed(2));
    const displayUnitPrice = Number(((item.item?.quantity || 1) > 0 ? displayTotal / item.item!.quantity : 0).toFixed(2));

    // Convierte el total all-in editado por el usuario en el precio unitario raw
    // que almacenamos internamente. Reutilizado por el commit final (blur) y por
    // el recálculo en vivo (cada pulsación).
    const totalToUnitPrice = (val: string | number) => {
        const newTotalAllIn = Number(val);
        const newTotalRaw = newTotalAllIn / (markupFactor || 1);
        const quantity = item.item?.quantity || 1;
        return newTotalRaw / (quantity === 0 ? 1 : quantity);
    };

    const handleTotalChange = (val: string | number) => {
        // El usuario edita el valor all-in mostrado. Almacenamos raw PEM.
        // Sprint 3 — S3-07: usar handleUpdate para registrar correction-pair.
        handleUpdate(item.id, { item: { ...item.item!, unitPrice: totalToUnitPrice(val) } });
    };

    const unitPriceAllInToRaw = (val: string | number) => Number(val) / (markupFactor || 1);

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
        <div
            ref={setSortableRef}
            style={dragStyle}
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
                <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing flex justify-center mt-1.5 border-l-0 touch-none" aria-label="Arrastrar partida">
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
                        {provenance && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span className={cn("flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border cursor-help", provenance.cls)}>
                                            {matchKind === 'from_scratch'
                                                ? <Layers className="w-3 h-3" />
                                                : <ListTree className="w-3 h-3" />}
                                            {provenance.label}
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent><p className="max-w-[220px]">{provenance.tip}</p></TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                        {hasCalibration && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border cursor-help text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800">
                                            <Scale className="w-3 h-3" />
                                            Calib ×{appliedCalFactor!.toFixed(2)}
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p className="max-w-[240px]">
                                            Calibración catálogo→real ×{appliedCalFactor!.toFixed(2)} aplicada sobre el PEM
                                            {typeof preCalPrice === 'number' && preCalPrice > 0
                                                ? ` (base ${formatCurrency(preCalPrice * markupFactor)} → ${formatCurrency(preCalPrice * appliedCalFactor! * markupFactor)})`
                                                : ''}
                                        </p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                        {isMarkupBaked && onOpenReconciliation && (() => {
                            const div = detectDivergence(item);
                            return div.hasDivergence ? (
                                <ReconciliationChip
                                    diffAmount={div.diffAmount}
                                    diffPct={div.diffPct}
                                    onClick={() => onOpenReconciliation(item.id)}
                                />
                            ) : null;
                        })()}
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
                                        <p>{matchKind === 'from_scratch'
                                            ? 'Partida compuesta desde cero — revisa rendimientos y precios.'
                                            : 'Candidatos débiles. Revisión IA sugerida.'}</p>
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
                    onChange={(val) => handleUpdate(item.id, { item: { ...item.item!, unit: val as string } })}
                    className="text-center text-xs font-medium text-slate-500 bg-transparent border-transparent hover:bg-slate-100 dark:hover:bg-white/5 focus:bg-white dark:focus:bg-zinc-900 w-full"
                />
            </div>

            {/* Quantity */}
            <div className="w-[100px] shrink-0 p-2 text-right pt-3">
                <EditableCell
                    value={item.item?.quantity || 0}
                    onChange={(val) => handleUpdate(item.id, { item: { ...item.item!, quantity: Number(val) } })}
                    onLiveChange={(val) => onUpdate(item.id, { item: { ...item.item!, quantity: Number(val) } }, true)}
                    type="number"
                    className="text-right text-sm font-mono text-slate-700 dark:text-slate-200 bg-transparent border-transparent hover:bg-slate-100 dark:hover:bg-white/5 focus:bg-white dark:focus:bg-zinc-900 w-full pr-2"
                />
                {hasMeasurements && (
                    <button
                        type="button"
                        onClick={() => setMeasOpen(o => !o)}
                        className="mt-1 ml-auto flex items-center gap-0.5 text-[10px] text-slate-400 hover:text-primary transition-colors"
                        title="Ver estado de mediciones"
                    >
                        <ChevronDown className={cn("w-3 h-3 transition-transform", measOpen && "rotate-180")} />
                        <span>mediciones</span>
                    </button>
                )}
            </div>

            {hasDualPrice ? (
                <>
                    {/* Precio BC3 (del propio archivo) */}
                    <div className="w-[110px] shrink-0 p-2 text-right pt-2.5">
                        {bc3Price != null ? (
                            <button
                                type="button"
                                onClick={() => onUpdate(item.id, { item: { ...item.item!, active_price_source: 'bc3', unitPrice: bc3Price } })}
                                title="Usar el precio del BC3"
                                className={cn(
                                    "w-full text-right font-mono text-sm rounded-md px-2 py-1 transition-colors",
                                    activePriceSource === 'bc3'
                                        ? "bg-primary/15 border border-primary/40 text-slate-800 dark:text-white font-semibold"
                                        : "text-slate-400 border border-transparent hover:bg-slate-100 dark:hover:bg-white/5"
                                )}
                            >
                                {formatCurrency((bc3Price || 0) * markupFactor)}
                            </button>
                        ) : (
                            <span className="block text-right text-slate-300 dark:text-slate-600 text-sm pr-2">—</span>
                        )}
                    </div>
                    {/* Precio IA (estimación catálogo + Vertex) */}
                    <div className="w-[110px] shrink-0 p-2 text-right pt-2.5">
                        <button
                            type="button"
                            onClick={() => onUpdate(item.id, { item: { ...item.item!, active_price_source: 'ai', unitPrice: aiPrice } })}
                            title="Usar la estimación de la IA"
                            className={cn(
                                "w-full text-right font-mono text-sm rounded-md px-2 py-1 transition-colors",
                                activePriceSource === 'ai'
                                    ? "bg-violet-500/15 border border-violet-500/40 text-slate-800 dark:text-white font-semibold"
                                    : "text-slate-400 border border-transparent hover:bg-slate-100 dark:hover:bg-white/5"
                            )}
                        >
                            {formatCurrency((aiPrice || 0) * markupFactor)}
                        </button>
                        {priceDivergence >= 0.08 && (
                            <div className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold mt-0.5 pr-1" title="Divergencia entre el precio del BC3 y la estimación IA">
                                ▲ {Math.round(priceDivergence * 100)}%
                            </div>
                        )}
                    </div>
                </>
            ) : (
                /* Unit Price — mostrado all-in (raw × markupFactor). Edita en valor all-in y se guarda raw. */
                <div className="w-[120px] shrink-0 p-2 text-right pt-3">
                    <div className="relative group/price">
                        <EditableCell
                            value={displayUnitPrice}
                            onChange={(val) => {
                                // Phase 15 — el usuario edita en all-in; almacenamos raw PEM.
                                // Sprint 3 — S3-07: usar handleUpdate para registrar correction-pair.
                                handleUpdate(item.id, { item: { ...item.item!, unitPrice: unitPriceAllInToRaw(val) } });
                            }}
                            onLiveChange={(val) => onUpdate(item.id, { item: { ...item.item!, unitPrice: unitPriceAllInToRaw(val) } }, true)}
                            type="currency"
                            className={cn(
                                "text-right text-sm font-mono text-slate-700 dark:text-slate-200 bg-transparent border-transparent hover:bg-slate-100 dark:hover:bg-white/5 focus:bg-white dark:focus:bg-zinc-900 w-full",
                                item.item?.unitPrice === 0 && "text-red-500 font-bold"
                            )}
                        />
                        {showGhostMode && item.originalState && (
                            <div className="absolute -bottom-4 right-2 text-[10px] text-slate-400 line-through">
                                {formatCurrency(item.originalState.unitPrice * markupFactor)}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Total Price */}
            <div className="w-[120px] shrink-0 p-2 text-right font-bold text-slate-700 dark:text-white font-mono bg-slate-50/30 dark:bg-white/5 pt-3">
                <EditableCell
                    value={displayTotal}
                    onChange={handleTotalChange}
                    onLiveChange={(val) => onUpdate(item.id, { item: { ...item.item!, unitPrice: totalToUnitPrice(val) } }, true)}
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
        {measOpen && hasMeasurements && measurements && (
            <MeasurementsPanel measurements={measurements} unit={item.item?.unit} total={item.item?.quantity} />
        )}
        </div>
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

import React, { useState, useEffect, useRef, useContext } from 'react';
import { AuthContext } from '@/context/auth-context';
import { formatCurrency, cn } from '@/lib/utils';
import {
    CorrectionCaptureDialog,
    detectPriceOrUnitChange,
    type PriceOrUnitSnapshot,
} from './CorrectionCaptureDialog';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { 
    Sparkles, AlertTriangle, ListTree, FileText, 
    TrendingUp, ChevronDown, ChevronUp, Bot, Send, Package, PlusCircle, Settings2, Trash2
} from "lucide-react";
import { EditableBudgetLineItem } from "@/types/budget-editor";
import { sileo } from 'sileo';
import { SemanticCatalogSidebar } from '../SemanticCatalogSidebar';
import { Dialog, DialogContent, DialogTitle, DialogHeader } from '@/components/ui/dialog';
import { MatchKindChip, UnitConversionApplied, CandidateMetaBadges, AppliedFragmentsBadge } from './audit-v005';

interface AIReasoningSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item: EditableBudgetLineItem | null;
    onUpdate: (id: string, changes: Partial<EditableBudgetLineItem>) => void;
    isAdmin?: boolean;
}

export function AIReasoningSheet({ open, onOpenChange, item, onUpdate, isAdmin = false }: AIReasoningSheetProps) {
    const [selectedVariableIndex, setSelectedVariableIndex] = useState<number | null>(null);
    const [isAddingNewBreakdown, setIsAddingNewBreakdown] = useState<boolean>(false);
    const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

    // Fase 6.B — captura de correcciones humanas (price/unit changes → dialog).
    // Guardamos el snapshot inicial del item al abrirse; las ediciones posteriores
    // del aparejador disparan el dialog.
    const { user: authUser } = useContext(AuthContext);
    const [captureOpen, setCaptureOpen] = useState(false);
    const aiProposedRef = useRef<{ itemId: string; snapshot: PriceOrUnitSnapshot } | null>(null);
    const lastSnapshotRef = useRef<PriceOrUnitSnapshot | undefined>(undefined);

    const currentSnapshot: PriceOrUnitSnapshot | undefined = item?.item
        ? { unitPrice: Number(item.item.unitPrice) || 0, unit: item.item.unit || '' }
        : undefined;

    useEffect(() => {
        if (!item?.item || !currentSnapshot) {
            return;
        }
        // Cuando cambia el item en el sheet, reseteamos el "precio IA de referencia".
        if (!aiProposedRef.current || aiProposedRef.current.itemId !== item.id) {
            aiProposedRef.current = { itemId: item.id, snapshot: currentSnapshot };
            lastSnapshotRef.current = currentSnapshot;
            return;
        }
        const change = detectPriceOrUnitChange(lastSnapshotRef.current, currentSnapshot);
        lastSnapshotRef.current = currentSnapshot;
        if (change) {
            setCaptureOpen(true);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item?.id, currentSnapshot?.unitPrice, currentSnapshot?.unit]);

    if (!item || !item.item) return null;

    const allCandidates = ((item.item as any).alternatives || item.item.candidates || item.item.alternativeCandidates || []);
    const hasCandidates = allCandidates.length > 0;
    
    const hasAIResolution = !!(item.item.aiResolution || (item.item as any).ai_resolution || item.item.ai_justification);
    
    // Robust fallback for Pydantic/JSON camelCase or snake_case conversion leaks
    const aiReasoning = item.item.aiResolution?.reasoning_trace || item.item.aiResolution?.reasoningTrace || item.item.aiResolution?.reasoning || (item.item as any)?.ai_resolution?.reasoning || item.item.note || item.item.ai_justification || "Partida introducida manualmente sin dictamen RAG del modelo cognitivo.";

    // FINANCIAL & DISTRIBUTION CALCULATIONS
    const rawBreakdown = item.item?.breakdown || [];
    const breakdown = rawBreakdown; // Alias for UI Grid compatibility
    
    // Escenario 1: Ganadora pura/estimada. El breakdown principal está vacío, pero el RAG nos dejó la anatomía del ganador original.
    const selectedCandidate = item.item.aiResolution?.selected_candidate || (item.item as any)?.ai_resolution?.selected_candidate;
    const inheritCandidateBreakdown = rawBreakdown.length === 0 && selectedCandidate?.breakdown && selectedCandidate.breakdown.length > 0;
    
    // Escenario 2: Compuesta. El breakdown principal tiene cajas grandes.
    // Usamos el `activeBreakdown` SOLO para el termímetro (Anatomía Funcional).
    const activeBreakdown = inheritCandidateBreakdown ? selectedCandidate.breakdown : rawBreakdown;
    const hasBreakdown = activeBreakdown.length > 0;

    const calculateCompTotal = (comp: any) => {
        const cPrice = comp.price_unit ?? comp.unitPrice ?? comp.price ?? 0;
        const cQuantity = comp.quantity ?? comp.yield ?? 1;
        if (comp.unit === '%') return cPrice * (cQuantity / 100);
        return cPrice * cQuantity;
    };

    const breakdownTotal = activeBreakdown.reduce((acc: number, comp: any) => acc + calculateCompTotal(comp), 0);
    const itemTotal = item.item?.unitPrice || 0;
    
    // La divergencia se calcula SOLO contra el sumatorio real del JSON editado activo.
    const realEditedTotal = rawBreakdown.reduce((acc: number, comp: any) => acc + calculateCompTotal(comp), 0);
    const deviation = Math.abs((rawBreakdown.length > 0 ? realEditedTotal : itemTotal) - itemTotal);
    const isDeviated = rawBreakdown.length > 0 && deviation > 0.05; // 5 cents tolerance

    // Recursive calculation for Thermometer (Mo, Mt, Other)
    let calcLabor = 0;
    let calcMaterial = 0;

    activeBreakdown.forEach((parentComp: any) => {
        const parentTotal = calculateCompTotal(parentComp);
        const code = (parentComp.code || '').toLowerCase();

        // Direct Heuristics (Recursos Base)
        if (code.startsWith('mo')) { calcLabor += parentTotal; return; }
        if (code.startsWith('mt')) { calcMaterial += parentTotal; return; }
        if (code.startsWith('mq') || code.startsWith('%')) { return; }

        // Es un "Código Compuesto Grande". Buscamos dentro de allCandidates su ADN.
        const deepCandidate = allCandidates.find((c: any) => c.code === parentComp.code);
        
        if (deepCandidate && deepCandidate.breakdown && deepCandidate.breakdown.length > 0) {
            // Recursividad de 1 Nivel
            let deepLabor = 0;
            let deepMaterial = 0;
            let deepOther = 0;
            
            deepCandidate.breakdown.forEach((sub: any) => {
                const subTotal = calculateCompTotal(sub);
                const subCode = (sub.code || '').toLowerCase();
                if (subCode.startsWith('mo')) deepLabor += subTotal;
                else if (subCode.startsWith('mt')) deepMaterial += subTotal;
                else deepOther += subTotal;
            });
            
            const deepSum = deepLabor + deepMaterial + deepOther;
            if (deepSum > 0) {
                // Distribuimos el peso proporcionalmente al Presupuesto vigente
                calcLabor += parentTotal * (deepLabor / deepSum);
                calcMaterial += parentTotal * (deepMaterial / deepSum);
            }
        } else {
            // Fallback heurístico extremo (Ej: "MO-ESTIMADA")
            if (code.includes('mo') || code.includes('mano')) calcLabor += parentTotal;
            else if (code.includes('mt') || code.includes('mat')) calcMaterial += parentTotal;
        }
    });

    const calcOther = breakdownTotal - calcLabor - calcMaterial;

    const handleBreakdownEdit = (idx: number, field: string, value: string) => {
        if (!item || !item.item) return;
        
        // CORRECCIÓN CLAVE: Usamos 'activeBreakdown' por si el array principal está vacío heredamos del RAG
        let newBreakdown = [...activeBreakdown]; 
        let newValue: any = value;
        
        if (field === 'quantity' || field === 'price') {
            newValue = parseFloat(value) || 0;
            if (field === 'price') newBreakdown[idx].unitPrice = newValue;
            if (field === 'quantity') newBreakdown[idx].yield = newValue;
        }
        
        newBreakdown[idx] = { ...newBreakdown[idx], [field]: newValue };

        const newUnitPrice = newBreakdown.reduce((acc: number, c: any) => acc + calculateCompTotal(c), 0);
        
        onUpdate(item.id, {
            item: {
                ...item.item,
                breakdown: newBreakdown,
                unitPrice: newUnitPrice
            },
            isDirty: true
        });
    };

    const handleAddBreakdownRowClick = () => {
        setIsAddingNewBreakdown(true);
    };

    const handleRemoveBreakdownRow = (idx: number) => {
        if (!item || !item.item) return;
        
        const newBreakdown = [...activeBreakdown];
        newBreakdown.splice(idx, 1);
        
        const newUnitPrice = newBreakdown.reduce((acc: number, c: any) => acc + calculateCompTotal(c), 0);
        
        onUpdate(item.id, {
            item: {
                ...item.item,
                breakdown: newBreakdown,
                unitPrice: newUnitPrice
            },
            isDirty: true
        });
    };

    const handleSelectMaterialSearchDropdown = (sidebarResult: Partial<EditableBudgetLineItem>) => {
        if (!item || !item.item || !sidebarResult.item) return;
        
        const material = sidebarResult.item;
        if (!item || !item.item) return;
        
        // CORRECCIÓN CLAVE: Usamos 'activeBreakdown' si item.breakdown era [] (Estimada)
        const newBreakdown = [...activeBreakdown];

        if (isAddingNewBreakdown) {
            newBreakdown.push({
                code: material.code || 'NUEVO_MAT',
                description: `${material.description}`,
                quantity: 1,
                unit: material.unit || 'ud',
                price: material.unitPrice || 0,
                unitPrice: material.unitPrice || 0,
                price_unit: material.unitPrice || 0,
                totalPrice: material.unitPrice || 0,
                total: material.unitPrice || 0,
                type: 'MATERIAL',
                is_variable: false
            } as any);
        } else if (selectedVariableIndex !== null) {
            const comp = newBreakdown[selectedVariableIndex];
            const updatedComp = {
                ...comp,
                code: material.code,
                description: `${material.description}`,
                unitPrice: material.unitPrice,
                totalPrice: (material.unitPrice || 0) * ((comp as any).quantity || (comp as any).yield || 1),
                unit: material.unit || (comp as any).unit || 'ud',
                note: sidebarResult.originalTask || '',
                is_variable: false,
                was_variable: true
            };
            newBreakdown[selectedVariableIndex] = updatedComp as any;
        }

        const newParentTotal = newBreakdown.reduce((acc: number, c: any) => {
            const cp = c.unitPrice || c.price || 0;
            const cq = c.quantity || c.yield || 1;
            return acc + (c.totalPrice || c.total || (cp * cq));
        }, 0);

        const parentQty = item.item?.quantity || 1;
        const newParentUnitPrice = parentQty > 0 ? newParentTotal / parentQty : 0;

        onUpdate(item.id, {
            item: {
                ...item.item!,
                breakdown: newBreakdown,
                totalPrice: newParentTotal,
                unitPrice: newParentUnitPrice
            },
            isDirty: true
        });

        setSelectedVariableIndex(null);
        setIsAddingNewBreakdown(false);
    };

    const handleApplyFullSubstitute = (c: any) => {
        const extractedPrice = Number(c.unitPrice || c.priceTotal || c.price_total || c.precio_total || 0);

        onUpdate(item.id, {
            item: {
                ...item.item!,
                unitPrice: extractedPrice,
                description: c.description,
                unit: c.unit || item.item?.unit || 'ud',
                code: c.code,
                totalPrice: extractedPrice * (item.item?.quantity || 1),
                breakdown: c.breakdown,
                needsHumanReview: false, // Reset alert if human applied it manually
            },
            isDirty: true
        });
        onOpenChange(false);
        sileo.success({ title: "Sustitución Completa Aplicada", description: `La partida original ha sido reemplazada con el desglose del Catálogo.` });
    };

    const handleApplyPriceOnly = (c: any) => {
        const extractedPrice = Number(c.unitPrice || c.priceTotal || c.price_total || c.precio_total || 0);

        onUpdate(item.id, {
            item: {
                ...item.item!,
                unitPrice: extractedPrice,
                totalPrice: extractedPrice * (item.item?.quantity || 1),
                needsHumanReview: false,
                // Preserve description, original code, and unit from the OCR!
            },
            isDirty: true
        });
        onOpenChange(false);
        sileo.success({ title: "Precio Aplicado Constatado", description: `Se ha inyectado el precio oficial manteniendo el texto normativo del PDF.` });
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-full sm:max-w-[600px] md:max-w-[750px] overflow-y-auto">
                <SheetHeader className="sr-only">
                    <SheetTitle>Auditoría Financiera de la Partida</SheetTitle>
                    <SheetDescription>
                        Desglose de costes, justificación de IA y alternativas para esta partida.
                    </SheetDescription>
                </SheetHeader>

                <div className="flex flex-col gap-6 pt-4 pb-2">
                    {/* FINANCIAL DASHBOARD HEADER */}
                    <div className="flex flex-col bg-gradient-to-br from-white to-slate-50 dark:from-black/40 dark:to-slate-900/40 border border-slate-200/60 dark:border-white/10 rounded-2xl overflow-hidden shadow-sm">
                        {/* Top Banner (Status) */}
                        <div className="bg-indigo-50/50 dark:bg-indigo-900/20 px-4 py-2 flex items-center justify-between border-b border-indigo-100/50 dark:border-indigo-900/30">
                            <h3 className="text-[10px] font-bold uppercase text-indigo-600 dark:text-indigo-400 tracking-widest flex items-center gap-1.5">
                                <Sparkles className="w-3.5 h-3.5" /> Métricas Financieras Activas
                            </h3>
                            <div className="flex items-center gap-2">
                                {/* Fase 5.F — chip del tipo de match del Judge (1:1 / 1:N / from_scratch). */}
                                <MatchKindChip matchKind={item.item.match_kind} />
                                {/* Fase 6.D — badge con los fragments ICL aplicados. */}
                                <AppliedFragmentsBadge fragments={item.item.applied_fragments} />
                                <Badge variant="outline" className="text-[9px] font-mono bg-white dark:bg-black/50 text-slate-500 border-slate-200 dark:border-slate-800">
                                    {item.item.code || 'S/C'}
                                </Badge>
                                <span className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">
                                    {(item.item as any).chapter || "Sin Carpeta"}
                                </span>
                            </div>
                        </div>
                        
                        {/* Grid Metrics */}
                        <div className="grid grid-cols-3 divide-x divide-slate-100 dark:divide-white/5 p-4">
                            <div className="flex flex-col pl-2">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Medición</span>
                                <div className="flex items-baseline gap-1">
                                    <span className="text-xl font-bold text-slate-700 dark:text-slate-200 tabular-nums">
                                        {item.item.quantity || 1}
                                    </span>
                                    <span className="text-sm font-medium text-slate-400">{item.item.unit || 'ud'}</span>
                                </div>
                            </div>
                            
                            <div className="flex flex-col pl-6">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">P. Unitario</span>
                                <span className="text-xl font-bold text-slate-700 dark:text-slate-200 tabular-nums">
                                    {formatCurrency(item.item.unitPrice || 0)}
                                </span>
                            </div>

                            <div className="flex flex-col pl-6">
                                <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mb-1 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> P. Total</span>
                                <span className="text-2xl font-black text-slate-900 dark:text-white tabular-nums tracking-tight">
                                    {formatCurrency((item.item.unitPrice || 0) * (item.item.quantity || 1))}
                                </span>
                            </div>
                        </div>

                        {/* RESTORED Cost Optimization Thermometer with UX Alignment */}
                        <div className="bg-slate-50/50 dark:bg-black/20 px-5 py-4 border-t border-slate-100 dark:border-white/5">
                            <div className="flex items-center justify-between text-[10px] uppercase font-bold tracking-widest text-slate-400 mb-2">
                                <span>Distribución Costes Unitarios</span>
                                {hasBreakdown && breakdownTotal > 0 && (
                                    <span className="text-slate-600 dark:text-slate-300 font-mono">
                                        Total Bruto: {formatCurrency(breakdownTotal)}
                                    </span>
                                )}
                            </div>
                            
                            {hasBreakdown && breakdownTotal > 0 ? (
                                <div className="flex flex-col gap-2">
                                    <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800 shadow-inner group/thermo relative">
                                        <div
                                            className="bg-blue-500 hover:bg-blue-400 transition-all duration-300 hover:scale-y-150 origin-left border-r border-white/20 dark:border-black/20"
                                            style={{ width: `${(calcLabor / breakdownTotal) * 100}%` }}
                                            title={`Mano de Obra: ${formatCurrency(calcLabor)} (${((calcLabor / breakdownTotal) * 100).toFixed(0)}%)`}
                                        />
                                        <div
                                            className="bg-amber-500 hover:bg-amber-400 transition-all duration-300 hover:scale-y-150 origin-right border-r border-white/20 dark:border-black/20"
                                            style={{ width: `${(calcMaterial / breakdownTotal) * 100}%` }}
                                            title={`Materiales: ${formatCurrency(calcMaterial)} (${((calcMaterial / breakdownTotal) * 100).toFixed(0)}%)`}
                                        />
                                        <div
                                            className="bg-emerald-500 flex-1 hover:bg-emerald-400 transition-all duration-300 hover:scale-y-150 origin-right"
                                            title={`Maquinaria/Resto: ${formatCurrency(calcOther)} (${((calcOther / breakdownTotal) * 100).toFixed(0)}%)`}
                                        />
                                    </div>
                                    <div className="flex justify-between text-[9px] font-medium text-slate-500 dark:text-slate-400 tracking-wider">
                                        <span className="flex items-center gap-1">
                                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Mano Obra {((calcLabor / breakdownTotal) * 100).toFixed(0)}%
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <div className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Materiales {((calcMaterial / breakdownTotal) * 100).toFixed(0)}%
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Otros {((calcOther / breakdownTotal) * 100).toFixed(0)}%
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center justify-center p-3 bg-white/50 dark:bg-black/40 rounded-lg border border-dashed border-slate-200 dark:border-slate-800">
                                    <span className="text-xs font-medium text-slate-400 italic flex items-center gap-1.5">
                                        <AlertTriangle className="w-3.5 h-3.5 opacity-50" />
                                        La AI derivó esta partida como unitaria o estimada (Sin distribución detallada).
                                    </span>
                                </div>
                            )}

                            {/* Deviation Warning Box */}
                            {isDeviated && hasBreakdown && (
                                <div className="mt-3 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 text-xs p-2.5 rounded-lg border border-amber-200 dark:border-amber-800/50 flex items-start gap-2">
                                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                                    <div>
                                        <p className="font-semibold mb-0.5">Divergencia de sumatorios detectada</p>
                                        <p className="opacity-80 leading-relaxed text-[11px]">
                                            El sumatorio del descompuesto ({formatCurrency(breakdownTotal)}) difiere del precio oficial de la base ({formatCurrency(itemTotal)}).
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    
                    {/* Fase 5.F — fórmula de conversión de unidad cuando el Judge la aplicó. */}
                    <UnitConversionApplied record={item.item.unit_conversion_applied} />

                    {/* START VIOLET CONTEXT */}
                    {/* Documento Original PDF - Collapsible */}
                    {item.original_item && (
                        <details className="group mb-[-10px] bg-white dark:bg-black/20 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm overflow-hidden">
                            <summary className="cursor-pointer list-none flex items-center justify-between p-3 text-xs font-bold uppercase text-slate-500 bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
                                <span className="flex items-center gap-1.5"><FileText className="w-4 h-4 text-purple-500" /> Transcripción Original del PDF</span>
                                <ChevronDown className="w-4 h-4 group-open:rotate-180 transition-transform duration-300 opacity-50" />
                            </summary>
                            <div className="flex flex-col border-t border-purple-100 dark:border-purple-900/50 p-4 bg-purple-50/50 dark:bg-purple-900/10 shadow-[inset_0_1px_4px_rgba(0,0,0,0.02)] transition-all">
                                <div className="flex items-center justify-between mb-2 pb-2 border-b border-purple-100 dark:border-purple-900/30">
                                    <Badge variant="outline" className="font-mono text-[10px] bg-white dark:bg-black/20 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800 shadow-sm">
                                        {item.original_item.code || 'S/C'}
                                    </Badge>
                                    <span className="font-medium text-[11px] text-purple-700 dark:text-purple-400 bg-white/50 dark:bg-black/20 px-2 py-0.5 rounded-md border border-purple-100 dark:border-purple-800">
                                        Cant: <span className="font-bold text-purple-900 dark:text-purple-200">{item.original_item.quantity || 1} {item.original_item.unit || 'ud'}</span>
                                    </span>
                                </div>
                                <p className="text-xs font-serif italic text-slate-700 dark:text-slate-300 leading-relaxed font-medium mb-1 line-clamp-4">
                                    "{item.original_item.description}"
                                </p>
                                {item.original_item.chapter && (
                                    <span className="text-[9px] uppercase tracking-wider text-slate-400 dark:text-slate-500 mt-2 block">Carpeta: {item.original_item.chapter}</span>
                                )}
                            </div>
                        </details>
                    )}
                    {/* Editable Breakdown Grid - Collapsible & Editable */}
                    {hasBreakdown && (
                        <details open className="group flex flex-col gap-3 bg-white dark:bg-black/20 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm overflow-hidden">
                            <summary className="cursor-pointer list-none flex items-center justify-between p-3 text-xs font-bold uppercase text-slate-500 bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
                                <span className="flex items-center gap-1.5"><ListTree className="w-4 h-4 text-emerald-500" /> Descompuesto Vigente (Editor Activo)</span>
                                <ChevronDown className="w-4 h-4 group-open:rotate-180 transition-transform duration-300 opacity-50" />
                            </summary>
                            <div className="border-t border-slate-200 dark:border-white/10">
                                <div className="grid grid-cols-[1fr_90px_100px_40px] gap-2 p-3 bg-slate-50 dark:bg-black/40 border-b border-slate-100 dark:border-white/5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                    <div>Concepto</div>
                                    <div className="text-right">Rend. / Uds</div>
                                    <div className="text-right">Precio Ud.</div>
                                    <div></div>
                                </div>
                                <div className="flex flex-col divide-y divide-slate-100 dark:divide-white/5">
                                    {activeBreakdown.map((b: any, idx: number) => {
                                        const qty = b.quantity || b.yield || 1;
                                        const price = b.price || b.unitPrice || 0;
                                        const total = qty * price;
                                        const isVar = b.is_variable === true || b.is_variable === 'true' || b.isVariable === true;
                                        
                                        return (
                                            <div key={idx} className={cn(
                                                "grid grid-cols-[1fr_90px_100px_40px] gap-2 px-3 py-2 items-center group transition-colors",
                                                isVar ? "bg-amber-50/50 hover:bg-amber-100/50 dark:bg-amber-900/10 dark:hover:bg-amber-900/20" : "hover:bg-slate-50 dark:hover:bg-white/5"
                                            )}>
                                                <div className="flex flex-col gap-1 pr-2 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <Badge variant="outline" className="font-mono text-[9px] bg-slate-50 dark:bg-black/40 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10">
                                                            {b.code || 'S/C'}
                                                        </Badge>
                                                        {isVar && (
                                                            <Badge variant="outline" className="text-[8px] tracking-widest text-amber-600 bg-amber-100 border-amber-300 dark:bg-amber-900/30 dark:border-amber-700">MARCAJE</Badge>
                                                        )}
                                                    </div>
                                                    <input 
                                                        type="text"
                                                        value={b.description} 
                                                        onChange={(e) => handleBreakdownEdit(idx, 'description', e.target.value)}
                                                        className="text-xs font-medium text-slate-700 dark:text-slate-300 bg-transparent border-dashed border-b border-transparent hover:border-slate-300 dark:hover:border-slate-600 focus:outline-none focus:border-indigo-500 truncate w-full transition-colors"
                                                    />
                                                </div>
                                                <div className="flex items-center justify-end">
                                                    <input 
                                                        type="number" 
                                                        value={qty}
                                                        onChange={(e) => handleBreakdownEdit(idx, 'quantity', e.target.value)}
                                                        className="w-16 text-right text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums bg-transparent border border-slate-200 dark:border-slate-700 rounded px-1 py-0.5 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" 
                                                        step="0.01" 
                                                    />
                                                    <span className="ml-1 text-[10px] text-slate-400">{b.unit || 'ud'}</span>
                                                </div>
                                                <div className="flex flex-col items-end">
                                                    <input 
                                                        type="number" 
                                                        value={price}
                                                        onChange={(e) => handleBreakdownEdit(idx, 'price', e.target.value)}
                                                        className="w-20 text-right text-xs font-semibold text-slate-700 dark:text-slate-200 tabular-nums bg-transparent border border-slate-200 dark:border-slate-700 rounded px-1 py-0.5 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" 
                                                        step="0.01" 
                                                    />
                                                    <span className="text-[9px] font-bold text-indigo-500 tabular-nums mt-0.5" title="Total derivado (Cantidad × Precio Ud)">= {formatCurrency(total)}</span>
                                                </div>
                                                <div className="flex justify-end gap-1">
                                                    {isAdmin && isVar && (
                                                        <Button 
                                                            variant="ghost" 
                                                            size="icon" 
                                                            className="h-8 w-8 text-indigo-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
                                                            onClick={() => setSelectedVariableIndex(idx)}
                                                            title="Sustituir partida en catálogo automáticamente (IA Variable)"
                                                        >
                                                            <Package className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                    <Button 
                                                        variant="ghost" 
                                                        size="icon" 
                                                        className="h-8 w-8 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                                                        onClick={() => handleRemoveBreakdownRow(idx)}
                                                        title="Eliminar concepto del descompuesto"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="p-3 bg-slate-50 dark:bg-black/40 border-t border-slate-100 dark:border-white/5 flex flex-col gap-2">
                                    <div className="flex items-center justify-between">
                                        <Button onClick={handleAddBreakdownRowClick} variant="outline" size="sm" className="h-8 uppercase tracking-wider font-bold text-slate-600 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-400 hover:border-emerald-500 border-dashed text-xs shadow-sm w-full md:w-auto">
                                            <PlusCircle className="w-4 h-4 mr-2" /> Buscar Partidas y Materiales
                                        </Button>
                                    </div>
                                    <span className="text-[10px] text-slate-500 flex items-start gap-1.5 leading-relaxed bg-white/50 dark:bg-black/20 p-2 rounded border border-slate-100 dark:border-white/5">
                                        <Settings2 className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5"/> 
                                        Este botón abrirá el Catálogo Maestro y te permitirá buscar e insertar un recurso, material o subcontrata extra al descompuesto. La recálculo monetario será automático en toda la cadena.
                                    </span>
                                </div>
                            </div>
                        </details>
                    )}

                    {/* AI Reasoning Panel - Collapsible */}
                    <details className="group bg-slate-50 dark:bg-black/20 rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden shadow-sm" open={hasAIResolution}>
                        <summary className="cursor-pointer list-none flex items-center justify-between p-3 text-xs font-bold uppercase text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
                            <span className="flex items-center gap-1.5">
                                <AlertTriangle className={cn("w-4 h-4", hasAIResolution ? "text-amber-500" : "text-slate-400")} /> 
                                {hasAIResolution ? "Dictamen del Juez Cognitivo" : "Trazabilidad de la Partida"}
                            </span>
                            <ChevronDown className="w-4 h-4 group-open:rotate-180 transition-transform duration-300 opacity-50" />
                        </summary>
                        <div className="p-4 border-t border-slate-200 dark:border-white/10">
                            <p className={cn(
                                "text-sm font-medium leading-relaxed italic border-l-2 pl-3 py-1",
                                hasAIResolution ? "text-slate-700 dark:text-slate-300 border-indigo-400" : "text-slate-500 dark:text-slate-400 border-slate-300 dark:border-slate-700"
                            )}>
                                "{aiReasoning}"
                            </p>
                        </div>
                    </details>

                    {/* Candidato Ganador del RAG - Collapsible */}
                    <details className="group mb-2 bg-emerald-50/50 dark:bg-emerald-900/10 rounded-xl border border-emerald-200 dark:border-emerald-900/50 shadow-sm overflow-hidden transition-all hover:border-emerald-300">
                        <summary className="cursor-pointer list-none flex items-center justify-between p-3 text-xs font-bold uppercase text-slate-500 hover:bg-emerald-100/30 dark:hover:bg-emerald-900/20 transition-colors">
                            <span className="flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-emerald-500" /> Candidato Base Seleccionado (Catálogo)</span>
                            <ChevronDown className="w-4 h-4 group-open:rotate-180 transition-transform duration-300 opacity-50" />
                        </summary>
                        <div className="flex flex-col p-4 border-t border-emerald-100 dark:border-emerald-900/30">
                            {(() => {
                                // Extract the winning candidate from AI Resolution (Python zero-leak saves it here)
                                const winner = item.item?.aiResolution?.selected_candidate || (item.item as any)?.ai_resolution?.selected_candidate;
                                const isEstimated = item.item?.aiResolution?.is_estimated || (item.item as any)?.ai_resolution?.is_estimated;
                                
                                if (winner) {
                                    return (
                                        <>
                                            <div className="flex items-center justify-between mb-2">
                                                <Badge variant="outline" className="font-mono text-[10px] bg-white dark:bg-black/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800">
                                                    {winner.code || winner.id || 'SIN CÓDIGO'}
                                                </Badge>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] uppercase text-emerald-600 dark:text-emerald-400 font-semibold tracking-widest bg-emerald-100/50 dark:bg-emerald-800/30 px-1.5 py-0.5 rounded">Ganador</span>
                                                    <span className="font-bold text-sm text-emerald-700 dark:text-emerald-400 shadow-sm bg-white dark:bg-emerald-950/50 px-2 py-0.5 rounded-md border border-emerald-100 dark:border-emerald-900/50">
                                                        {formatCurrency(winner.priceTotal || winner.unitPrice || winner.price || 0)}/{winner.unit || 'ud'}
                                                    </span>
                                                </div>
                                            </div>
                                            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-serif italic mb-3">
                                                "{winner.description}"
                                            </p>
                                        </>
                                    );
                                } else if (isEstimated) {
                                    return (
                                        <div className="text-amber-700 dark:text-amber-400 text-sm mb-3 font-medium flex flex-col gap-2 bg-amber-50 dark:bg-amber-900/10 p-3 rounded-lg border border-amber-200 dark:border-amber-900/30">
                                            <span>No existe un candidato ganador puro en Catálogo.</span>
                                            <span className="text-xs font-normal">La IA estimó esta partida bajo el modo "Partida Alzada Analítica" (is_estimated: true) o usó heurística directa.</span>
                                        </div>
                                    );
                                } else {
                                    // Phase 16 — sin winner del catálogo. Diferenciar por match_kind
                                    // (composición 1:N vs estimación from_scratch). Antes este branch
                                    // mostraba la descripción de la partida como si fuera el candidato,
                                    // confundiendo al aparejador.
                                    const matchKind = item.item?.match_kind;
                                    if (matchKind === '1:N') {
                                        const componentCount = (item.item?.breakdown || []).length;
                                        return (
                                            <div className="text-blue-700 dark:text-blue-400 text-sm mb-3 font-medium flex flex-col gap-2 bg-blue-50 dark:bg-blue-900/10 p-3 rounded-lg border border-blue-200 dark:border-blue-900/30">
                                                <span>Composición 1:N{componentCount > 0 ? ` — ${componentCount} componentes del catálogo` : ''}.</span>
                                                <span className="text-xs font-normal">El precio se construye sumando varios componentes del catálogo COAATMCA. No hay un candidato base único. Ver "Desglose Aplicado" abajo para los componentes individuales.</span>
                                            </div>
                                        );
                                    }
                                    if (matchKind === 'from_scratch') {
                                        return (
                                            <div className="text-amber-700 dark:text-amber-400 text-sm mb-3 font-medium flex flex-col gap-2 bg-amber-50 dark:bg-amber-900/10 p-3 rounded-lg border border-amber-200 dark:border-amber-900/30">
                                                <span>Estimación libre (from scratch).</span>
                                                <span className="text-xs font-normal">Ningún candidato del catálogo encajaba; la IA estimó el precio basándose en heurística sectorial (raw PEM target).</span>
                                            </div>
                                        );
                                    }
                                    // Caso defensivo (datos antiguos sin match_kind o valor desconocido)
                                    return (
                                        <div className="text-slate-500 dark:text-slate-400 text-sm mb-3 font-medium flex flex-col gap-2 bg-slate-50 dark:bg-slate-900/10 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                                            <span>Sin candidato del catálogo seleccionado.</span>
                                            <span className="text-xs font-normal">El registro de razonamiento no especifica el tipo de match. Posible budget legacy.</span>
                                        </div>
                                    );
                                }
                            })()}
                            
                            {/* Accordion for Winner Breakdown (Original from Catalog) - Replaced old item.item.breakdown duplicate */}
                            {(() => {
                                const winner = item.item?.aiResolution?.selected_candidate || (item.item as any)?.ai_resolution?.selected_candidate;
                                // Robust lookup from allCandidates to display the breakdown correctly in UI
                                const winnerCandidateObj = winner ? (typeof winner === 'string' ? allCandidates.find((c: any) => c.code === winner) : winner) : null;
                                
                                if (winnerCandidateObj && winnerCandidateObj.breakdown && winnerCandidateObj.breakdown.length > 0) {
                                    return (
                                        <details className="mt-3 group/breakdown">
                                            <summary className="text-[10px] font-bold text-slate-400 hover:text-emerald-600 uppercase tracking-widest cursor-pointer select-none outline-none list-none flex items-center justify-between border-t border-emerald-100 dark:border-emerald-900/30 pt-3">
                                                <span>Ver Descompuesto Normativo (Base de Precios)</span>
                                                <span className="text-slate-400 font-normal opacity-70 group-open/breakdown:rotate-180 transition-transform">▼</span>
                                            </summary>
                                            <div className="flex flex-col gap-1.5 mt-2 bg-white dark:bg-black/20 p-2.5 rounded-lg border border-emerald-100 dark:border-emerald-900/30">
                                                {winnerCandidateObj.breakdown.map((b: any, bIdx: number) => {
                                                    const qty = b.quantity || b.yield || 1;
                                                    const price = b.price || b.unitPrice || 0;
                                                    return (
                                                        <div key={bIdx} className="flex justify-between items-start gap-2 text-[10px]">
                                                            <div className="flex flex-col flex-1">
                                                                <span className="text-slate-700 dark:text-slate-300 line-clamp-2" title={b.description}>{b.description}</span>
                                                                {(b.is_variable === true || b.is_variable === 'true' || b.isVariable === true) && (
                                                                    <Badge variant="outline" className="text-[7px] tracking-widest text-amber-500 border-amber-200 bg-amber-50 w-fit mt-0.5 px-1 py-0 h-3 leading-none">VAR</Badge>
                                                                )}
                                                            </div>
                                                            <div className="flex flex-col items-end shrink-0">
                                                                <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap tabular-nums">
                                                                    {qty} {b.unit} <span className="text-slate-300 text-[9px]">x</span> {formatCurrency(price)}
                                                                </span>
                                                                <span className="text-emerald-700 dark:text-emerald-400 font-medium tabular-nums shadow-sm bg-white dark:bg-emerald-950/50 px-1 rounded border border-emerald-50 dark:border-emerald-900/30 mt-0.5">
                                                                    {formatCurrency(qty * price)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </details>
                                    );
                                }
                                return null;
                            })()}
                        </div>
                    </details>

                    {/* Candidates - Collapsible */}
                    {hasCandidates ? (
                        <details className="group bg-white dark:bg-black/20 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm overflow-hidden mb-6">
                            <summary className="cursor-pointer list-none flex items-center justify-between p-3 text-xs font-bold uppercase text-slate-500 bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
                                <span className="flex items-center gap-1.5"><ListTree className="w-3 h-3" /> Partidas Alternativas (Catálogo)</span>
                                <ChevronDown className="w-4 h-4 group-open:rotate-180 transition-transform duration-300 opacity-50" />
                            </summary>
                            <div className="flex flex-col gap-3 p-4 border-t border-slate-200 dark:border-white/10">
                                {allCandidates.map((c: any, index: number) => {
                                    const cPrice = Number(c.unitPrice || c.priceTotal || c.price_total || c.precio_total || 0);
                                    return (
                                        <div key={c.code || index} className="flex flex-col border border-slate-200 dark:border-white/10 rounded-xl p-3 transition-all hover:border-indigo-300 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 bg-white dark:bg-zinc-950 shadow-sm">
                                            <div className="flex items-center justify-between mb-2">
                                                <Badge variant="outline" className="font-mono text-[10px] bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-300">{c.code || 'SIN CODIGO'}</Badge>
                                                <span className="font-bold text-sm text-indigo-700 dark:text-indigo-400">{formatCurrency(cPrice)}/{c.unit || 'ud'}</span>
                                            </div>
                                            {/* Fase 5.F — score + rejected_reason + kind (solo si el backend los aporta). */}
                                            <div className="mb-2">
                                                <CandidateMetaBadges candidate={c} />
                                            </div>
                                            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-1">{c.description}</p>
                                            
                                            {c.breakdown && c.breakdown.length > 0 && (
                                                <details className="mb-4 group/breakdown">
                                                    <summary className="text-[10px] font-bold text-slate-400 hover:text-indigo-500 uppercase tracking-widest cursor-pointer select-none outline-none list-none flex items-center justify-between border-t border-slate-100 dark:border-white/5 pt-2 mt-2">
                                                        <span>Ver Descompuesto Oficial</span>
                                                        <span className="text-slate-400 font-normal opacity-70 group-open/breakdown:rotate-180 transition-transform">▼</span>
                                                    </summary>
                                                    <div className="flex flex-col gap-1.5 mt-2 bg-slate-50 dark:bg-black/20 p-2.5 rounded-lg border border-slate-200/50 dark:border-white/5">
                                                        {c.breakdown.map((b: any, bIdx: number) => {
                                                            const qty = b.quantity || b.yield || 1;
                                                            const price = b.price || b.unitPrice || 0;
                                                            return (
                                                                <div key={bIdx} className="flex justify-between items-start gap-2 text-[10px]">
                                                                    <div className="flex flex-col flex-1">
                                                                        <span className="text-slate-700 dark:text-slate-300 line-clamp-2" title={b.description}>{b.description}</span>
                                                                        {(b.is_variable === true || b.is_variable === 'true' || b.isVariable === true) && (
                                                                            <Badge variant="outline" className="text-[7px] tracking-widest text-amber-500 border-amber-200 bg-amber-50 w-fit mt-0.5 px-1 py-0 h-3 leading-none">VAR</Badge>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex flex-col items-end shrink-0">
                                                                        <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap tabular-nums">
                                                                            {qty} {b.unit} <span className="text-slate-300 text-[9px]">x</span> {formatCurrency(price)}
                                                                        </span>
                                                                        <span className="text-slate-600 dark:text-slate-400 font-medium tabular-nums shadow-sm bg-white dark:bg-black px-1 rounded border border-slate-100 dark:border-white/5 mt-0.5">
                                                                            {formatCurrency(qty * price)}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </details>
                                            )}
                                            
                                            {/* DUAL ACTION BUTTONS */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 border-t border-slate-100 dark:border-white/5 pt-3">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-8 text-[11px] font-semibold text-slate-600 dark:text-slate-300 border-dashed hover:bg-slate-50"
                                                    onClick={() => handleApplyPriceOnly(c)}
                                                >
                                                    Extraer Solo Precio
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-8 text-[11px] font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/60 dark:text-indigo-300"
                                                    onClick={() => handleApplyFullSubstitute(c)}
                                                >
                                                    Sustituir Partida Completa
                                                </Button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </details>
                    ) : (
                        <div className="text-sm text-slate-500 bg-slate-50 dark:bg-black/20 font-medium italic text-center p-4 border border-dashed border-slate-200 dark:border-white/10 rounded-xl mb-6 flex flex-col items-center justify-center gap-2">
                            <Package className="w-5 h-5 opacity-50 mb-1" />
                            {hasAIResolution 
                                ? "No se recuperaron alternativas en Bases de Datos para esta partida."
                                : "Partida generada por estimación o inserción manual directa sin alternativas RAG transversales."
                            }
                        </div>
                    )}

                    {/* Copilot Interface Container - MOVED TO BOTTOM */}
                    {isAdmin && (
                        <div className="mt-4 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/30 shadow-inner">
                            <div className="flex items-center gap-2 mb-3">
                                <Bot className="w-4 h-4 text-indigo-500" />
                                <span className="text-xs font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-widest">Aparejador Copilot</span>
                            </div>
                            <div className="flex gap-2">
                                <input 
                                    type="text" 
                                    placeholder="Ej: Suma un 10% a la mano de obra, Cambia los sacos de cemento..." 
                                    className="flex-1 text-sm bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500/50"
                                    disabled
                                />
                                <Button disabled variant="default" className="bg-indigo-600 hover:bg-indigo-700 text-white shrink-0 shadow-sm">
                                    <Send className="w-4 h-4 mr-2" />
                                    Ejecutar
                                </Button>
                            </div>
                            <p className="text-[10px] text-slate-500 mt-2 italic flex items-center gap-1">
                                <Sparkles className="w-3 h-3" /> Escribe instrucciones en lenguaje natural para que la IA recalcule el desglose instantáneamente (Próximamente).
                            </p>
                        </div>
                    )}
                </div>
            </SheetContent>

            {/* Sub-modal Material Catalog Search unificado */}
            <Dialog 
                open={selectedVariableIndex !== null || isAddingNewBreakdown} 
                onOpenChange={(open) => {
                    if (!open) {
                        setSelectedVariableIndex(null);
                        setIsAddingNewBreakdown(false);
                    }
                }}
            >
                <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0 bg-white dark:bg-zinc-950 border-slate-200 dark:border-white/10" aria-describedby={undefined}>
                    <DialogHeader className="p-4 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-zinc-900/50">
                        <DialogTitle className="text-lg font-semibold flex items-center gap-2 text-slate-800 dark:text-white">
                            <Package className="w-5 h-5 text-indigo-500" />
                            Buscar Partidas y Materiales
                        </DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 overflow-hidden p-4 bg-slate-50/50 dark:bg-zinc-900/50">
                        <SemanticCatalogSidebar onAddItem={handleSelectMaterialSearchDropdown} />
                    </div>
                </DialogContent>
            </Dialog>

            {/* Fase 6.B — captura del motivo de la corrección */}
            {item?.item && aiProposedRef.current && (
                <CorrectionCaptureDialog
                    open={captureOpen}
                    onOpenChange={setCaptureOpen}
                    context={{
                        budgetId: (item as any).budgetId || (item.item as any).budgetId || '',
                        chapter:
                            (item.item as any).chapter ||
                            item.original_item?.chapter ||
                            'General',
                        originalDescription:
                            item.originalTask ||
                            item.original_item?.description ||
                            item.item.description ||
                            '',
                        originalQuantity: item.original_item?.quantity ?? item.item.quantity ?? null,
                        originalUnit: item.original_item?.unit ?? item.item.unit ?? null,
                        aiProposedPrice: aiProposedRef.current.snapshot.unitPrice,
                        aiProposedCandidateId:
                            (item.item as any)?.aiResolution?.selected_candidate?.code ||
                            (item.item as any)?.ai_resolution?.selected_candidate?.code ||
                            null,
                        aiReasoning: aiReasoning || null,
                        correctedPrice: item.item.unitPrice ?? null,
                        correctedUnit: item.item.unit ?? null,
                        correctedByUserId: authUser?.uid ?? null,
                    }}
                />
            )}
        </Sheet>
    );
}

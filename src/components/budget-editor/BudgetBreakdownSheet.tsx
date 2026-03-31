import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { EditableBudgetLineItem } from "@/types/budget-editor";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Hammer, Package, AlertTriangle, Sparkles, Wand2 } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { MaterialCatalogSearch } from "./material-catalog-search";
import { MaterialItem } from "@/backend/material-catalog/domain/material-item";
import { Bot, Send, Replace, Loader2, CheckCircle2, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";

interface BudgetBreakdownSheetProps {
    item: EditableBudgetLineItem | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onUpdate: (id: string, changes: Partial<EditableBudgetLineItem>) => void;
    isAdmin?: boolean;
}

export function BudgetBreakdownSheet({ item, open, onOpenChange, onUpdate, isAdmin = true }: BudgetBreakdownSheetProps) {
    const [selectedVariableIndex, setSelectedVariableIndex] = useState<number | null>(null);
    const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

    if (!item) return null;

    const breakdown = item.item?.breakdown || [];
    const hasBreakdown = breakdown.length > 0;

    // Calculate total from breakdown to compare
    const calculateCompTotal = (comp: any) => {
        const cPrice = comp.price_unit ?? comp.unitPrice ?? comp.price ?? 0;
        const cQuantity = comp.quantity ?? comp.yield ?? 1;
        if (comp.unit === '%') {
            return cPrice * (cQuantity / 100);
        }
        return cPrice * cQuantity;
    };

    const breakdownTotal = breakdown.reduce((acc, comp: any) => acc + calculateCompTotal(comp), 0);
    const itemTotal = item.item?.unitPrice || 0;
    const deviation = Math.abs(breakdownTotal - itemTotal);
    const isDeviated = deviation > 0.05; // 5 cents tolerance

    // Thermometer calculations
    const calcLabor = breakdown.filter((c: any) => c.code?.startsWith('mo')).reduce((acc, c) => acc + calculateCompTotal(c), 0);
    const calcMaterial = breakdown.filter((c: any) => c.code?.startsWith('mt')).reduce((acc, c) => acc + calculateCompTotal(c), 0);
    const calcOther = breakdownTotal - calcLabor - calcMaterial;

    const handleSelectVariableMaterial = (material: MaterialItem) => {
        if (!item || selectedVariableIndex === null) return;

        const newBreakdown = [...(item.item?.breakdown || [])];
        const comp = newBreakdown[selectedVariableIndex];

        const updatedComp = {
            ...comp,
            code: material.sku,
            description: `${material.name}`,
            unitPrice: material.price,
            totalPrice: material.price * ((comp as any).quantity || (comp as any).yield || 1),
            unit: material.unit || (comp as any).unit || 'ud',
            note: material.description // Store full desc as note
        };

        newBreakdown[selectedVariableIndex] = updatedComp;

        // Recalculate parent
        const newParentTotal = newBreakdown.reduce((acc, c: any) => {
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
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-full sm:max-w-4xl overflow-y-auto p-0 gap-0 flex flex-col pt-10 sm:pt-0">
                {/* Header Style "Top 0" - Full Width */}
                <div className="bg-slate-50 dark:bg-zinc-900 border-b border-slate-200 dark:border-white/10 p-6 pb-4">
                    <SheetHeader className="text-left space-y-4">
                        <div className="flex items-start justify-between gap-4">
                            <div className="space-y-1">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="font-mono text-xs font-bold text-slate-500">{item.item?.code || 'SIN CÓDIGO'}</span>
                                    <span className="text-slate-300">•</span>
                                    {item.type === 'MATERIAL' ? (
                                        <Badge variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-100 text-[10px] px-1 py-0 h-5">MATERIAL</Badge>
                                    ) : (
                                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-5 text-slate-500">PARTIDA</Badge>
                                    )}
                                </div>
                                <div className="relative group/desc">
                                    <SheetTitle
                                        className="text-lg font-bold leading-tight text-slate-800 dark:text-white pr-4 mt-2 mb-1 cursor-pointer"
                                        onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                                    >
                                        {(() => {
                                            const descText = item.originalTask || item.item?.description || 'Detalle de Partida';
                                            if (descText.length <= 150) return descText;
                                            return isDescriptionExpanded ? descText : descText.substring(0, 150) + '...';
                                        })()}
                                    </SheetTitle>

                                    {((item.originalTask || item.item?.description || '').length > 150) && (
                                        <button
                                            onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                                            className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 flex items-center gap-1 bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/40 px-2 py-0.5 rounded-full transition-colors mt-2"
                                        >
                                            {isDescriptionExpanded ? (
                                                <><ChevronUp className="w-3 h-3" /> Ver menos</>
                                            ) : (
                                                <><ChevronDown className="w-3 h-3" /> Expandir título</>
                                            )}
                                        </button>
                                    )}
                                    <SheetDescription className="sr-only">
                                        Descripción detallada de la partida (Accesibilidad)
                                    </SheetDescription>
                                </div>

                                {item.item?.note && (
                                    <div className="mt-4 flex items-start gap-2 bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-900/30 p-3 rounded-lg w-full">
                                        <Sparkles className="w-4 h-4 text-indigo-600 mt-0.5 flex-shrink-0" />
                                        <p className="text-xs text-indigo-800 dark:text-indigo-300 font-medium">
                                            {item.item.note}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Summary Cards and Thermometer */}
                        <div className="flex items-center justify-between pt-2">
                            <div className="flex flex-col">
                                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Precio Unitario</span>
                                <span className="text-3xl font-bold text-slate-900 dark:text-white">
                                    {formatCurrency(item.item?.unitPrice || 0)}
                                    <span className="text-sm font-normal text-slate-400 ml-1">/ {item.item?.unit}</span>
                                </span>
                            </div>

                            {/* Cost Optimization Thermometer */}
                            {hasBreakdown && breakdownTotal > 0 && (
                                <div className="flex flex-col items-end gap-1">
                                    <span className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider flex items-center gap-1">
                                        <TrendingUp className="w-3 h-3" /> Distribución Costes
                                    </span>
                                    <div className="flex h-2 w-32 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-800">
                                        <div
                                            className="bg-blue-500 hover:bg-blue-400 transition-all hover:scale-y-150 origin-left"
                                            style={{ width: `${(calcLabor / breakdownTotal) * 100}%` }}
                                            title={`Mano Obra: ${((calcLabor / breakdownTotal) * 100).toFixed(0)}%`}
                                        />
                                        <div
                                            className="bg-amber-500 hover:bg-amber-400 transition-all hover:scale-y-150 origin-right"
                                            style={{ width: `${(calcMaterial / breakdownTotal) * 100}%` }}
                                            title={`Material: ${((calcMaterial / breakdownTotal) * 100).toFixed(0)}%`}
                                        />
                                        <div
                                            className="bg-emerald-500 flex-1 hover:bg-emerald-400 transition-all hover:scale-y-150"
                                            title={`Maquinaria/Resto: ${((calcOther / breakdownTotal) * 100).toFixed(0)}%`}
                                        />
                                    </div>
                                    <div className="flex justify-between w-32 text-[9px] text-slate-400 mt-0.5 px-0.5">
                                        <span>Mano Obra</span>
                                        <span>Material</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </SheetHeader>
                </div>

                <ScrollArea className="flex-1">
                    <div className="p-6 space-y-6">
                        {/* Breakdown Grid (Syncing layout with PriceItemDetail) */}
                        <div>
                            <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-4">
                                Cost Breakdown
                            </h3>

                            {hasBreakdown ? (
                                <div className="space-y-1">
                                    <div className="grid grid-cols-12 text-[10px] text-muted-foreground uppercase tracking-wider pb-2 border-b border-border px-2 font-medium">
                                        <div className="col-span-2">Code</div>
                                        <div className="col-span-6">Description</div>
                                        <div className="col-span-2 text-right">Qty</div>
                                        <div className="col-span-1 text-right">Price</div>
                                        <div className="col-span-1 text-right">Total</div>
                                    </div>
                                    {breakdown.map((comp: any, idx) => {
                                        const cPrice = comp.price_unit ?? comp.unitPrice ?? comp.price ?? 0;
                                        const cQuantity = comp.quantity ?? comp.yield ?? 1;
                                        const computedTotal = calculateCompTotal(comp);
                                        const cDesc = comp.description || comp.concept || 'Sin descripción';
                                        const isVariable = comp.is_variable === true;

                                        return (
                                            <div key={idx} className={cn(
                                                "grid grid-cols-12 text-sm pt-2 pb-2 px-2 rounded-lg transition-all items-center border mb-1",
                                                isVariable ? "bg-amber-500/5 hover:bg-amber-500/10 border-amber-500/30" : "bg-transparent hover:bg-muted/50 border-transparent hover:border-border"
                                            )}>
                                                <div className="col-span-2 font-mono text-primary text-xs">
                                                    {comp.code || '---'}
                                                    {isVariable && (
                                                        <Badge variant="outline" className="ml-2 text-[9px] h-4 px-1 py-0 bg-amber-500/10 text-amber-600 border-amber-500/40">
                                                            VARIABLE
                                                        </Badge>
                                                    )}
                                                </div>
                                                <div className="col-span-6 text-foreground/80 text-xs truncate pr-4 flex items-center justify-between" title={cDesc}>
                                                    <span className={isVariable ? 'font-medium text-amber-900 dark:text-amber-100 flex items-center gap-2' : 'flex items-center gap-2'}>
                                                        {cDesc}
                                                        {comp.waste ? <span className="text-[9px] text-amber-600 bg-amber-50 px-1 py-0.5 rounded border border-amber-100">Merma {comp.waste * 100}%</span> : null}
                                                    </span>
                                                    {isVariable && isAdmin && (
                                                        <Button
                                                            variant="secondary"
                                                            size="sm"
                                                            className="h-6 text-[10px] px-2 gap-1 bg-amber-100 hover:bg-amber-200 text-amber-700 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                                                            onClick={() => setSelectedVariableIndex(idx)}
                                                        >
                                                            <Sparkles className="w-3 h-3" />
                                                            Sustituir con IA
                                                        </Button>
                                                    )}
                                                    {isVariable && !isAdmin && (
                                                        <Badge className="bg-amber-500 text-white hover:bg-amber-500 h-5 px-1.5 text-[9px]">Premium</Badge>
                                                    )}
                                                </div>
                                                <div className="col-span-2 text-right text-muted-foreground font-mono text-xs">
                                                    {cQuantity.toFixed(3)} {comp.unit || 'ud'}
                                                </div>
                                                <div className="col-span-1 text-right text-muted-foreground font-mono text-xs">
                                                    {formatCurrency(cPrice)}
                                                </div>
                                                <div className="col-span-1 text-right text-foreground font-mono text-xs font-medium">
                                                    {formatCurrency(computedTotal)}
                                                </div>
                                            </div>
                                        );
                                    })}

                                    <div className="grid grid-cols-12 text-sm pt-4 pb-2 px-2 items-center border-t-2 border-border mt-2">
                                        <div className="col-span-11 text-right text-xs font-bold text-slate-700 uppercase tracking-wider pr-4">SUMA DE COSTES</div>
                                        <div className="col-span-1 text-right text-sm font-bold text-neutral-900 dark:text-white font-mono break-words whitespace-nowrap">
                                            {formatCurrency(breakdownTotal)}
                                        </div>
                                    </div>
                                </div>
                            ) : (!hasBreakdown && item.item?.candidates && item.item.candidates.length > 0) ? (
                                <div className="space-y-4">
                                    <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl p-4 flex flex-col gap-2">
                                        <div className="flex items-center gap-2 text-amber-800 dark:text-amber-400 font-semibold">
                                            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                                            <span>Partida Pendiente de Determinación</span>
                                        </div>
                                        <p className="text-sm text-amber-700/80 dark:text-amber-400/80">
                                            El Gestor de IA ha detectado la necesidad de esta partida, pero ha preferido no arriesgarse a asignarte un precio automático por existir demasiada variabilidad. Aquí tienes las opciones oficiales recuperadas del RAG:
                                        </p>
                                    </div>

                                    <div className="grid gap-3">
                                        {item.item.candidates.map((candidate: any, idx) => (
                                            <div
                                                key={candidate.code}
                                                className="group relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card hover:border-purple-300 dark:hover:border-purple-800 hover:shadow-sm transition-all text-sm"
                                            >
                                                <div className="flex flex-col gap-1 w-full">
                                                    <div className="flex items-center justify-between">
                                                        <span className="font-mono text-xs font-bold text-primary">{candidate.code}</span>
                                                        <span className="font-bold text-sm text-foreground">{formatCurrency(candidate.unitPrice || candidate.price || 0)} / {candidate.unit || 'ud'}</span>
                                                    </div>
                                                    <span className="text-xs text-muted-foreground">{candidate.description || candidate.concept}</span>
                                                </div>
                                                <Button size="sm" variant="outline" className="shrink-0" onClick={() => {}}>
                                                    Elegir
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-12 px-4 bg-slate-50 dark:bg-zinc-900 rounded-xl border border-dashed border-slate-200 dark:border-white/10">
                                    <Hammer className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
                                    <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Sin desglose disponible</p>
                                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-[200px] mx-auto">Esta partida no tiene elementos asociados o candidatos.</p>
                                </div>
                            )}

                            {isDeviated && hasBreakdown && (
                                <div className="mt-4 flex items-start gap-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/20 p-4 rounded-lg">
                                    <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                                    <div className="space-y-1">
                                        <p className="text-sm font-bold text-amber-800 dark:text-amber-500">Desviación del {Math.round((deviation / itemTotal) * 100)}%</p>
                                        <p className="text-xs text-amber-700 dark:text-amber-500 leading-relaxed">
                                            El precio unitario manual ({formatCurrency(itemTotal)}) no coincide con la suma de los costes ({formatCurrency(breakdownTotal)}).
                                        </p>
                                    </div>
                                </div>
                            )}

                                    {/* AI Co-Pilot Command Interface */}
                                    <Separator className="bg-border mt-8 mb-6 dark:border-white/10" />

                                    <div className="bg-purple-50/50 dark:bg-purple-950/10 rounded-xl p-4 border border-purple-100 dark:border-purple-900/30 flex items-start gap-4">
                                        <div className="p-2.5 bg-purple-500/10 rounded-xl shrink-0 mt-0.5 border border-purple-500/20">
                                            <Bot className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                                        </div>
                                        <div className="flex-1 space-y-3">
                                            <div>
                                                <h4 className="text-sm font-bold text-purple-900 dark:text-purple-300 flex items-center gap-2">
                                                    Aparejador Copilot
                                                    {isAdmin ? (
                                                        <Badge variant="secondary" className="bg-purple-100 text-purple-700 hover:bg-purple-100 text-[9px] px-1.5 py-0 h-4">BETA</Badge>
                                                    ) : (
                                                        <Badge variant="default" className="bg-gradient-to-r from-purple-500 to-indigo-500 text-white hover:from-purple-500 text-[9px] px-1.5 py-0 h-4 shadow-sm border-none">PREMIUM</Badge>
                                                    )}
                                                </h4>
                                                <p className="text-xs text-purple-700/70 dark:text-purple-300/70 mt-0.5">
                                                    Pide cambios en la partida: altera materiales, ajusta rendimientos o corrige textos.
                                                </p>
                                            </div>
                                            {isAdmin ? (
                                                <div className="relative group">
                                                    <input
                                                        type="text"
                                                        placeholder="Ej. 'Cambia el yeso por uno hidrófugo y añade 15% más de tiempo de obra...'"
                                                        className="w-full bg-white dark:bg-black/40 border border-purple-200 dark:border-purple-800/50 hover:border-purple-300 rounded-xl py-3 pl-4 pr-12 text-sm focus:ring-2 focus:ring-purple-500/50 outline-none text-foreground placeholder:text-muted-foreground/50 shadow-sm transition-all relative z-10"
                                                    />
                                                    <div className="absolute inset-0 bg-gradient-to-r from-purple-500/0 via-purple-500/5 to-purple-500/0 rounded-xl blur-sm opacity-0 group-focus-within:opacity-100 transition-opacity" />
                                                    <button className="absolute right-2 top-1/2 -translate-y-1/2 text-white bg-purple-600 hover:bg-purple-700 p-2 rounded-lg shadow-sm transition-all z-20 group-focus-within:scale-105">
                                                        <Send className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="relative overflow-hidden group">
                                                    <div className="w-full bg-white/50 dark:bg-black/20 border border-purple-200/50 dark:border-purple-800/30 rounded-xl py-3 px-4 text-sm text-purple-900/40 dark:text-purple-300/40 flex items-center justify-between pointer-events-none">
                                                        <span>Funcionalidad reservada para usuarios Premium...</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                </div>
                </ScrollArea>
            </SheetContent>

            <MaterialCatalogSearch
                open={selectedVariableIndex !== null}
                onOpenChange={(v) => !v && setSelectedVariableIndex(null)}
                onSelect={handleSelectVariableMaterial}
            />
        </Sheet>
    );
}

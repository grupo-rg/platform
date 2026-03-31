import { BudgetBreakdownComponent } from "@/backend/budget/domain/budget";
import { AlertCircle, ArrowRight, Hammer, Package, Percent, Repeat } from "lucide-react";
import { useState } from "react";
import { cn, formatCurrency } from "@/lib/utils";
import { MaterialPicker } from "./MaterialPicker";
import { MaterialItem } from "@/backend/material-catalog/domain/material-item";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface BudgetPartidaBreakdownProps {
    breakdown: BudgetBreakdownComponent[];
    isRealCost?: boolean;
    note?: string;
    onBreakdownChange?: (newBreakdown: BudgetBreakdownComponent[]) => void;
}

export function BudgetPartidaBreakdown({ breakdown, isRealCost, note, onBreakdownChange }: BudgetPartidaBreakdownProps) {
    const [pickerOpen, setPickerOpen] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

    if (!breakdown || breakdown.length === 0) return null;

    const laborTotal = breakdown.filter(c => c.type === 'LABOR' || c.type === 'MACHINERY').reduce((acc, c) => acc + c.total, 0);
    const materialTotal = breakdown.filter(c => c.type === 'MATERIAL').reduce((acc, c) => acc + c.total, 0);
    // const total = laborTotal + materialTotal; // Unused variable

    const handleSwapClick = (index: number) => {
        setSelectedIndex(index);
        setPickerOpen(true);
    };

    const handleMaterialSelect = (material: MaterialItem) => {
        if (selectedIndex === null) return;

        const updatedBreakdown = [...breakdown];
        const originalItem = updatedBreakdown[selectedIndex];

        // Calculate new total based on yield and waste
        // Total = Price * Yield * (1 + Waste)
        const waste = originalItem.waste || 0;
        const yieldValue = originalItem.yield || 1; // Default yield to 1 if undefined
        const newTotal = material.price * yieldValue * (1 + waste);

        updatedBreakdown[selectedIndex] = {
            ...originalItem,
            concept: material.name,
            price: material.price,
            total: newTotal,
            isSubstituted: true,
        };

        if (onBreakdownChange) {
            onBreakdownChange(updatedBreakdown);
        }
        setSelectedIndex(null);
    };

    // Find name for picker initial search
    const currentMaterialName = selectedIndex !== null ? breakdown[selectedIndex].concept : undefined;

    return (
        <div className="mt-3 bg-slate-50 dark:bg-white/5 rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden text-sm">
            <MaterialPicker
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                onSelect={handleMaterialSelect}
                currentMaterialName={currentMaterialName}
            />

            {/* Header / Summary */}
            <div className="px-3 py-2 bg-slate-100 dark:bg-white/10 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-700 dark:text-white/80">Descompuesto del Precio Unitario</span>
                    {isRealCost && (
                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">
                            Precio Real (Analizado)
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1 text-slate-500">
                        <Hammer className="w-3 h-3" /> Mano de obra: <b>{formatCurrency(laborTotal)}</b>
                    </span>
                    <span className="flex items-center gap-1 text-slate-500">
                        <Package className="w-3 h-3" /> Materiales: <b>{formatCurrency(materialTotal)}</b>
                    </span>
                </div>
            </div>

            {/* Match Analysis & Confidence */}
            {note && (
                <div className={cn(
                    "px-3 py-2 border-b text-xs flex flex-col gap-1",
                    note?.includes("⚠") ? "bg-amber-50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-500/20 text-amber-700" :
                        "bg-blue-50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-500/20 text-blue-700"
                )}>
                    <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="font-semibold">{note}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* List */}
            <div className="divide-y divide-slate-100 dark:divide-white/5">
                {breakdown.map((comp, idx) => (
                    <div
                        key={idx}
                        className={cn(
                            "grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-4 items-center px-3 py-2 hover:bg-white dark:hover:bg-white/5 transition-colors group/item",
                            comp.isSubstituted && "bg-blue-50/50 dark:bg-blue-900/5"
                        )}
                    >
                        {/* Concept */}
                        <div className="flex items-center gap-2 min-w-0">
                            {comp.type === 'MATERIAL' ? (
                                <Package className={cn("w-3 h-3 shrink-0", comp.isSubstituted ? "text-blue-500" : "text-slate-400")} />
                            ) : (
                                <Hammer className="w-3 h-3 shrink-0 text-slate-400" />
                            )}
                            <div className="flex flex-col min-w-0">
                                <span className={cn("truncate font-medium", comp.isSubstituted ? "text-blue-700 dark:text-blue-300" : "text-slate-600 dark:text-white/70")}>
                                    {comp.concept}
                                </span>
                                {comp.isSubstituted && (
                                    <span className="text-[10px] text-blue-500 flex items-center gap-1">
                                        Sustitución Inteligente <ArrowRight className="w-3 h-3" /> Material Específico
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="opacity-0 group-hover/item:opacity-100 transition-opacity flex justify-end">
                            {comp.type === 'MATERIAL' && onBreakdownChange && (
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 w-6 p-0 text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                                                onClick={() => handleSwapClick(idx)}
                                            >
                                                <Repeat className="w-3.5 h-3.5" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Sustituir material por catálogo real</TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            )}
                        </div>

                        {/* Price */}
                        <div className="text-right w-24">
                            <div className="text-[10px] text-slate-400 uppercase">Precio</div>
                            <div className="font-mono">{formatCurrency(comp.price)}</div>
                        </div>

                        {/* Rendimiento */}
                        <div className="text-right w-16">
                            <div className="text-[10px] text-slate-400 uppercase">Rend.</div>
                            <div className="font-mono text-slate-500">x{comp.yield}</div>
                        </div>

                        {/* Waste */}
                        <div className="text-right w-16">
                            <div className="text-[10px] text-slate-400 uppercase">Merma</div>
                            {(comp.waste || 0) > 0 ? (
                                <div className="font-mono text-amber-600 flex items-center justify-end gap-0.5">
                                    <Percent className="w-3 h-3" /> {((comp.waste || 0) * 100).toFixed(0)}%
                                </div>
                            ) : (
                                <div className="font-mono text-slate-300">-</div>
                            )}
                        </div>

                        {/* Total */}
                        <div className="text-right w-24">
                            <div className="text-[10px] text-slate-400 uppercase">Total</div>
                            <div className="font-bold font-mono text-slate-700 dark:text-white">
                                {formatCurrency(comp.total)}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

'use client';

import { Button } from '@/components/ui/button';
import {
    Save,
    Undo2,
    Redo2,
    FileDown,
    Loader2,
    Check,
    ScanEye,
    MoreVertical,
    Plus,
    History,
    Layers,
    Wrench,
    BookOpen,
    Download,
    Trash,
    Settings2
} from 'lucide-react';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from '@/lib/utils';
import { Logo } from '@/components/logo';
import { PDFDownloadLink } from '@react-pdf/renderer';
import { BudgetDocument } from '@/components/pdf/BudgetDocument';
import { EditableBudgetLineItem, ExecutionMode } from '@/types/budget-editor';
import { BudgetCostBreakdown } from '@/backend/budget/domain/budget';
import React, { useState } from 'react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
    DropdownMenuLabel
} from "@/components/ui/dropdown-menu";

interface BudgetEditorToolbarProps {
    hasUnsavedChanges: boolean;
    isSaving: boolean;
    canUndo: boolean;
    canRedo: boolean;
    onSave: () => void;
    onUndo: () => void;
    onRedo: () => void;
    lastSavedAt?: Date;

    // Comparison Mode
    showGhostMode: boolean;
    onToggleGhostMode: () => void;

    // Execution Mode
    executionMode: ExecutionMode;
    onSetExecutionMode: (mode: ExecutionMode) => void;

    // For PDF Generation
    clientName: string;
    items: EditableBudgetLineItem[];
    costBreakdown: BudgetCostBreakdown;
    budgetNumber: string;
    onAddItem: (item: any) => void;
    onPdfDownloaded?: () => void;
    // New optional props for PDF config persistence
    initialPdfMeta?: {
        companyName?: string;
        companyLogo?: string;
        clientName?: string;
        clientAddress?: string;
        notes?: string;
    };
    onSavePdfSettings?: (meta: any) => Promise<void>;
    isStandaloneMode?: boolean;
    budgetConfig?: { marginGG: number; marginBI: number; tax: number; };
    onUpdateConfig?: (config: { marginGG?: number; marginBI?: number; tax?: number; }) => void;
    applyMarkup?: (scope: 'global' | 'chapter' | 'item', percentage: number, targetId?: string) => void;
    isReadOnly?: boolean;
    onOpenSummary?: () => void;
}

export const BudgetEditorToolbar = ({
    hasUnsavedChanges,
    isSaving,
    canUndo,
    canRedo,
    onSave,
    onUndo,
    onRedo,
    lastSavedAt,
    showGhostMode,
    onToggleGhostMode,
    executionMode,
    onSetExecutionMode,
    clientName,
    items,
    costBreakdown,
    budgetNumber,
    onAddItem,
    isStandaloneMode = false,
    budgetConfig,
    onUpdateConfig,
    applyMarkup,
    isReadOnly,
    onOpenSummary
}: BudgetEditorToolbarProps) => {
    // Determine status text
    const [isTracing, setIsTracing] = useState(false); // Added isTracing state

    // RAG Validation: Check if any item has breakdowns with variable materials
    const hasVariableCosts = React.useMemo(() => {
        return items.some(item => (item as any).item?.breakdown?.some((b: any) => b.is_variable === true || b.is_variable === 'true'));
    }, [items]);

    // Check if any item has breakdowns at all (needed for labor mode)
    const hasAnyBreakdown = React.useMemo(() => {
        return items.some(item => (item as any).item?.breakdown?.length > 0);
    }, [items]);

    const statusText = isSaving ? 'Guardando...' :
        hasUnsavedChanges ? 'Cambios sin guardar' :
            lastSavedAt ? `Guardado ${lastSavedAt.toLocaleTimeString()}` : 'Listo';

    const StatusBadge = () => (
        <span className={cn(
            "text-[10px] md:text-xs font-medium px-2 md:px-2.5 py-0.5 md:py-1 rounded-full transition-colors border truncate max-w-[120px]",
            hasUnsavedChanges
                ? "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800"
                : "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800"
        )}>
            {statusText}
        </span>
    );

    return (
        <>
            {/* TOP TOOLBAR (Adaptive) */}
            <div className="sticky top-0 z-50 bg-white dark:bg-zinc-950 border-b border-border px-4 py-3 flex justify-between items-center shadow-sm">

                {/* LEFT: Branding (Demo Mode) & Status Indicator */}
                <div className="flex items-center gap-4">
                    {/* Only show logo in Demo mode (where we don't have the global Header) */}
                    {isStandaloneMode && (
                        <div className="flex items-center gap-2 pr-4 border-r border-slate-200 dark:border-white/10">
                            <Logo className="h-6" width={78} height={24} />
                        </div>
                    )}
                    <StatusBadge />
                </div>

                {/* RIGHT: Actions */}
                <div className="flex items-center gap-2">

                    {/* Execution Mode Dropdown */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant={executionMode !== 'complete' ? "secondary" : "outline"}
                                size="sm"
                                className={cn(
                                    "hidden md:flex transition-colors shrink-0",
                                    executionMode === 'execution'
                                        ? "bg-amber-100/50 hover:bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-900/30 dark:text-amber-500 dark:border-amber-800"
                                        : executionMode === 'labor'
                                        ? "bg-blue-100/50 hover:bg-blue-100 text-blue-900 border-blue-200 dark:bg-blue-900/30 dark:text-blue-500 dark:border-blue-800"
                                        : "bg-white hover:bg-slate-50 border-slate-200 text-slate-700"
                                )}
                                title="Seleccionar modo de visualización"
                            >
                                {executionMode === 'execution' ? <Wrench className="w-4 h-4 mr-2 text-amber-600" /> : executionMode === 'labor' ? <Wrench className="w-4 h-4 mr-2 text-blue-600" /> : <Layers className="w-4 h-4 mr-2 text-indigo-500" />}
                                {executionMode === 'execution' ? 'Sólo Ejecución' : executionMode === 'labor' ? 'Sólo Mano de Obra' : 'Completo'}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-60">
                            <DropdownMenuLabel>Modo de Visualización</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => onSetExecutionMode('complete')} className={executionMode === 'complete' ? 'bg-slate-100 dark:bg-white/10 font-semibold' : ''}>
                                <Layers className="w-4 h-4 mr-2 text-indigo-500" /> Presupuesto Completo
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onSetExecutionMode('execution')} disabled={!hasVariableCosts} className={executionMode === 'execution' ? 'bg-amber-50 dark:bg-amber-900/20 font-semibold' : ''}>
                                <Wrench className="w-4 h-4 mr-2 text-amber-600" />
                                <div className="flex flex-col">
                                    <span>Sólo Ejecución</span>
                                    <span className="text-[10px] text-slate-400 font-normal">{hasVariableCosts ? 'Excluye materiales variables' : 'Sin materiales variables detectados'}</span>
                                </div>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onSetExecutionMode('labor')} disabled={!hasAnyBreakdown} className={executionMode === 'labor' ? 'bg-blue-50 dark:bg-blue-900/20 font-semibold' : ''}>
                                <Wrench className="w-4 h-4 mr-2 text-blue-600" />
                                <div className="flex flex-col">
                                    <span>Exclusivamente Mano de Obra</span>
                                    <span className="text-[10px] text-slate-400 font-normal">{hasAnyBreakdown ? 'Solo componentes mo...' : 'Sin descompuestos disponibles'}</span>
                                </div>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Mobile Menu */}
                    {!isReadOnly && (
                        <div className="md:hidden">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="icon" className="h-9 w-9 bg-white hover:bg-slate-50 border-slate-200 text-slate-700">
                                        <MoreVertical className="w-4 h-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-56">
                                    <DropdownMenuLabel>Opciones</DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => onSetExecutionMode('complete')}>
                                        <Layers className="w-4 h-4 mr-2 text-indigo-500" /> Presupuesto Completo
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => onSetExecutionMode('execution')} disabled={!hasVariableCosts}>
                                        <Wrench className="w-4 h-4 mr-2 text-amber-600" /> Sólo Ejecución
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => onSetExecutionMode('labor')}>
                                        <Wrench className="w-4 h-4 mr-2 text-blue-600" /> Sólo Mano de Obra
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    )}

                    {/* Save Button (Primary Action) */}
                    {!isReadOnly && (
                        <Button
                            onClick={onSave}
                            disabled={isSaving}
                            size="sm"
                            className={cn(
                                "min-w-[100px] shadow-sm transition-all font-medium",
                                hasUnsavedChanges
                                    ? "bg-amber-500 hover:bg-amber-600 text-white"
                                    : "bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-white dark:text-zinc-900"
                            )}
                        >
                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : (hasUnsavedChanges ? <Save className="w-4 h-4 mr-2" /> : <Check className="w-4 h-4 mr-2" />)}
                            {isSaving ? 'Guardando' : 'Guardar'}
                        </Button>
                    )}
                </div>
            </div>

            {/* MOBILE STICKY BOTTOM BAR */}
            <div className="md:hidden fixed bottom-0 left-0 right-0 p-4 bg-white dark:bg-zinc-950 border-t border-border z-50 flex gap-3 safe-area-pb">
                <Button
                    onClick={onOpenSummary}
                    size="lg"
                    variant="outline"
                    className="flex-1 shadow-lg transition-all font-semibold bg-zinc-900 border-transparent text-white dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
                >
                    <Layers className="w-5 h-5 mr-2 opacity-80" />
                    Resumen y Partidas
                </Button>
            </div>
        </>
    );
};

'use client';

import { Reorder, useDragControls } from 'framer-motion';
import { EditableBudgetLineItem } from '@/types/budget-editor';
import { EditableCell } from './EditableCell';
import { BudgetPartidaBreakdown } from './BudgetPartidaBreakdown';
import { SmartInterruptCard } from './SmartInterruptCard';
import { Button } from '@/components/ui/button';
import {
    GripVertical,
    Trash2,
    ChevronDown,
    ChevronUp,
    MoreHorizontal,
    FolderPlus,
    Pencil,
    AlertTriangle,
    Copy,
    Package,
    Hammer
} from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import { useState } from 'react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface BudgetEditorGridProps {
    items: EditableBudgetLineItem[];
    chapters: string[];
    onReorder: (newItems: EditableBudgetLineItem[]) => void;
    onUpdate: (id: string, changes: Partial<EditableBudgetLineItem>) => void;
    onRemove: (id: string) => void;
    onDuplicate: (id: string) => void;
    // Chapter Actions
    onAddChapter: (name: string) => void;
    onRemoveChapter: (name: string) => void;
    onRenameChapter: (oldName: string, newName: string) => void;
    onReorderChapters: (newOrder: string[]) => void;
    // Visual Features
    showGhostMode?: boolean;
}

const DraggableRow = ({ item, onUpdate, onRemove, onDuplicate, showGhostMode }: {
    item: EditableBudgetLineItem;
    onUpdate: (id: string, changes: Partial<EditableBudgetLineItem>) => void;
    onRemove: (id: string) => void;
    onDuplicate: (id: string) => void;
    showGhostMode?: boolean;
}) => {
    const controls = useDragControls();
    const [isExpanded, setIsExpanded] = useState(false);

    // Deviation Analysis
    const currentPrice = item.item?.unitPrice || 0;
    const originalPrice = item.originalState?.unitPrice || currentPrice;
    const deviation = originalPrice > 0 ? Math.abs((currentPrice - originalPrice) / originalPrice) : 0;
    const isDeviated = deviation > 0.2; // 20% threshold

    // Handle Total Price Change (Reverse Calculation)
    const handleTotalChange = (val: string | number) => {
        const newTotal = Number(val);
        const quantity = item.item?.quantity || 0;
        const safeQuantity = quantity === 0 ? 1 : quantity;
        const newUnitPrice = newTotal / safeQuantity;

        onUpdate(item.id, {
            item: {
                ...item.item!,
                unitPrice: newUnitPrice,
            }
        });
    };

    return (
        <Reorder.Item
            value={item}
            id={item.id}
            dragListener={false}
            dragControls={controls}
            className={cn(
                "group relative bg-white dark:bg-white/5 border dark:border-white/10 rounded-xl mb-3 md:mb-4 shadow-sm hover:shadow-md transition-all overflow-hidden",
                item.isDirty && "border-amber-200 dark:border-amber-500/30 bg-amber-50/10"
            )}
        >
            {/* DESKTOP LAYOUT (Hidden on Mobile) */}
            <div className="hidden md:flex flex-row items-stretch bg-slate-50/50 dark:bg-white/[0.03] border-b dark:border-white/10 p-3">
                {/* Drag Handle & Index */}
                <div className="flex items-center mr-4">
                    <div
                        onPointerDown={(e) => controls.start(e)}
                        className="mr-3 cursor-grab active:cursor-grabbing text-slate-300 dark:text-white/20 hover:text-slate-500 dark:hover:text-white/50 flex flex-col justify-center"
                    >
                        <GripVertical className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-mono font-bold text-slate-400 dark:text-white/40 border dark:border-white/10 bg-white dark:bg-white/5 px-2 py-1 rounded">
                        {String(item.order || 0).padStart(2, '0')}
                    </span>
                </div>

                {/* Title */}
                <div className="flex-1 flex flex-col justify-center min-w-0 mr-4">
                    <div className="flex items-center gap-2 mb-1">
                        {item.type === 'MATERIAL' ? (
                            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded flex items-center gap-1">
                                <Package className="w-3 h-3" /> Material
                            </span>
                        ) : (
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 rounded flex items-center gap-1">
                                <Hammer className="w-3 h-3" /> Partida
                            </span>
                        )}
                    </div>

                    <EditableCell
                        value={item.originalTask || "Nueva Partida"}
                        onChange={(val) => onUpdate(item.id, { originalTask: val as string })}
                        className="font-bold text-base text-slate-700 dark:text-white/90 bg-transparent border-transparent hover:border-slate-200 dark:hover:border-white/10 focus:bg-white dark:focus:bg-white/10 px-0 truncate w-full"
                        placeholder="Título de la partida..."
                    />
                    {isDeviated && (
                        <div className="flex items-center gap-1 text-amber-600 text-[10px] mt-0.5">
                            <AlertTriangle className="w-3 h-3" />
                            <span>Desviación significativa (+20%)</span>
                        </div>
                    )}
                </div>

                {/* Price Logic */}
                <div className="flex items-center gap-4">
                    {showGhostMode && item.originalState && (
                        <span className="text-xs text-slate-400 line-through font-mono">
                            {formatCurrency(item.originalState.quantity * item.originalState.unitPrice)}
                        </span>
                    )}

                    <div className={cn(
                        "flex items-center gap-2 border rounded-lg px-3 py-1 shadow-sm transition-colors bg-white dark:bg-white/5",
                        isDeviated ? "bg-amber-50 border-amber-200" :
                            currentPrice === 0 ? "bg-red-50 border-red-200 animate-pulse" : // ZERO PRICE ALERT
                                // Confidence Heatmap Logic
                                (item.item?.matchConfidence || 0) > 80 ? "bg-emerald-50 border-emerald-100 dark:bg-emerald-900/10 dark:border-emerald-500/20" :
                                    (item.item?.matchConfidence || 0) > 50 ? "bg-yellow-50 border-yellow-100 dark:bg-yellow-900/10 dark:border-yellow-500/20" :
                                        "bg-red-50 border-red-100 dark:bg-red-900/10 dark:border-red-500/20"
                    )}>
                        <div className={cn("flex items-center gap-1 text-sm", isDeviated ? "text-amber-800" : currentPrice === 0 ? "text-red-800" : "text-green-800")}>
                            <EditableCell
                                value={item.item?.quantity || 0}
                                onChange={(val) => onUpdate(item.id, { item: { ...item.item!, quantity: Number(val) } })}
                                type="number"
                                className={cn("w-12 h-6 text-right bg-transparent border-transparent hover:bg-white focus:bg-white font-mono p-0", isDeviated ? "text-amber-800" : "text-green-800")}
                            />
                            <span className={cn("text-[10px] uppercase w-8 text-center", isDeviated ? "text-amber-500" : "text-green-500")}>
                                <EditableCell
                                    value={item.item?.unit || 'ud'}
                                    onChange={(val) => onUpdate(item.id, { item: { ...item.item!, unit: val as string } })}
                                    className="w-full text-center bg-transparent border-transparent hover:bg-white focus:bg-white p-0 h-4"
                                />
                            </span>
                            <span className={cn("mx-1 text-xs opacity-50", isDeviated ? "text-amber-800" : "text-green-800")}>x</span>

                            {/* PRICE INPUT OR WARNING */}
                            <div className="relative">
                                <EditableCell
                                    value={item.item?.unitPrice || 0}
                                    onChange={(val) => onUpdate(item.id, { item: { ...item.item!, unitPrice: Number(val) } })}
                                    type="currency"
                                    className={cn(
                                        "w-20 h-6 text-right bg-transparent border-transparent hover:bg-white focus:bg-white font-mono p-0",
                                        isDeviated ? "text-amber-800" :
                                            currentPrice === 0 ? "text-red-600 font-bold" : "text-slate-700 dark:text-slate-200"
                                    )}
                                />
                                {currentPrice === 0 && (
                                    <div className="absolute -top-3 -right-2 text-red-500 bg-red-100 rounded-full p-0.5" title="Precio no definido">
                                        <AlertTriangle className="w-3 h-3" />
                                    </div>
                                )}
                                {item.type === 'MATERIAL' && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <div className="w-8 h-8 rounded-md bg-blue-50 dark:bg-blue-900/20 text-blue-600 flex items-center justify-center cursor-help">
                                                    <Package className="w-4 h-4" />
                                                </div>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <p>Este es un material. Puedes buscarlo en el catálogo.</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}
                            </div>
                        </div>

                        {/* Confidence Indicator Dot */}
                        {item.item?.matchConfidence !== undefined && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger>
                                        <div className={cn(
                                            "w-2 h-2 rounded-full absolute -top-1 -right-1 border border-white dark:border-slate-900",
                                            (item.item?.matchConfidence || 0) > 80 ? "bg-emerald-500" :
                                                (item.item?.matchConfidence || 0) > 50 ? "bg-yellow-500" :
                                                    "bg-red-500"
                                        )} />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>Confianza AI: {item.item?.matchConfidence || 0}%</p>
                                        <p className="text-xs text-slate-400">
                                            {(item.item?.matchConfidence || 0) > 80 ? "Alta coincidencia en catálogo" :
                                                (item.item?.matchConfidence || 0) > 50 ? "Aproximación estimada" :
                                                    "Estimación generativa (Revisar)"}
                                        </p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                        <div className={cn("h-4 w-px mx-2", isDeviated ? "bg-amber-200" : "bg-green-200")} />
                        <div className={cn("font-bold text-lg", isDeviated ? "text-amber-700" : "text-green-700")}>
                            <EditableCell
                                value={item.item?.totalPrice || 0}
                                onChange={handleTotalChange}
                                type="currency"
                                className="w-24 h-7 text-right bg-transparent border-transparent hover:bg-white focus:bg-white font-mono p-0"
                            />
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 ml-3 pl-3 border-l self-center shrink-0">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-300 hover:text-blue-500" onClick={() => onDuplicate(item.id)}>
                                    <Copy className="w-4 h-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Duplicar partida</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-300 hover:text-red-500">
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Esta acción eliminará la partida &quot;{item.originalTask}&quot; permanentemente.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction onClick={() => onRemove(item.id)} className="bg-red-600 hover:bg-red-700">Elminar</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </div>

            {/* MOBILE LAYOUT (Card View) */}
            <div className="md:hidden flex flex-col bg-white dark:bg-white/[0.03] p-3 gap-3">
                {/* Row 1: Handle, Title, Menu */}
                <div className="flex items-start gap-3">
                    <div onPointerDown={(e) => controls.start(e)} className="mt-1 cursor-grab active:cursor-grabbing text-slate-300">
                        <GripVertical className="w-5 h-5" />
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-mono font-bold text-slate-400 border bg-slate-50 px-1.5 py-0.5 rounded">
                                {String(item.order || 0).padStart(2, '0')}
                            </span>
                            {isDeviated && <AlertTriangle className="w-3 h-3 text-amber-500" />}
                        </div>
                        <EditableCell
                            value={item.originalTask || "Nueva Partida"}
                            onChange={(val) => onUpdate(item.id, { originalTask: val as string })}
                            className="font-bold text-base text-slate-800 dark:text-white leading-tight px-0 w-full"
                            placeholder="Título..."
                        />
                    </div>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2">
                                <MoreHorizontal className="w-4 h-4 text-slate-400" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onDuplicate(item.id)}>
                                <Copy className="w-4 h-4 mr-2" /> Duplicar
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-red-600" onClick={() => onRemove(item.id)}>
                                <Trash2 className="w-4 h-4 mr-2" /> Eliminar
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                {/* Row 2: Price Calculation Card */}
                <div className={cn(
                    "rounded-lg p-3 border flex flex-col gap-2",
                    isDeviated ? "bg-amber-50/50 border-amber-100" : "bg-slate-50/50 border-slate-100 dark:bg-white/5 dark:border-white/5"
                )}>
                    <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                            <div className="flex flex-col">
                                <span className="text-[10px] uppercase text-slate-400 font-semibold tracking-wider">Cant.</span>
                                <EditableCell
                                    value={item.item?.quantity || 0}
                                    onChange={(val) => onUpdate(item.id, { item: { ...item.item!, quantity: Number(val) } })}
                                    type="number"
                                    className="w-16 h-7 bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 rounded px-2 text-center font-mono"
                                />
                            </div>
                            <span className="text-slate-300 mt-4">×</span>
                            <div className="flex flex-col">
                                <span className="text-[10px] uppercase text-slate-400 font-semibold tracking-wider">Precio</span>
                                <EditableCell
                                    value={item.item?.unitPrice || 0}
                                    onChange={(val) => onUpdate(item.id, { item: { ...item.item!, unitPrice: Number(val) } })}
                                    type="currency"
                                    className="w-20 h-7 bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 rounded px-2 text-right font-mono"
                                />
                            </div>
                        </div>

                        <div className="flex flex-col items-end">
                            <span className="text-[10px] uppercase text-slate-400 font-semibold tracking-wider">Total</span>
                            <EditableCell
                                value={item.item?.totalPrice || 0}
                                onChange={handleTotalChange}
                                type="currency"
                                className="w-24 h-7 bg-transparent border-0 text-right font-bold text-lg p-0"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Content Body (Shared Description) */}
            <div className="p-3 md:p-4 md:pl-14 relative group/body border-t border-slate-100 dark:border-white/5">
                <div className={cn(
                    "relative transition-all duration-300 ease-in-out",
                    isExpanded ? "h-auto block" : "max-h-[3rem] overflow-hidden"
                )}>
                    {!isExpanded && (
                        <div className="absolute bottom-0 left-0 w-full h-8 bg-gradient-to-t from-white dark:from-[#0a0a0a] to-transparent pointer-events-none z-10" />
                    )}

                    {/* Description Editor */}
                    <div className="space-y-2">
                        <EditableCell
                            value={item.item?.description || ""}
                            onChange={(val) => onUpdate(item.id, { item: { ...item.item!, description: val as string } })}
                            type="textarea"
                            className={cn(
                                "text-sm text-slate-600 dark:text-white/60 leading-relaxed bg-transparent border-slate-100 dark:border-white/10 focus:bg-white dark:focus:bg-white/10 focus:border-primary/20 w-full",
                                isExpanded ? "min-h-[4rem]" : "h-full"
                            )}
                            placeholder="Descripción técnica detallada..."
                        />
                        {showGhostMode && item.originalState && (
                            <div className="p-2 md:p-3 bg-slate-50 border border-slate-100 rounded-lg text-xs text-slate-500 italic">
                                <span className="font-semibold not-italic block mb-1 text-slate-400 uppercase tracking-wider">Original:</span>
                                {item.originalState.description}
                            </div>
                        )}
                    </div>
                </div>

                {/* Cost Breakdown */}
                {item.item?.breakdown && (
                    <BudgetPartidaBreakdown
                        breakdown={item.item.breakdown}
                        isRealCost={item.item.isRealCost}
                        note={item.item.note}
                        onBreakdownChange={(newBreakdown) => {
                            const newUnitPrice = newBreakdown.reduce((acc, c) => acc + c.total, 0);
                            const quantity = item.item?.quantity || 1;
                            onUpdate(item.id, {
                                item: {
                                    ...item.item!,
                                    breakdown: newBreakdown,
                                    unitPrice: newUnitPrice,
                                    totalPrice: newUnitPrice * quantity,
                                    isRealCost: true // Mark as real cost since we used actual materials
                                }
                            });
                        }}
                    />
                )}

                <div className="flex justify-center -mb-2 mt-1 relative z-20">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="h-5 w-full hover:bg-slate-50 dark:hover:bg-white/5 text-slate-300 dark:text-white/20 hover:text-slate-500 dark:hover:text-white/50 flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider"
                    >
                        {isExpanded ? (
                            <>Menos <ChevronUp className="w-3 h-3" /></>
                        ) : (
                            <>Más Detalles <ChevronDown className="w-3 h-3" /></>
                        )}
                    </Button>
                </div>
            </div>
        </Reorder.Item >
    );
};

// Chapter Component
const ChapterGroup = ({
    chapterName,
    items,
    onReorder,
    onUpdate,
    onRemove,
    onDuplicate,
    onRename,
    onDelete,
    showGhostMode
}: {
    chapterName: string;
    items: EditableBudgetLineItem[];
    onReorder: (items: EditableBudgetLineItem[]) => void;
    onUpdate: any;
    onRemove: any;
    onDuplicate: any;
    onRename: (newName: string) => void;
    onDelete: () => void;
    showGhostMode?: boolean;
}) => {
    const [isOpen, setIsOpen] = useState(true);
    const [isEditingName, setIsEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState(chapterName);

    const handleRenameSubmit = () => {
        if (nameDraft.trim() && nameDraft !== chapterName) {
            onRename(nameDraft.trim());
        }
        setIsEditingName(false);
    };

    return (
        <div className="mb-6 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden bg-slate-50/50 dark:bg-white/[0.02] shadow-sm">
            {/* Chapter Header */}
            <div className="flex items-center justify-between p-4 bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10">
                <div className="flex items-center gap-3 flex-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="p-1 h-6 w-6 text-slate-400"
                        onClick={() => setIsOpen(!isOpen)}
                    >
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                    </Button>

                    {isEditingName ? (
                        <Input
                            autoFocus
                            value={nameDraft}
                            onChange={(e) => setNameDraft(e.target.value)}
                            onBlur={handleRenameSubmit}
                            onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit()}
                            className="h-7 w-64 font-bold text-lg"
                        />
                    ) : (
                        <h3
                            className="font-bold text-lg text-slate-800 dark:text-white cursor-pointer hover:underline decoration-dashed decoration-slate-300 dark:decoration-white/30 underline-offset-4"
                            onClick={() => setIsEditingName(true)}
                        >
                            {chapterName}
                            <span className="ml-3 text-xs font-normal text-slate-400 dark:text-white/40 bg-slate-100 dark:bg-white/10 px-2 py-0.5 rounded-full">
                                {items.length} partidas
                            </span>
                        </h3>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-500 mr-4">
                        {formatCurrency(items.reduce((acc, i) => acc + (i.item?.totalPrice || 0), 0))}
                    </span>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400">
                                <MoreHorizontal className="w-4 h-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setIsEditingName(true)}>
                                <Pencil className="w-4 h-4 mr-2" /> Renombrar
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={onDelete}>
                                <Trash2 className="w-4 h-4 mr-2" /> Eliminar Capítulo
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Chapter Items */}
            {isOpen && (
                <div className="p-4 bg-slate-50/30 dark:bg-transparent">
                    <Reorder.Group axis="y" values={items} onReorder={onReorder} className="space-y-4">
                        {items.length === 0 ? (
                            <div className="text-center py-8 border border-dashed rounded-lg text-slate-400 text-sm">
                                Arrastra partidas aquí o añade nuevas
                            </div>
                        ) : (
                            items.map((item) => (
                                item.id.startsWith('NEEDS-INPUT-') ? (
                                    <SmartInterruptCard
                                        key={item.id}
                                        item={item}
                                        onResolve={(id, res) => onUpdate(id, { originalTask: res, id: id.replace('NEEDS-INPUT-', 'RESOLVED-') })} // Mock resolution logic
                                        onDismiss={(id) => onRemove(id)}
                                    />
                                ) : (
                                    <DraggableRow
                                        key={item.id}
                                        item={item}
                                        onUpdate={onUpdate}
                                        onRemove={onRemove}
                                        onDuplicate={onDuplicate}
                                        showGhostMode={showGhostMode}
                                    />
                                )
                            ))
                        )}
                    </Reorder.Group>
                </div>
            )}
        </div>
    );
};

export const BudgetEditorGrid = ({
    items,
    chapters,
    onReorder,
    onUpdate,
    onRemove,
    onDuplicate,
    onAddChapter,
    onRemoveChapter,
    onRenameChapter,
    onReorderChapters,
    showGhostMode
}: BudgetEditorGridProps) => {

    return (
        <div className="max-w-4xl mx-auto space-y-8">

            {chapters.map((chapterName) => (
                <ChapterGroup
                    key={chapterName}
                    chapterName={chapterName}
                    items={items.filter(i => i.chapter === chapterName)}
                    onReorder={(newChapterItems) => onReorder(newChapterItems)}
                    onUpdate={onUpdate}
                    onRemove={onRemove}
                    onDuplicate={onDuplicate}
                    onRename={(newName) => onRenameChapter(chapterName, newName)}
                    onDelete={() => onRemoveChapter(chapterName)}
                    showGhostMode={showGhostMode}
                />
            ))}

            <Button
                variant="outline"
                className="w-full border-dashed py-6 text-slate-500 dark:text-white/40 hover:text-primary hover:border-primary/50 hover:bg-primary/5"
                onClick={() => onAddChapter(`Nuevo Capítulo ${chapters.length + 1}`)}
            >
                <FolderPlus className="w-5 h-5 mr-2" />
                Añadir Nuevo Capítulo
            </Button>
        </div>
    );
};

import React, { useState } from 'react';
import { formatCurrency } from '@/lib/utils';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronUp, MoreHorizontal, Percent } from "lucide-react";
import { Reorder } from "framer-motion";
import { TableRowItem } from './TableRowItem';
import { useBudgetEditorContext } from '../BudgetEditorContext';

interface ChapterSectionProps {
    chapterName: string;
    items: any[];
    showGhostMode?: boolean;
    onOpenBreakdown: (item: any) => void;
    onOpenMarkup: (chapterName: string) => void;
}

export const ChapterSection = ({
    chapterName,
    items,
    showGhostMode,
    onOpenBreakdown,
    onOpenMarkup
}: ChapterSectionProps) => {
    const { 
        state,
        reorderItems, 
        renameChapter, 
        removeChapter, 
        updateItem,
        removeItem,
        duplicateItem,
        isReadOnly,
        leadId
    } = useBudgetEditorContext();

    const isExecutionOnly = state.isExecutionOnly;
    const [isExpanded, setIsExpanded] = useState(true);
    const [isEditingName, setIsEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState(chapterName);

    const handleRenameSubmit = () => {
        if (nameDraft.trim() && nameDraft !== chapterName) {
            renameChapter(chapterName, nameDraft.trim());
        }
        setIsEditingName(false);
    };

    const totalChapter = items.reduce((acc: number, i: any) => {
        let total = i.item?.totalPrice || 0;
        if (isExecutionOnly && i.item?.breakdown) {
            const vCost = i.item.breakdown
                .filter((comp: any) => comp.is_variable === true || comp.is_variable === 'true' || comp.isVariable === true)
                .reduce((cAcc: number, comp: any) => {
                    const cPrice = comp.unitPrice || comp.price || 0;
                    const cQuantity = comp.quantity || comp.yield || 1;
                    return cAcc + (comp.totalPrice || comp.total || (cPrice * cQuantity));
                }, 0);
            total = Math.max(0, total - vCost);
        }
        return acc + total;
    }, 0);

    return (
        <>
            {/* Chapter Header */}
            <div className="border-t border-slate-200 dark:border-white/10 bg-slate-50 hover:bg-slate-100 dark:bg-white/5 dark:hover:bg-white/10 border-b">
                <div className="flex items-center w-full min-w-[800px]">
                    {/* Left spacing to match Drag Handle + Type + Title offset */}
                    <div className="w-[40px] shrink-0 p-3"></div>
                    <div className="w-[50px] shrink-0 p-3"></div>
                            
                    {/* Chapter Title Container (Matches Descripción / Código) */}
                    <div className="flex-1 min-w-[300px] p-2 flex items-center justify-start gap-3">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-slate-400"
                            onClick={() => setIsExpanded(!isExpanded)}
                        >
                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                        </Button>

                        {isEditingName ? (
                            <Input
                                autoFocus
                                value={nameDraft}
                                onChange={(e) => setNameDraft(e.target.value)}
                                onBlur={handleRenameSubmit}
                                onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit()}
                                className="h-7 w-64 font-bold text-lg bg-white"
                            />
                        ) : (
                            <div
                                className="font-bold text-lg text-slate-800 dark:text-white cursor-pointer hover:underline decoration-dashed underline-offset-4 flex items-center gap-3"
                                onClick={() => setIsEditingName(true)}
                            >
                                {chapterName}
                                <Badge variant="secondary" className="font-normal text-xs text-slate-500">
                                    {items.length} ítems
                                </Badge>
                            </div>
                        )}
                    </div>

                    {/* Empty Unit / Quantity / Unit Price */}
                    <div className="w-[80px] shrink-0 p-2"></div>
                    <div className="w-[100px] shrink-0 p-2"></div>
                    <div className="w-[120px] shrink-0 p-2"></div>

                    {/* Total Price */}
                    <div className="w-[120px] shrink-0 p-2 text-right">
                        <span className="font-mono font-bold text-slate-800 dark:text-white">
                            {formatCurrency(totalChapter)}
                        </span>
                    </div>
                                
                    {/* Actions */}
                    <div className="w-[50px] shrink-0 p-2 text-center pt-2">
                        {!isReadOnly && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400">
                                    <MoreHorizontal className="w-4 h-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => onOpenMarkup(chapterName)}>
                                    <Percent className="w-4 h-4 mr-2 text-slate-500" />
                                    Ajustar Precios de Capítulo
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setIsEditingName(true)}>Renombrar</DropdownMenuItem>
                                <DropdownMenuItem className="text-red-600" onClick={() => removeChapter(chapterName)}>Eliminar Capítulo</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        )}
                    </div>
                </div>
            </div>

            {/* Draggable Items */}
            {isExpanded && (
                <Reorder.Group
                    as="div"
                    axis="y"
                    values={items}
                    onReorder={reorderItems}
                    className="flex flex-col"
                >
                    {items.map((item: any) => (
                        <TableRowItem
                            key={item.id}
                            item={item}
                            onUpdate={updateItem}
                            onRemove={removeItem}
                            onDuplicate={duplicateItem}
                            showGhostMode={showGhostMode}
                            isExecutionOnly={isExecutionOnly}
                            onOpenBreakdown={onOpenBreakdown}
                            onOpenMarkup={onOpenMarkup}
                            isReadOnly={isReadOnly}
                            leadId={leadId}
                        />
                    ))}
                    {items.length === 0 && (
                        <div className="text-center py-8 text-slate-400 border-dashed border-b w-full">
                            Arrastra partidas aquí o añade nuevas desde la biblioteca
                        </div>
                    )}
                </Reorder.Group>
            )}
        </>
    );
};

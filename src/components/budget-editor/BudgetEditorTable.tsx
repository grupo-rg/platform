'use client';

import React, { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FolderPlus } from "lucide-react";
import { EditableBudgetLineItem } from "@/types/budget-editor";
import { AIReasoningSheet } from './table/AIReasoningSheet';
import { ChapterSection } from './table/ChapterSection';
import { useBudgetEditorContext } from './BudgetEditorContext';

interface BudgetEditorTableProps {
    showGhostMode?: boolean; // Dejamos esto como prop opcional si depende del Toolbar en el futuro, o lo leemos.
}

export function BudgetEditorTable({ showGhostMode }: BudgetEditorTableProps) {
    const { 
        state, 
        updateItem, 
        removeItem, 
        duplicateItem, 
        addChapter, 
        removeChapter, 
        renameChapter, 
        reorderChapters, 
        applyMarkup, 
        isAdmin, 
        isReadOnly, 
        leadId,
        reorderItems
    } = useBudgetEditorContext();

    const [breakdownItem, setBreakdownItem] = useState<EditableBudgetLineItem | null>(null);
    const [breakdownOpen, setBreakdownOpen] = useState(false);

    // Markup Dialog State
    const [markupState, setMarkupState] = useState<{ open: boolean; scope: 'global' | 'chapter' | 'item'; targetId?: string; percentage: number }>({ open: false, scope: 'global', percentage: 0 });

    const handleOpenBreakdown = (item: EditableBudgetLineItem) => {
        setBreakdownItem(item);
        setBreakdownOpen(true);
    };

    return (
        <div className="w-full bg-white dark:bg-zinc-900 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm overflow-hidden auto-cols-auto overflow-x-auto">
            <div className="flex flex-col min-w-[800px]">
                {/* Header Grid */}
                <div className="flex bg-slate-50/50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 text-sm font-medium text-slate-500">
                    <div className="w-[40px] shrink-0 p-3"></div>
                    <div className="w-[50px] shrink-0 text-center p-3">Tipo</div>
                    <div className="flex-1 min-w-[300px] p-3">Descripción / Código</div>
                    <div className="w-[80px] shrink-0 text-center p-3">Ud</div>
                    <div className="w-[100px] shrink-0 text-right p-3">Cant.</div>
                    <div className="w-[120px] shrink-0 text-right p-3">Precio</div>
                    <div className="w-[120px] shrink-0 text-right p-3">Total</div>
                    <div className="w-[50px] shrink-0 p-3"></div>
                </div>

                {state.chapters.map((chapterName: string) => (
                        <ChapterSection
                            key={chapterName}
                            chapterName={chapterName}
                            items={state.items.filter((i: any) => i.chapter === chapterName)}
                            showGhostMode={showGhostMode}
                            onOpenBreakdown={handleOpenBreakdown}
                            onOpenMarkup={(chapterName: string) => setMarkupState({ open: true, scope: 'chapter', targetId: chapterName, percentage: 0 })}
                        />
                ))}
            </div>

            {!isReadOnly && (
                <div className="p-4 bg-slate-50 dark:bg-white/5 border-t border-slate-200 dark:border-white/10 flex flex-wrap gap-4">
                    <Button
                        variant="outline"
                        className="border-dashed"
                        onClick={() => addChapter(`Capítulo ${state.chapters.length + 1}`)}
                    >
                        <FolderPlus className="w-4 h-4 mr-2" />
                        Nuevo Capítulo
                    </Button>
                </div>
            )}
            {/* AUDIT MASTER PANEL */}
            <AIReasoningSheet
                item={breakdownItem}
                open={breakdownOpen}
                onOpenChange={setBreakdownOpen}
                onUpdate={updateItem}
                isAdmin={isAdmin}
            />

            {/* Markup Adjustment Dialog */}
            <Dialog open={markupState.open} onOpenChange={(open) => setMarkupState({ ...markupState, open })}>
                <DialogContent className="max-w-md bg-white dark:bg-zinc-950">
                    <DialogHeader>
                        <DialogTitle>Ajustar Precios ({markupState.scope === 'global' ? 'Presupuesto Completo' : markupState.scope === 'chapter' ? 'Capítulo' : 'Partida'})</DialogTitle>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <p className="text-sm text-slate-500">
                            Añade un porcentaje positivo para incrementar los precios o negativo para hacer un descuento automatizado.
                        </p>
                        <div className="relative">
                            <Input
                                type="number"
                                autoFocus
                                value={Number.isNaN(markupState.percentage) ? '' : markupState.percentage}
                                onChange={(e) => setMarkupState({ ...markupState, percentage: Number(e.target.value) })}
                                className="pr-8"
                            />
                            <span className="absolute right-3 top-2.5 text-slate-400 font-medium">%</span>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setMarkupState({ ...markupState, open: false })}>Cancelar</Button>
                        <Button onClick={() => {
                            if (applyMarkup) applyMarkup(markupState.scope, markupState.percentage, markupState.targetId);
                            setMarkupState({ ...markupState, open: false });
                        }}>Aplicar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

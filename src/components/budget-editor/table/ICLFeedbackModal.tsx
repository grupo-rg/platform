'use client';

import React, { useState, useTransition } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EditableBudgetLineItem } from '@/types/budget-editor';
import { sileo } from 'sileo';
import { saveIclFeedbackAction } from '@/actions/budget/icl-feedback.action';
import { BrainCircuit, Loader2 } from 'lucide-react';

interface ICLFeedbackModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item: EditableBudgetLineItem;
    leadId?: string;
}

export function ICLFeedbackModal({ open, onOpenChange, item, leadId }: ICLFeedbackModalProps) {
    const [reasoning, setReasoning] = useState("");
    const [isPending, startTransition] = useTransition();

    const handleSave = () => {
        if (!reasoning.trim()) {
            sileo.error({ title: "Falta información", description: "Debes proveer una justificación heurística." });
            return;
        }

        startTransition(async () => {
            const result = await saveIclFeedbackAction({
                itemId: item.id,
                leadId: leadId || "anonymous",
                originalDescription: item.originalTask || item.item?.description || "",
                selectedCandidateCode: item.item?.code || "",
                selectedCandidateDescription: item.item?.description || "",
                humanReasoning: reasoning,
                finalPrice: item.item?.unitPrice || 0,
                finalQuantity: item.item?.quantity || 1,
                finalUnit: item.item?.unit || "ud",
                chapter: item.chapter || "General"
            });

            if (result.success) {
                sileo.success({
                    title: "Alineamiento Guardado",
                    description: "La heurística ha sido inyectada en el cerebro del Agente AI.",
                });
                onOpenChange(false);
                setReasoning("");
            } else {
                sileo.error({
                    title: "Error al guardar",
                    description: result.error || "No se pudo conectar con AI Core."
                });
            }
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px] bg-slate-50 dark:bg-zinc-950">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-indigo-700 dark:text-indigo-400">
                        <BrainCircuit className="w-5 h-5" />
                        Enseñar a la IA (Regla de Oro)
                    </DialogTitle>
                    <DialogDescription className="text-slate-600 dark:text-slate-400">
                        Instruye a la IA sobre <strong>por qué</strong> se ha seleccionado este candidato o se ha modificado su precio. Tu justificación se usará como Regla de Oro para entrenar y mejorar los futuros presupuestos automáticamente.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-white/10 p-3 rounded-md text-sm">
                        <div className="font-semibold text-slate-700 dark:text-slate-300 mb-1">Partida Original:</div>
                        <div className="text-slate-600 dark:text-slate-400 font-mono text-xs">{item.originalTask || item.item?.description}</div>
                    </div>

                    <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-900/50 p-3 rounded-md text-sm">
                        <div className="font-semibold text-indigo-700 dark:text-indigo-400 mb-1">Candidato Actual Seleccionado:</div>
                        <div className="text-indigo-600 dark:text-indigo-300 font-mono text-xs">
                            [{item.item?.code || "SC"}] {item.item?.description} ({item.item?.unitPrice}€ / {item.item?.unit})
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                            Justificación del Experto (Alinear IA):
                        </label>
                        <Textarea
                            placeholder="Ej: Se escoge m3 en lugar de m2 porque la partida original menciona 'vaciado' y el catálogo sólo nos ofrece volumen. Se divide el precio entre 0.20m de grosor estimado."
                            className="min-h-[120px] resize-none"
                            value={reasoning}
                            onChange={(e) => setReasoning(e.target.value)}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button 
                        onClick={handleSave} 
                        disabled={isPending || !reasoning.trim()}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white"
                    >
                        {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Inyectar en AI Core
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

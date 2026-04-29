'use client';

/**
 * Fase 6.B — diálogo de captura de corrección.
 *
 * Se dispara cuando el aparejador modifica `unitPrice` o `unit` en una partida.
 * El objetivo es recoger el MOTIVO de la corrección (no el valor numérico —
 * ese ya lo captura `onUpdate` en el editor).
 *
 * Helpers puros (testables sin DOM) viven en `CorrectionCaptureDialog.helpers.tsx`.
 */

import React, { useState, useTransition } from 'react';
import { sileo } from 'sileo';
import { Loader2, BrainCircuit } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    CORRECTION_REASONS,
    type CorrectionReason,
} from '@/backend/ai-training/domain/heuristic-fragment-builder';
import { saveHeuristicCorrectionAction } from '@/actions/budget/save-heuristic-correction.action';
import {
    CorrectionReasonOptions,
    detectPriceOrUnitChange,
    type PriceOrUnitChange,
    type PriceOrUnitSnapshot,
} from './CorrectionCaptureDialog.helpers';

// Re-export helpers so consumers can import both from the same module.
export {
    CORRECTION_REASONS,
    CorrectionReasonOptions,
    detectPriceOrUnitChange,
};
export type { CorrectionReason, PriceOrUnitChange, PriceOrUnitSnapshot };

const h = React.createElement;

export interface CorrectionCaptureDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Contexto mínimo para construir el HeuristicFragment. */
    context: {
        budgetId: string;
        chapter: string;
        originalDescription: string;
        originalQuantity?: number | null;
        originalUnit?: string | null;
        aiProposedPrice: number;
        aiProposedCandidateId?: string | null;
        aiReasoning?: string | null;
        correctedPrice?: number | null;
        correctedUnit?: string | null;
        correctedByUserId?: string | null;
    };
}

export function CorrectionCaptureDialog({
    open,
    onOpenChange,
    context,
}: CorrectionCaptureDialogProps) {
    const [reason, setReason] = useState<CorrectionReason>('volumen');
    const [note, setNote] = useState('');
    const [isPending, startTransition] = useTransition();

    const handleSubmit = () => {
        startTransition(async () => {
            const result = await saveHeuristicCorrectionAction({
                ...context,
                reason,
                note,
            });
            if (result.success) {
                sileo.success({
                    title: 'Corrección registrada',
                    description: 'La IA aprenderá de este cambio en futuros presupuestos.',
                });
                onOpenChange(false);
                setReason('volumen');
                setNote('');
            } else {
                sileo.error({
                    title: 'No se pudo guardar',
                    description: result.error || 'Error interno al guardar la corrección.',
                });
            }
        });
    };

    return h(
        Dialog,
        { open, onOpenChange },
        h(
            DialogContent,
            { className: 'sm:max-w-[520px]' },
            h(
                DialogHeader,
                null,
                h(
                    DialogTitle,
                    { className: 'flex items-center gap-2 text-indigo-700 dark:text-indigo-400' },
                    h(BrainCircuit, { className: 'w-5 h-5' }),
                    '¿Por qué esta corrección?',
                ),
                h(
                    DialogDescription,
                    { className: 'text-slate-600 dark:text-slate-400' },
                    'La IA usará tu motivo como referencia para partidas similares en el futuro.',
                ),
            ),
            h(
                'div',
                { className: 'grid gap-4 py-4' },
                h(
                    'div',
                    { className: 'flex flex-col gap-2' },
                    h(
                        'label',
                        { className: 'text-sm font-semibold text-slate-700 dark:text-slate-300' },
                        'Motivo',
                    ),
                    h(CorrectionReasonOptions, {
                        value: reason,
                        onChange: setReason,
                        disabled: isPending,
                    }),
                ),
                h(
                    'div',
                    { className: 'flex flex-col gap-2' },
                    h(
                        'label',
                        { className: 'text-sm font-semibold text-slate-700 dark:text-slate-300' },
                        'Nota (opcional)',
                    ),
                    h(Textarea, {
                        placeholder:
                            'Ej: descuento del proveedor XYZ al superar 15 m² en la obra.',
                        className: 'min-h-[80px] resize-none',
                        value: note,
                        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) =>
                            setNote(e.target.value),
                        disabled: isPending,
                    }),
                ),
            ),
            h(
                DialogFooter,
                null,
                h(
                    Button,
                    {
                        variant: 'ghost',
                        onClick: () => onOpenChange(false),
                        disabled: isPending,
                    },
                    'Omitir',
                ),
                h(
                    Button,
                    {
                        onClick: handleSubmit,
                        disabled: isPending,
                        className: 'bg-indigo-600 hover:bg-indigo-700 text-white',
                    },
                    isPending && h(Loader2, { className: 'w-4 h-4 mr-2 animate-spin' }),
                    'Guardar motivo',
                ),
            ),
        ),
    );
}

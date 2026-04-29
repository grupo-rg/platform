/**
 * Fase 6.B — helpers puros del diálogo de captura de correcciones.
 *
 * Separados del propio `CorrectionCaptureDialog.tsx` porque ese componente
 * importa primitivas de ShadCN (Dialog, Button, Textarea) que son JSX y
 * rolldown no las procesa durante los tests. Estos helpers NO importan
 * ningún `@/components/ui/*`, así que son directamente testeables con
 * `renderToStaticMarkup` en Node puro.
 */

import React from 'react';

import {
    CORRECTION_REASONS,
    type CorrectionReason,
} from '@/backend/ai-training/domain/heuristic-fragment-builder';

const h = React.createElement;

// ---------- Pure helpers --------------------------------------------------------------

export interface PriceOrUnitSnapshot {
    unitPrice: number;
    unit: string;
}

export interface PriceOrUnitChange {
    priceChanged: boolean;
    unitChanged: boolean;
}

/**
 * Devuelve `null` si no hubo cambio o si `previous` no existe todavía
 * (primer render). Ignora ruido de float por debajo de 0.005 €.
 */
export function detectPriceOrUnitChange(
    previous: PriceOrUnitSnapshot | undefined,
    next: PriceOrUnitSnapshot,
): PriceOrUnitChange | null {
    if (!previous) return null;
    const priceChanged = Math.abs(previous.unitPrice - next.unitPrice) >= 0.005;
    const unitChanged = (previous.unit || '') !== (next.unit || '');
    if (!priceChanged && !unitChanged) return null;
    return { priceChanged, unitChanged };
}

// ---------- Dropdown primitive (native <select>, testable) ----------------------------

export interface CorrectionReasonOptionsProps {
    value: CorrectionReason;
    onChange: (value: CorrectionReason) => void;
    disabled?: boolean;
}

export function CorrectionReasonOptions({
    value,
    onChange,
    disabled,
}: CorrectionReasonOptionsProps) {
    return h(
        'select',
        {
            'data-testid': 'correction-reason-select',
            value,
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
                onChange(e.target.value as CorrectionReason),
            disabled,
            className:
                'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm ' +
                'dark:bg-zinc-900 dark:border-white/10 dark:text-white',
        },
        CORRECTION_REASONS.map((opt) =>
            h('option', { key: opt.value, value: opt.value }, opt.label),
        ),
    );
}

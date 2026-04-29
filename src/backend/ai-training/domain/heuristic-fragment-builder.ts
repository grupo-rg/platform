/**
 * Fase 6.B — builder puro para crear un `HeuristicFragment` a partir de la
 * corrección del aparejador sobre una partida.
 *
 * Separado del server action para tenerlo libre de side-effects y trivialmente
 * testeable. El action lo invoca para armar el payload y persistirlo en
 * Firestore (`heuristic_fragments`), que es la misma colección que el
 * `FirestoreHeuristicFragmentRepository` de Python lee en 6.C.
 */

import type { HeuristicFragment } from './heuristic-fragment';

/** Motivos canónicos del dropdown (Fase 6.B del plan). */
export const CORRECTION_REASONS = [
    { value: 'descuento_proveedor', label: 'Descuento proveedor' },
    { value: 'volumen', label: 'Volumen' },
    { value: 'error_ia', label: 'Error de la IA' },
    { value: 'calidad_premium', label: 'Calidad premium' },
    { value: 'otro', label: 'Otro' },
] as const;

export type CorrectionReason = typeof CORRECTION_REASONS[number]['value'];

export interface BuildHeuristicFragmentInput {
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
    reason: CorrectionReason;
    note?: string | null;
    correctedByUserId?: string | null;
    timestamp: Date;
}

export type HeuristicFragmentPayload = Omit<HeuristicFragment, 'id'>;

function buildHeuristicRule(reason: CorrectionReason, note?: string | null): string {
    const trimmed = (note ?? '').trim();
    return trimmed ? `${reason}: ${trimmed}` : reason;
}

export function buildHeuristicFragmentPayload(
    input: BuildHeuristicFragmentInput,
): HeuristicFragmentPayload {
    const chapterTag = `chapter:${input.chapter}`;
    const reasonTag = `reason:${input.reason}`;

    return {
        sourceType: 'internal_admin',
        status: 'pending_review',
        context: {
            budgetId: input.budgetId,
            originalDescription: input.originalDescription,
            originalQuantity: input.originalQuantity ?? null,
            originalUnit: input.originalUnit ?? null,
        },
        aiInferenceTrace: {
            proposedUnitPrice: input.aiProposedPrice,
            proposedCandidateId: input.aiProposedCandidateId ?? null,
            aiReasoning: input.aiReasoning ?? null,
        },
        humanCorrection: {
            correctedUnitPrice: input.correctedPrice ?? null,
            correctedUnit: input.correctedUnit ?? null,
            heuristicRule: buildHeuristicRule(input.reason, input.note),
            correctedByUserId: input.correctedByUserId ?? null,
        },
        tags: [chapterTag, reasonTag],
        timestamp: input.timestamp.toISOString(),
    };
}

'use server';

/**
 * Sprint 3 — S3-07 partial
 *
 * Server action que persiste un `CorrectionPair` cuando el humano corrige una
 * partida en el editor. UX: invisible (fire-and-forget desde el cliente). El
 * action devuelve `{ success, id?, correctionType?, error? }` para que el
 * caller pueda loguear en consola, pero no bloquea la edición.
 *
 * Reglas:
 *   - requiere sesión auth (no admin) — corrections del usuario logueado.
 *   - si AI no propuso nada material (no había `ai_proposed.code`), no
 *     registramos (es una creación manual, no una corrección).
 *   - dedupe best-effort por `id = ${budgetId}:${partidaCode}:${ts}` — caller
 *     controla la cadencia (un log por blur).
 */
import { randomUUID } from 'crypto';
import { verifyAuth } from '@/backend/auth/auth.middleware';
import { FirestoreCorrectionPairRepository } from '@/backend/ai-training/infrastructure/firestore-correction-pair-repository';
import {
    CorrectionPair,
    CorrectionType,
    classifyCorrection,
} from '@/backend/ai-training/domain/correction-pair';

export interface LogCorrectionPairInput {
    budgetId: string;
    partidaCode: string;
    queryText: string;
    aiProposed: {
        code: string;
        description: string;
        unitPrice: number;
        matchConfidence: number;
        unit?: string;
        quantity?: number;
    };
    humanChosen: {
        code: string;
        description: string;
        unitPrice: number;
        unit?: string;
        quantity?: number;
    };
}

export interface LogCorrectionPairResult {
    success: boolean;
    id?: string;
    correctionType?: CorrectionType;
    error?: string;
}

/**
 * Determina si la corrección es "no-op" — todos los campos materiales coinciden.
 * En ese caso no persistimos (evita basura RLHF).
 */
function isNoOpCorrection(
    ai: LogCorrectionPairInput['aiProposed'],
    human: LogCorrectionPairInput['humanChosen'],
): boolean {
    const codeEq = (ai.code || '').trim() === (human.code || '').trim();
    const priceEq = Math.abs((ai.unitPrice || 0) - (human.unitPrice || 0)) < 0.001;
    const unitEq =
        ai.unit === undefined ||
        human.unit === undefined ||
        (ai.unit || '').trim().toLowerCase() === (human.unit || '').trim().toLowerCase();
    const qtyEq =
        ai.quantity === undefined ||
        human.quantity === undefined ||
        Math.abs((ai.quantity || 0) - (human.quantity || 0)) < 0.001;
    return codeEq && priceEq && unitEq && qtyEq;
}

export async function logCorrectionPairAction(
    input: LogCorrectionPairInput,
): Promise<LogCorrectionPairResult> {
    try {
        // 1. Auth — cualquier usuario logueado puede registrar correcciones.
        const auth = await verifyAuth(false);
        if (!auth) {
            return { success: false, error: 'unauthenticated' };
        }

        // 2. Validación mínima — si no hay budgetId o ai.code no fue propuesto,
        //    saltamos (caller probablemente intentó loguear una creación manual).
        if (!input.budgetId || !input.partidaCode) {
            return { success: false, error: 'missing_budget_or_partida' };
        }
        if (!input.queryText || input.queryText.trim() === '') {
            return { success: false, error: 'missing_query_text' };
        }

        // 3. No-op guard — si todo coincide, descartamos silenciosamente.
        if (isNoOpCorrection(input.aiProposed, input.humanChosen)) {
            return { success: true, error: 'noop' };
        }

        // 4. Clasificar y persistir.
        const correctionType = classifyCorrection(input.aiProposed, input.humanChosen);

        const pair = CorrectionPair.create({
            id: randomUUID(),
            budgetId: input.budgetId,
            partidaCode: input.partidaCode,
            query_text: input.queryText,
            ai_proposed: input.aiProposed,
            human_chosen: input.humanChosen,
            corrected_by: auth.userId,
            correction_type: correctionType,
        });

        const repo = new FirestoreCorrectionPairRepository();
        await repo.save(pair);

        return { success: true, id: pair.id, correctionType };
    } catch (error: any) {
        console.error('[logCorrectionPairAction] failed', error);
        return { success: false, error: error?.message || 'unknown_error' };
    }
}

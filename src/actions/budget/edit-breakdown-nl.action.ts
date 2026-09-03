'use server';

/**
 * WS-D — server action del "Aparejador Copilot".
 *
 * Toma la partida (código, descripción, descompuesto actual) + una instrucción
 * en lenguaje natural, delega en `editBreakdownWithNlFlow` (Genkit, modelo del
 * registry vía `resolveModel('chat')`), valida/normaliza el descompuesto de
 * vuelta al esquema `BudgetBreakdownComponent[]` y devuelve un preview.
 *
 * NO muta nada: solo devuelve el nuevo descompuesto + precio unitario recalculado
 * para que el cliente muestre un diff y aplique bajo confirmación.
 *
 * Salvaguardas: valida el esquema (Zod en el flow), acota el alcance del cambio
 * (nº de componentes y ratio de variación de precio) y propaga `needsHumanReview`
 * cuando el LLM o los límites señalan incertidumbre.
 */

import { editBreakdownWithNlFlow } from '@/backend/ai/private/agents/breakdown-copilot.agent';
import type { BudgetBreakdownComponent } from '@/backend/budget/domain/budget';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Máximo de componentes en el descompuesto resultante (evita respuestas desbocadas). */
const MAX_COMPONENTS = 60;
/** Si el precio unitario resultante varía más de ×N (o < 1/N), marca revisión humana. */
const MAX_PRICE_CHANGE_RATIO = 4;

export interface EditBreakdownNlInput {
    code: string;
    description: string;
    unit: string;
    unitPrice: number;
    breakdown: any[];
    instruction: string;
}

export interface EditBreakdownNlResult {
    success: boolean;
    breakdown?: BudgetBreakdownComponent[];
    unitPrice?: number;
    needsHumanReview?: boolean;
    summary?: string;
    confidence?: 'high' | 'medium' | 'low';
    error?: string;
}

/** Clasifica el tipo por prefijo de código (convención COAATMCA). */
function classifyType(code?: string | null): BudgetBreakdownComponent['type'] {
    const c = (code || '').toLowerCase();
    if (c.startsWith('mo')) return 'LABOR';
    if (c.startsWith('mq')) return 'MACHINERY';
    if (c.startsWith('mt')) return 'MATERIAL';
    return 'OTHER';
}

const VALID_TYPES = ['LABOR', 'MATERIAL', 'MACHINERY', 'OTHER'];

/** Normaliza un componente del LLM al shape completo `BudgetBreakdownComponent` (+ unit para la UI). */
function normalizeComponent(c: any): BudgetBreakdownComponent {
    const price = Number(c.price ?? 0) || 0;
    const yieldQty = Number(c.yield ?? 1);
    const safeYield = Number.isFinite(yieldQty) ? yieldQty : 1;
    const unit: string | undefined = c.unit ?? undefined;
    const total = unit === '%' ? round2(price * (safeYield / 100)) : round2(price * safeYield);
    const type: BudgetBreakdownComponent['type'] = VALID_TYPES.includes(c.type)
        ? c.type
        : classifyType(c.code);

    return {
        code: c.code ?? undefined,
        concept: c.concept || c.code || 'Componente',
        type,
        price,
        unitPrice: price,
        yield: safeYield,
        quantity: safeYield,
        unit,
        total,
        totalPrice: total,
        is_variable: c.is_variable === true,
    } as BudgetBreakdownComponent;
}

export async function editBreakdownWithNlAction(
    input: EditBreakdownNlInput,
): Promise<EditBreakdownNlResult> {
    try {
        if (!input?.instruction || !input.instruction.trim()) {
            return { success: false, error: 'Escribe una instrucción para el copiloto.' };
        }
        if (!Array.isArray(input.breakdown) || input.breakdown.length === 0) {
            return { success: false, error: 'Esta partida no tiene un descompuesto editable.' };
        }

        // Payload mínimo y estable para el flow (evita arrastrar campos anidados pesados).
        const slimBreakdown = input.breakdown.map((c: any) => ({
            code: c.code ?? null,
            concept: c.concept ?? c.description ?? null,
            type: typeof c.type === 'string' ? c.type : null,
            unit: c.unit ?? null,
            price: c.price ?? c.unitPrice ?? null,
            yield: c.yield ?? c.quantity ?? null,
            quantity: c.quantity ?? c.yield ?? null,
            total: c.total ?? c.totalPrice ?? null,
            is_variable: c.is_variable === true,
        }));

        const raw = await editBreakdownWithNlFlow({
            code: input.code || '',
            description: input.description || '',
            unit: input.unit || 'ud',
            unitPrice: Number(input.unitPrice ?? 0),
            breakdown: slimBreakdown,
            instruction: input.instruction.trim(),
        });

        if (!raw?.components || raw.components.length === 0) {
            return { success: false, error: 'El copiloto no devolvió componentes.' };
        }
        // Salvaguarda de alcance: nº de componentes acotado.
        if (raw.components.length > MAX_COMPONENTS) {
            return {
                success: false,
                error: `El cambio propuesto es demasiado grande (${raw.components.length} componentes). Reformula la instrucción.`,
            };
        }

        const normalized = raw.components.map(normalizeComponent);
        const newUnitPrice = round2(normalized.reduce((acc, c) => acc + (c.total || 0), 0));

        // Salvaguarda de alcance: variación de precio desmesurada → revisión humana.
        const oldUnitPrice = Number(input.unitPrice ?? 0);
        let needsHumanReview = raw.needs_human_review === true || raw.confidence === 'low';
        if (oldUnitPrice > 0 && newUnitPrice > 0) {
            const ratio = newUnitPrice / oldUnitPrice;
            if (ratio > MAX_PRICE_CHANGE_RATIO || ratio < 1 / MAX_PRICE_CHANGE_RATIO) {
                needsHumanReview = true;
            }
        }

        console.log('[edit-breakdown-nl] applied', {
            code: input.code,
            instruction: input.instruction,
            oldUnitPrice,
            newUnitPrice,
            components: normalized.length,
            confidence: raw.confidence,
            needsHumanReview,
        });

        return {
            success: true,
            breakdown: normalized,
            unitPrice: newUnitPrice,
            needsHumanReview,
            summary: raw.summary,
            confidence: raw.confidence,
        };
    } catch (error: any) {
        console.error('[edit-breakdown-nl] failed', error);
        return {
            success: false,
            error: error?.message || 'Error al procesar la instrucción. Inténtalo de nuevo.',
        };
    }
}

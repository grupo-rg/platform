/**
 * Phase 17 — Detección de divergencia entre descompuesto y unit_price de partida.
 *
 * El backend ejecuta `reconcile_breakdown` en post-LLM y auto-fixea desviaciones
 * < 2%. Las que pasan ese umbral se persisten con `needs_reconciliation: true`
 * y el editor las flagea para que el admin decida qué hacer.
 *
 * Esta función adicional detecta el mismo patrón en cliente — útil cuando el
 * admin edita unit_price manualmente y los componentes ya no cuadran.
 */
import type { EditableBudgetLineItem } from '@/types/budget-editor';

export type DivergenceInfo = {
    /** True si la desviación supera la tolerancia visual (>0.5%) y la partida tiene breakdown evaluable. */
    hasDivergence: boolean;
    /** Suma actual de breakdown[i].total */
    sumBreakdown: number;
    /** unit_price * quantity */
    expectedTotal: number;
    /** sum_breakdown - expected (positivo = breakdown sobra; negativo = breakdown falta). */
    diffAmount: number;
    /** abs(diff) / expected (porcentaje absoluto, 0.05 = 5%). */
    diffPct: number;
};

const VISUAL_TOLERANCE = 0.005; // 0.5% — ignorar rounding/banker's vs half-up

export function detectDivergence(line: EditableBudgetLineItem): DivergenceInfo {
    const item = line.item;
    const noBreakdown = !item || !item.breakdown || item.breakdown.length === 0;

    // Skip casos donde el breakdown no es evaluable
    const matchKind = (item as any)?.match_kind;
    const skip = noBreakdown
        || matchKind === 'from_scratch'
        || (item as any)?.needsHumanReview === true
        || (item as any)?.is_estimated === true;

    if (skip) {
        return { hasDivergence: false, sumBreakdown: 0, expectedTotal: 0, diffAmount: 0, diffPct: 0 };
    }

    const breakdown = item!.breakdown!;
    const sumBreakdown = breakdown.reduce((s, b: any) => s + (b.total || b.totalPrice || 0), 0);
    const unitPrice = item!.unitPrice || 0;
    const quantity = item!.quantity || 0;
    const expectedTotal = unitPrice * quantity;

    if (expectedTotal <= 0) {
        return { hasDivergence: false, sumBreakdown, expectedTotal: 0, diffAmount: 0, diffPct: 0 };
    }

    // Comparamos sumBreakdown contra unitPrice (no contra unitPrice*quantity), porque
    // breakdown[].total ya está expresado por unidad de partida (yield_amount × precio).
    // unitPrice es lo que cuesta UNA unidad de partida → coincide con sum(breakdown.total).
    const diffAmount = sumBreakdown - unitPrice;
    const diffPct = unitPrice > 0 ? Math.abs(diffAmount) / unitPrice : 0;

    return {
        hasDivergence: diffPct > VISUAL_TOLERANCE,
        sumBreakdown,
        expectedTotal,
        diffAmount,
        diffPct,
    };
}

export type ReconcilePartidaInput = {
    partidaId: string;
    unitPrice: number;
    sumBreakdownBefore: number;
    componentScales: { code: string | null; before: number; after: number }[];
};

/**
 * Calcula el preview de reconciliación de una partida (sin mutar nada).
 * Útil para el modal de diff antes de confirmar.
 */
export function previewReconcile(line: EditableBudgetLineItem): ReconcilePartidaInput | null {
    const div = detectDivergence(line);
    if (!div.hasDivergence) return null;
    const item = line.item!;
    const breakdown = item.breakdown!;
    const scale = item.unitPrice > 0 && div.sumBreakdown > 0 ? item.unitPrice / div.sumBreakdown : 1;
    return {
        partidaId: line.id,
        unitPrice: item.unitPrice,
        sumBreakdownBefore: div.sumBreakdown,
        componentScales: breakdown.map((b: any) => ({
            code: b.code ?? null,
            before: b.total || 0,
            after: Math.round((b.total || 0) * scale * 100) / 100,
        })),
    };
}

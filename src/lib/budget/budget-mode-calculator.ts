/**
 * Fase 11.D — Cálculo del total de una partida según el modo de presupuesto.
 *
 * Tres modos canónicos que mapean al dropdown del editor (existente):
 *   - COMPLETE         ↔ executionMode='complete'
 *   - LABOR_AND_FIXED  ↔ executionMode='execution'  (todo excepto is_variable)
 *   - LABOR_ONLY       ↔ executionMode='labor'      (solo mo*)
 *
 * Sin breakdown, modo COMPLETE devuelve el unitPrice; los modos parciales
 * devuelven 0 (no podemos descomponer un agregado).
 */

import { BreakdownCategory, categorizeComponent } from './breakdown-category';

export const BudgetMode = {
    COMPLETE: 'complete',
    LABOR_AND_FIXED: 'labor_and_fixed',
    LABOR_ONLY: 'labor_only',
} as const;

export type BudgetMode = (typeof BudgetMode)[keyof typeof BudgetMode];

/** Mapping desde el `executionMode` legacy del editor a la enum canónica. */
export function executionModeToBudgetMode(em: string | null | undefined): BudgetMode {
    if (em === 'execution') return BudgetMode.LABOR_AND_FIXED;
    if (em === 'labor') return BudgetMode.LABOR_ONLY;
    return BudgetMode.COMPLETE;
}

const _CATEGORIES_INCLUDED: Record<BudgetMode, Set<BreakdownCategory>> = {
    [BudgetMode.COMPLETE]: new Set<BreakdownCategory>([
        BreakdownCategory.LABOR,
        BreakdownCategory.MATERIAL_FIXED,
        BreakdownCategory.MATERIAL_VARIABLE,
        BreakdownCategory.MACHINERY,
        BreakdownCategory.INDIRECT,
        BreakdownCategory.OTHER,
    ]),
    [BudgetMode.LABOR_AND_FIXED]: new Set<BreakdownCategory>([
        BreakdownCategory.LABOR,
        BreakdownCategory.MATERIAL_FIXED,
        BreakdownCategory.MACHINERY,
        BreakdownCategory.INDIRECT,
        BreakdownCategory.OTHER,
    ]),
    [BudgetMode.LABOR_ONLY]: new Set<BreakdownCategory>([
        BreakdownCategory.LABOR,
    ]),
};

interface BreakdownLike {
    code?: string | null;
    type?: string | null;
    is_variable?: boolean | null;
    isVariable?: boolean | null; // alias por retrocompat con UI
    total?: number | null;
    totalPrice?: number | null;
    price?: number | null;
    unitPrice?: number | null;
    yield?: number | null;
    quantity?: number | null;
}

function _componentTotal(comp: BreakdownLike): number {
    // Resuelve el total efectivo del componente dado el zoo de aliases del frontend.
    if (typeof comp.totalPrice === 'number') return comp.totalPrice;
    if (typeof comp.total === 'number') return comp.total;
    const price = comp.unitPrice ?? comp.price ?? 0;
    const qty = comp.quantity ?? comp.yield ?? 1;
    return price * qty;
}

export function computeUnitPriceForMode(
    breakdown: BreakdownLike[] | null | undefined,
    fallbackUnitPrice: number,
    mode: BudgetMode,
): number {
    if (mode === BudgetMode.COMPLETE && (!breakdown || breakdown.length === 0)) {
        return fallbackUnitPrice;
    }
    if (!breakdown || breakdown.length === 0) {
        return 0;
    }

    const included = _CATEGORIES_INCLUDED[mode];
    let total = 0;
    for (const comp of breakdown) {
        const isVariable = comp.is_variable ?? comp.isVariable ?? null;
        const category = categorizeComponent(comp.code, comp.type, isVariable);
        if (included.has(category)) {
            total += _componentTotal(comp);
        }
    }
    return total;
}

export function computePartidaTotalForMode(
    breakdown: BreakdownLike[] | null | undefined,
    fallbackUnitPrice: number,
    quantity: number,
    mode: BudgetMode,
): number {
    return computeUnitPriceForMode(breakdown, fallbackUnitPrice, mode) * quantity;
}

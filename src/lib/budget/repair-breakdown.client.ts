'use client';

/**
 * Orquestación client-side para reparar descompuestos a 0 desde el catálogo
 * COAATMCA. La matemática pura vive en `reconciliation.ts`; aquí resolvemos la
 * fuente de precios (server action o breakdown embebido) y aplicamos el patch.
 */
import type { EditableBudgetLineItem } from '@/types/budget-editor';
import type { BudgetBreakdownComponent } from '@/backend/budget/domain/budget';
import { getCatalogBreakdownForRepair } from '@/actions/price-book/get-price-book-breakdown.action';
import {
    buildRepairedBreakdown,
    scaleBreakdownToUnitPrice,
    getWinnerCatalogCode,
    hasZeroPricedComponent,
    type NormalizedCatalogComponent,
} from '@/lib/budget/reconciliation';

export { getWinnerCatalogCode } from '@/lib/budget/reconciliation';

/** Normaliza un breakdown embebido (`selected_candidate.breakdown`) a componentes de catálogo. */
function normalizeEmbedded(breakdown: any[]): NormalizedCatalogComponent[] {
    return breakdown.map((b) => {
        const quantity = Number(b.quantity ?? b.yield ?? 0);
        const unitPrice = Number(b.price ?? b.unitPrice ?? b.price_unit ?? 0);
        const lineTotal = typeof b.total === 'number' && b.total > 0
            ? b.total
            : (b.unit === '%' ? unitPrice * (quantity / 100) : unitPrice * quantity);
        return {
            code: b.code,
            description: b.description ?? b.concept,
            unit: b.unit,
            quantity,
            unitPrice,
            lineTotal,
            is_variable: b.is_variable === true || b.isVariable === true,
        };
    });
}

/**
 * Resuelve los componentes de catálogo para reparar una partida. Prioriza el
 * fetch de Firestore (totales de línea fieles, incl. `%`); si falla, usa el
 * breakdown embebido en `selected_candidate`.
 */
export async function resolveCatalogComponents(
    line: EditableBudgetLineItem,
): Promise<NormalizedCatalogComponent[] | null> {
    const winnerCode = getWinnerCatalogCode(line);
    if (winnerCode) {
        try {
            const res = await getCatalogBreakdownForRepair(winnerCode);
            if (res.success && res.components.length > 0) return res.components;
        } catch {
            // cae al fallback embebido
        }
    }
    const item: any = line.item;
    const winner = item?.aiResolution?.selected_candidate ?? item?.ai_resolution?.selected_candidate;
    const embedded = winner && typeof winner !== 'string' ? winner.breakdown : null;
    if (embedded && embedded.length > 0) return normalizeEmbedded(embedded);
    return null;
}

/**
 * Calcula el descompuesto reparado de una partida divergente:
 *  - Si el breakdown ya suma > 0 → lo escala al unit_price (edición manual).
 *  - Si suma ~0 → re-pobla desde el catálogo y escala.
 * Devuelve null si no se puede reparar (sin catálogo y sum 0).
 */
export async function computeRepairedBreakdown(
    line: EditableBudgetLineItem,
): Promise<BudgetBreakdownComponent[] | null> {
    const item = line.item;
    if (!item) return null;
    const unitPrice = item.unitPrice || 0;
    if (unitPrice <= 0) return null;

    const breakdown = (item.breakdown || []) as BudgetBreakdownComponent[];
    const sum = breakdown.reduce((s, c: any) => s + Number(c.total ?? c.totalPrice ?? 0), 0);

    // Si faltan precios de componentes (algún componente a 0, o suma a 0), la
    // fuente correcta es el catálogo: re-poblamos y escalamos. Solo escalamos el
    // descompuesto existente cuando está completo pero diverge (edición manual).
    if (sum <= 0.005 || hasZeroPricedComponent(line)) {
        const catalog = await resolveCatalogComponents(line);
        if (catalog) return buildRepairedBreakdown(catalog, unitPrice);
        // Sin catálogo: si al menos suma algo, escalamos como último recurso.
    }

    if (sum > 0.005) {
        return scaleBreakdownToUnitPrice(breakdown, unitPrice);
    }
    return null;
}

/** Construye el patch `item` con el breakdown reparado y los flags de divergencia limpiados. */
export function buildRepairPatch(item: any, breakdown: BudgetBreakdownComponent[]) {
    return {
        ...item,
        breakdown,
        needs_reconciliation: false,
        divergence_pct: undefined,
        divergence_amount: undefined,
        last_reconciled_at: new Date().toISOString(),
        reconciled_by: 'editor',
    };
}

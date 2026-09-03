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
    unit?: string | null; // p.ej. 'h', 'm2', '%' (medios auxiliares)
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
    // Medios auxiliares (unit '%'): el "yield"/cantidad es un porcentaje sobre
    // el precio, no un multiplicador directo. Espejo de `calculateCompTotal`
    // en BudgetBreakdownSheet. Solo aplica cuando NO hay total guardado.
    if (comp.unit === '%') {
        return price * (qty / 100);
    }
    return price * qty;
}

/**
 * ¿Es el componente un "compuesto opaco" para el reparto por modos?
 *
 * Un componente que es a su vez una PARTIDA/compuesto del catálogo (p.ej.
 * `DRA010`, `D3001.0080`, típico de descompuestos 1:N) NO tiene prefijo básico
 * mo/mt/mq/ci/% → `categorizeComponent` lo clasifica como OTHER. Su verdadero
 * reparto (mano de obra / material / maquinaria) vive un nivel más abajo, en el
 * sub-descompuesto del catálogo, que NO está disponible de forma síncrona en el
 * cliente (se carga lazy vía `getPriceBookBreakdown`, ver ComponentSubBreakdown).
 *
 * En modos parciales esto lo haría contribuir €0 (LABOR_ONLY) o su total íntegro
 * (LABOR_AND_FIXED) — nunca su reparto exacto. Por eso lo marcamos como opaco
 * para poder señalar el total como "reparto aproximado" en lugar de infravalorar
 * en silencio.
 */
function _isOpaqueComposite(comp: BreakdownLike): boolean {
    const isVariable = comp.is_variable ?? comp.isVariable ?? null;
    return categorizeComponent(comp.code, comp.type, isVariable) === BreakdownCategory.OTHER;
}

/**
 * Resultado detallado del cálculo de un modo, con bandera de honestidad.
 *
 * NOTA (fix robusto, fuera de esta ola / cliente): la solución definitiva es
 * **precalcular y persistir** por partida los subtotales por categoría
 * (labor/material_fijo/material_var/maquinaria/indirectos) en el backend de
 * generación (Python, `services/ai-core/`). Con eso el modo lee un número
 * exacto y `isApproximate` sería siempre false. Requiere redeploy de Cloud Run
 * + re-generar; NO se hace aquí (esta ola es solo cliente). Mientras tanto,
 * `isApproximate` evita el falso €0 silencioso en partidas compuestas.
 */
export interface ModeTotalResult {
    /** Precio unitario del modo. */
    unitPrice: number;
    /** Total del modo (unitPrice × quantity). */
    total: number;
    /**
     * True cuando el número es un REPARTO APROXIMADO, no exacto:
     *   - hay componentes compuestos/opacos (categoría OTHER, sin prefijo básico)
     *     cuyo sub-descompuesto no es visible en cliente; o
     *   - no hay descompuesto y el modo parcial no puede desglosar el agregado.
     * COMPLETE nunca es aproximado (suma todo). El caller debe mostrar un
     * indicador ("reparto aproximado") en lugar de dar un total silencioso.
     */
    isApproximate: boolean;
}

/** ¿El total del modo es aproximado (no exacto) para este descompuesto? */
function _modeIsApproximate(
    breakdown: BreakdownLike[] | null | undefined,
    fallbackUnitPrice: number,
    mode: BudgetMode,
): boolean {
    if (mode === BudgetMode.COMPLETE) return false;
    if (!breakdown || breakdown.length === 0) {
        // Agregado sin descompuesto: en un modo parcial no podemos separar la
        // mano de obra → 0 sería un infravalor silencioso si hay precio real.
        return fallbackUnitPrice > 0;
    }
    return breakdown.some(_isOpaqueComposite);
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

/** Como `computeUnitPriceForMode` pero devuelve además la bandera `isApproximate`. */
export function computeUnitPriceForModeDetailed(
    breakdown: BreakdownLike[] | null | undefined,
    fallbackUnitPrice: number,
    mode: BudgetMode,
): { unitPrice: number; isApproximate: boolean } {
    return {
        unitPrice: computeUnitPriceForMode(breakdown, fallbackUnitPrice, mode),
        isApproximate: _modeIsApproximate(breakdown, fallbackUnitPrice, mode),
    };
}

export function computePartidaTotalForMode(
    breakdown: BreakdownLike[] | null | undefined,
    fallbackUnitPrice: number,
    quantity: number,
    mode: BudgetMode,
): number {
    return computeUnitPriceForMode(breakdown, fallbackUnitPrice, mode) * quantity;
}

/**
 * Como `computePartidaTotalForMode` pero devuelve `{ total, unitPrice, isApproximate }`.
 * La bandera permite al caller (fila/resumen) mostrar "reparto aproximado" en
 * vez de un total infravalorado en silencio en partidas compuestas.
 */
export function computePartidaTotalForModeDetailed(
    breakdown: BreakdownLike[] | null | undefined,
    fallbackUnitPrice: number,
    quantity: number,
    mode: BudgetMode,
): ModeTotalResult {
    const unitPrice = computeUnitPriceForMode(breakdown, fallbackUnitPrice, mode);
    return {
        unitPrice,
        total: unitPrice * quantity,
        isApproximate: _modeIsApproximate(breakdown, fallbackUnitPrice, mode),
    };
}

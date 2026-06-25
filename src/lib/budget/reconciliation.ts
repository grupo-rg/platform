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
import type { BudgetBreakdownComponent } from '@/backend/budget/domain/budget';

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

// ---------------------------------------------------------------------------
// Reparación de descompuestos a 0 desde el catálogo COAATMCA.
//
// Cuando una partida emparejó correctamente con el catálogo pero su breakdown
// persistido llegó con precios a 0 (sum = 0), no se puede "escalar" (escalar 0
// da 0). En su lugar re-poblamos los precios desde el catálogo y luego escalamos
// para que el sumatorio cuadre con el unit_price validado (que en budgets
// phase17 ya viene baked con margen). El total de la partida NO cambia.
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Componente de catálogo normalizado. Cada fuente (server action v005, breakdown
 * embebido en `selected_candidate`, o el JSON COAATMCA del script de backfill)
 * mapea su shape a éste antes de construir el descompuesto reparado.
 *
 * `lineTotal` es el total de línea del componente (p.ej. `%` = 4% de la base =
 * 2,89 €), NO `unitPrice × quantity` — clave para que `%` (medios auxiliares)
 * sea correcto.
 */
export type NormalizedCatalogComponent = {
    code?: string;
    description?: string;
    unit?: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    is_variable?: boolean;
};

/** Clasifica el tipo de componente por prefijo de código (convención COAATMCA). */
function classifyComponentType(code: string): BudgetBreakdownComponent['type'] {
    const c = (code || '').toLowerCase();
    if (c.startsWith('mo')) return 'LABOR';
    if (c.startsWith('mq')) return 'MACHINERY';
    if (c.startsWith('mt')) return 'MATERIAL';
    return 'OTHER';
}

/** Mapea componentes de catálogo normalizados a `BudgetBreakdownComponent[]`. */
export function mapCatalogToBreakdown(comps: NormalizedCatalogComponent[]): BudgetBreakdownComponent[] {
    return comps.map((c) => {
        const code = c.code || '';
        const quantity = Number(c.quantity || 0);
        const unitPrice = Number(c.unitPrice || 0);
        const total = typeof c.lineTotal === 'number' ? c.lineTotal : unitPrice * quantity;
        return {
            code,
            concept: c.description || code || 'Componente',
            type: classifyComponentType(code),
            price: unitPrice,
            unitPrice,
            yield: quantity,
            quantity,
            total: round2(total),
            totalPrice: round2(total),
            is_variable: c.is_variable === true,
        };
    });
}

/**
 * Escala un descompuesto para que `sum(total) === unitPrice`, preservando las
 * proporciones entre componentes. Back-calcula `price` desde el nuevo total y el
 * rendimiento (misma lógica que `reconcile-partidas.action`). Devuelve copia nueva.
 */
export function scaleBreakdownToUnitPrice(
    comps: BudgetBreakdownComponent[],
    unitPrice: number,
): BudgetBreakdownComponent[] {
    const sum = comps.reduce((s, c: any) => s + (c.total || c.totalPrice || 0), 0);
    if (sum <= 0 || unitPrice <= 0) return comps;
    const scale = unitPrice / sum;
    return comps.map((c: any) => {
        const newTotal = round2((c.total || c.totalPrice || 0) * scale);
        const yieldQty = c.yield || c.quantity || 0;
        const newPrice = yieldQty > 0 ? round2(newTotal / yieldQty) : round2((c.price || c.unitPrice || 0) * scale);
        return { ...c, total: newTotal, totalPrice: newTotal, price: newPrice, unitPrice: newPrice };
    });
}

/**
 * Construye el descompuesto reparado: re-pobla desde el catálogo y escala al
 * `unitPrice` validado. Garantiza divergencia 0.
 */
export function buildRepairedBreakdown(
    catalogComps: NormalizedCatalogComponent[],
    unitPrice: number,
): BudgetBreakdownComponent[] {
    return scaleBreakdownToUnitPrice(mapCatalogToBreakdown(catalogComps), unitPrice);
}

/** Código del candidato del catálogo emparejado por la IA, si existe. */
export function getWinnerCatalogCode(line: EditableBudgetLineItem): string | null {
    const item: any = line.item;
    const winner = item?.aiResolution?.selected_candidate ?? item?.ai_resolution?.selected_candidate;
    if (!winner) return null;
    const code = typeof winner === 'string' ? winner : winner.code;
    return code ? String(code) : null;
}

/**
 * True si el descompuesto tiene al menos un componente con precio Y total a 0 —
 * síntoma del bug de "precios perdidos" del catálogo. Detecta tanto el caso
 * total (todos a 0 → divergencia) como el parcial (algunos a 0 pero la suma
 * coincide por casualidad con el unit_price, p.ej. NL-15, sin divergencia).
 */
export function hasZeroPricedComponent(line: EditableBudgetLineItem): boolean {
    const bd = line.item?.breakdown;
    if (!bd || bd.length === 0) return false;
    return bd.some((c: any) => {
        const total = Number(c.total ?? c.totalPrice ?? 0);
        const price = Number(c.price ?? c.unitPrice ?? 0);
        return total <= 0.0001 && price <= 0.0001;
    });
}

/**
 * Predicado unificado usado por banner, modal y panel lateral: la partida
 * necesita reconciliación si hay divergencia de sumatorios, o si tiene
 * componentes a 0 reparables desde el catálogo (candidato emparejado).
 */
export function needsReconciliation(line: EditableBudgetLineItem): boolean {
    if (detectDivergence(line).hasDivergence) return true;
    return hasZeroPricedComponent(line) && !!getWinnerCatalogCode(line);
}

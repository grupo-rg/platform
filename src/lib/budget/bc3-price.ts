/**
 * BC3 doble precio — reglas puras compartidas por el editor y el learning loop.
 *
 * Escalas: `bc3_unit_price` y `ai_unit_price` se persisten SIN GG+BI (raw),
 * mientras que en presupuestos phase17 el `unitPrice` lleva el markup horneado
 * (`bake_markup_into_budget` → round(raw × bakedFactor, 2)). Para mostrar,
 * comparar o aplicar un precio de fuente hay que llevarlo a la escala del
 * `unitPrice`; si no, cambiar de fuente pierde el ×1,25.
 *
 * "Precio editado": la fuente activa ('bc3' | 'ai') se mantiene y el override
 * se DERIVA de que el `unitPrice` ya no coincide con el precio de esa fuente.
 * No se persiste un tercer valor ('manual') porque ai-core valida
 * `active_price_source` como Literal['bc3', 'ai'] al releer el presupuesto.
 */

/** Tolerancia en €: absorbe el redondeo a céntimos (Python half-even vs JS half-up). */
export const PRICE_EPS = 0.011;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Precio raw de una fuente (BC3 / IA) llevado a la escala del `unitPrice` persistido. */
export function toStoredScale(raw: number | null | undefined, bakedFactor: number): number | null {
    if (raw == null || !Number.isFinite(Number(raw))) return null;
    return round2(Number(raw) * (bakedFactor > 0 ? bakedFactor : 1));
}

/** True si el precio vigente se ha movido del precio de su fuente (edición manual, ajuste…). */
export function isPriceOverride(unitPrice: number | null | undefined, sourceStored: number | null): boolean {
    if (sourceStored == null) return false;
    return Math.abs(Number(unitPrice ?? 0) - sourceStored) > PRICE_EPS;
}

/**
 * Learning loop: ¿el usuario editó a mano el precio de una partida con fuente BC3?
 * Compara contra el precio BC3 con y sin GG+BI: el editor antiguo aplicaba el
 * precio BC3 raw al cambiar de fuente (perdía el markup), y eso NO es una
 * corrección humana — aprenderlo contaminaría el factor con precios de terceros.
 */
export function isManualOverBc3(
    item: { bc3_unit_price?: number | null; unitPrice?: number | null } | null | undefined,
    bakeFactor: number,
): boolean {
    const bc3 = Number(item?.bc3_unit_price);
    const unitPrice = Number(item?.unitPrice);
    if (item?.bc3_unit_price == null || !Number.isFinite(bc3) || bc3 <= 0) return false;
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return false;
    const baked = toStoredScale(bc3, bakeFactor)!;
    return isPriceOverride(unitPrice, baked) && isPriceOverride(unitPrice, round2(bc3));
}

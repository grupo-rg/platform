/**
 * Fase 11.D — Categorización de componentes del breakdown (espejo del módulo Python).
 *
 * Cruza 3 señales para clasificar cada componente:
 *  1. `code` prefix (mo/mt/mq/%/ci) — autoritativo del catálogo COAATMCA.
 *  2. `type` emitido por el LLM (LABOR / MATERIAL / MACHINERY / OTHER) — fallback.
 *  3. `is_variable` — refina MATERIAL en FIXED vs VARIABLE.
 *
 * Si las señales discrepan, prevalece el code prefix.
 */

export const BreakdownCategory = {
    LABOR: 'labor',
    MATERIAL_FIXED: 'material_fixed',
    MATERIAL_VARIABLE: 'material_variable',
    MACHINERY: 'machinery',
    INDIRECT: 'indirect',
    OTHER: 'other',
} as const;

export type BreakdownCategory = (typeof BreakdownCategory)[keyof typeof BreakdownCategory];

const _CODE_PREFIX_TO_CATEGORY: Record<string, BreakdownCategory> = {
    mo: BreakdownCategory.LABOR,
    mt: BreakdownCategory.MATERIAL_FIXED,
    mq: BreakdownCategory.MACHINERY,
    ci: BreakdownCategory.INDIRECT,
};

const _TYPE_FALLBACK: Record<string, BreakdownCategory> = {
    LABOR: BreakdownCategory.LABOR,
    MATERIAL: BreakdownCategory.MATERIAL_FIXED,
    MACHINERY: BreakdownCategory.MACHINERY,
    OTHER: BreakdownCategory.OTHER,
};

function _prefixLookup(code: string | null | undefined): BreakdownCategory | null {
    if (!code) return null;
    const codeLower = code.trim().toLowerCase();
    if (codeLower.startsWith('%')) return BreakdownCategory.INDIRECT;
    for (const [prefix, category] of Object.entries(_CODE_PREFIX_TO_CATEGORY)) {
        if (prefix.length >= 2 && codeLower.startsWith(prefix)) return category;
    }
    return null;
}

export function categorizeComponent(
    code: string | null | undefined,
    type: string | null | undefined,
    isVariable: boolean | null | undefined,
): BreakdownCategory {
    let base = _prefixLookup(code);
    if (base === null && type) {
        base = _TYPE_FALLBACK[type.trim().toUpperCase()] ?? null;
    }
    if (base === null) return BreakdownCategory.OTHER;

    if (base === BreakdownCategory.MATERIAL_FIXED && isVariable === true) {
        return BreakdownCategory.MATERIAL_VARIABLE;
    }
    return base;
}

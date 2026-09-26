/**
 * Resolver PURO del ajuste de precio de materiales (espejo del módulo Python).
 *
 * Sin imports server-only: lo usan tanto cliente como servidor. Dado un
 * material (sku / categoría) y su contexto (presupuesto / cliente) más el
 * conjunto de reglas cargadas, devuelve el factor multiplicativo a aplicar y
 * qué regla lo produjo.
 *
 * Política "el más específico gana": se filtra primero por `active === true` y
 * luego se busca la PRIMERA coincidencia en orden de precedencia
 * (más específico → menos):
 *   1. budget    → target.budgetId === input.budgetId  (solo si input.budgetId)
 *   2. client    → target.leadId   === input.leadId    (solo si input.leadId)
 *   3. material  → target.sku      === input.sku        (solo si input.sku)
 *   4. category  → target.category coincide con la categoría del material o es
 *                  su ancestro (categorías son texto libre "Padre > Hijo")
 *   5. global    → siempre coincide
 *
 * Se aplica UNA sola regla. `factor = 1 + adjustmentPct / 100`. Sin
 * coincidencia → `{ factor: 1, appliedRule: null }`.
 *
 * NOTA para el caller: si hay varias reglas del mismo scope que coinciden, gana
 * la PRIMERA encontrada (no se ordena por fecha). El caller no debe crear
 * duplicados dentro de un mismo scope.
 */

import type { MaterialPriceRule } from '@/backend/material-catalog/domain/material-price-rule';

export interface MaterialPriceResolverInput {
    sku?: string | null;
    category?: string | null;
    budgetId?: string | null;
    leadId?: string | null;
}

export interface MaterialPriceResolution {
    factor: number;
    appliedRule: MaterialPriceRule | null;
}

/**
 * Normaliza los espacios alrededor de los separadores '>' de una categoría
 * jerárquica libre, para que "Padre>Hijo", "Padre > Hijo" y "Padre  >  Hijo"
 * comparen igual.
 */
function normalizeCategory(category: string): string {
    return category
        .split('>')
        .map((segment) => segment.trim())
        .join(' > ');
}

/**
 * Una categoría objetivo coincide si es exactamente igual a la del material o
 * si es un ancestro de ella (la del material empieza por `target > `).
 */
function categoryMatches(target: string | undefined, matCategory: string | null | undefined): boolean {
    if (!target || !matCategory) return false;
    const t = normalizeCategory(target);
    const m = normalizeCategory(matCategory);
    return m === t || m.startsWith(`${t} > `);
}

export function resolveMaterialFactor(
    input: MaterialPriceResolverInput,
    rules: MaterialPriceRule[],
): MaterialPriceResolution {
    const active = rules.filter((rule) => rule.active === true);

    const predicates: Array<(rule: MaterialPriceRule) => boolean> = [
        // 1. budget (más específico)
        (rule) =>
            rule.scope === 'budget' &&
            !!input.budgetId &&
            rule.target.budgetId === input.budgetId,
        // 2. client
        (rule) =>
            rule.scope === 'client' &&
            !!input.leadId &&
            rule.target.leadId === input.leadId,
        // 3. material
        (rule) =>
            rule.scope === 'material' &&
            !!input.sku &&
            rule.target.sku === input.sku,
        // 4. category (igual o ancestro)
        (rule) =>
            rule.scope === 'category' &&
            categoryMatches(rule.target.category, input.category),
        // 5. global (siempre coincide)
        (rule) => rule.scope === 'global',
    ];

    for (const matches of predicates) {
        const appliedRule = active.find(matches);
        if (appliedRule) {
            return {
                factor: 1 + appliedRule.adjustmentPct / 100,
                appliedRule,
            };
        }
    }

    return { factor: 1, appliedRule: null };
}

'use server';

import { requireAdminOrFail, materialPriceRuleRepo } from './_shared';
import type { MaterialPriceRule } from '@/backend/material-catalog/domain/material-price-rule';

type ListResult =
    | { success: true; rules: MaterialPriceRule[] }
    | { success: false; error: string };

/**
 * Devuelve TODAS las reglas (activas e inactivas) para el panel admin.
 * Admin-gated. Los documentos ya son JSON plano (timestamps como ISO strings),
 * así que son serializables a través del boundary de Server Actions sin conversión.
 */
export async function listMaterialPriceRulesAction(): Promise<ListResult> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };

    try {
        const rules = await materialPriceRuleRepo.listAll();
        return { success: true, rules };
    } catch (e: any) {
        console.error('[listMaterialPriceRulesAction]', e);
        return { success: false, error: e?.message || 'list_failed' };
    }
}

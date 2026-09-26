'use server';

import { revalidatePath } from 'next/cache';
import {
    ADMIN_PRICES_PATH,
    materialPriceRuleRepo,
    requireAdminOrFail,
} from './_shared';

type ToggleResult = { success: true } | { success: false; error: string };

/**
 * Activa/desactiva una regla sin tocar el resto de campos (usa el método
 * dedicado `setActive`, que refresca `updatedAt`). Admin-gated. Solo las reglas
 * activas participan en la resolución del factor.
 */
export async function toggleMaterialPriceRuleAction(
    id: string,
    active: boolean,
): Promise<ToggleResult> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };
    if (!id) return { success: false, error: 'id requerido' };
    if (typeof active !== 'boolean') return { success: false, error: 'active debe ser boolean' };

    try {
        await materialPriceRuleRepo.setActive(id, active);

        revalidatePath(ADMIN_PRICES_PATH, 'page');
        return { success: true };
    } catch (e: any) {
        console.error('[toggleMaterialPriceRuleAction]', e);
        return { success: false, error: e?.message || 'toggle_failed' };
    }
}

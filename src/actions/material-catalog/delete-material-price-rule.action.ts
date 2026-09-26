'use server';

import { revalidatePath } from 'next/cache';
import {
    ADMIN_PRICES_PATH,
    materialPriceRuleRepo,
    requireAdminOrFail,
} from './_shared';

type DeleteResult = { success: true } | { success: false; error: string };

/**
 * Borra una regla de ajuste de precio. Admin-gated. La colección es pequeña y
 * gestionada por admin; el borrado es un delete directo del documento.
 */
export async function deleteMaterialPriceRuleAction(id: string): Promise<DeleteResult> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };
    if (!id) return { success: false, error: 'id requerido' };

    try {
        await materialPriceRuleRepo.delete(id);

        revalidatePath(ADMIN_PRICES_PATH, 'page');
        return { success: true };
    } catch (e: any) {
        console.error('[deleteMaterialPriceRuleAction]', e);
        return { success: false, error: e?.message || 'delete_failed' };
    }
}

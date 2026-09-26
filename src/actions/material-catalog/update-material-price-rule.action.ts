'use server';

import { revalidatePath } from 'next/cache';
import {
    ADMIN_PRICES_PATH,
    MaterialPriceRulePatchSchema,
    materialPriceRuleRepo,
    requireAdminOrFail,
    zodMessage,
    type MaterialPriceRulePatch,
} from './_shared';

type UpdateResult = { success: true } | { success: false; error: string };

/**
 * Aplica un patch parcial a una regla existente y refresca `updatedBy`/`updatedAt`
 * (este último lo sella el repo). Admin-gated.
 *
 * El repo ya impide sobrescribir `id`/`createdAt`/`createdBy`. No revalidamos
 * coherencia scope↔target aquí porque el patch puede tocar solo uno de los dos
 * (validarlo requeriría leer el doc); esa comprobación vive en create/preview,
 * donde llega la regla completa.
 */
export async function updateMaterialPriceRuleAction(
    id: string,
    patch: MaterialPriceRulePatch,
): Promise<UpdateResult> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };
    if (!id) return { success: false, error: 'id requerido' };

    const parsed = MaterialPriceRulePatchSchema.safeParse(patch);
    if (!parsed.success) return { success: false, error: zodMessage(parsed.error) };

    try {
        await materialPriceRuleRepo.update(id, {
            ...parsed.data,
            updatedBy: guard.who,
        });

        revalidatePath(ADMIN_PRICES_PATH, 'page');
        return { success: true };
    } catch (e: any) {
        console.error('[updateMaterialPriceRuleAction]', e);
        return { success: false, error: e?.message || 'update_failed' };
    }
}

'use server';

import { revalidatePath } from 'next/cache';
import {
    ADMIN_PRICES_PATH,
    MaterialPriceRuleInputSchema,
    materialPriceRuleRepo,
    requireAdminOrFail,
    scopeTargetError,
    zodMessage,
    type MaterialPriceRuleInput,
} from './_shared';

type CreateResult = { success: true; id: string } | { success: false; error: string };

/**
 * Crea una regla de ajuste de precio de materiales.
 *
 * Admin-gated. Valida el input con `MaterialPriceRuleInputSchema` (regla SIN los
 * campos que sella el servidor), comprueba coherencia scope↔target, sella
 * `createdBy`/`updatedBy` = uid/email del admin y `createdAt`/`updatedAt` (ISO).
 * `active` por defecto true.
 */
export async function createMaterialPriceRuleAction(
    input: MaterialPriceRuleInput,
): Promise<CreateResult> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };

    const parsed = MaterialPriceRuleInputSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: zodMessage(parsed.error) };

    const scopeErr = scopeTargetError(parsed.data.scope, parsed.data.target);
    if (scopeErr) return { success: false, error: scopeErr };

    try {
        const now = new Date().toISOString();
        const id = await materialPriceRuleRepo.create({
            scope: parsed.data.scope,
            target: parsed.data.target,
            adjustmentPct: parsed.data.adjustmentPct,
            active: parsed.data.active ?? true,
            note: parsed.data.note,
            createdBy: guard.who,
            createdAt: now,
            updatedBy: guard.who,
            updatedAt: now,
        });

        revalidatePath(ADMIN_PRICES_PATH, 'page');
        return { success: true, id };
    } catch (e: any) {
        console.error('[createMaterialPriceRuleAction]', e);
        return { success: false, error: e?.message || 'create_failed' };
    }
}

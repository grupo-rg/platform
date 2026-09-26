/**
 * Utilidades compartidas por las server actions de reglas de ajuste de precio
 * de materiales (colección `material_price_rules`, Wave 1).
 *
 * IMPORTANTE: este módulo NO lleva `'use server'`. Exporta schemas, tipos y una
 * instancia de repositorio (valores no-async), lo que un módulo de server
 * actions no permite exportar. Lo consumen los ficheros `*.action.ts` de este
 * directorio, que sí son `'use server'`.
 */

import { z } from 'zod';
import { verifyAuth } from '@/backend/auth/auth.middleware';
import {
    MaterialPriceRuleSchema,
    type MaterialPriceRule,
} from '@/backend/material-catalog/domain/material-price-rule';
import { FirestoreMaterialPriceRuleRepository } from '@/backend/material-catalog/infrastructure/firestore-material-price-rule-repository';

/** Path (patrón App Router) de la página admin de precios, para `revalidatePath`. */
export const ADMIN_PRICES_PATH = '/[locale]/dashboard/admin/prices';

/** Instancia única del repo de reglas — el constructor no tiene estado costoso. */
export const materialPriceRuleRepo = new FirestoreMaterialPriceRuleRepository();

export type AdminGuardOk = { ok: true; who: string; userId: string; email?: string };
export type AdminGuardFail = { ok: false; error: string };

/**
 * Gate admin común a TODAS las actions de este dominio. Corta el flujo si el
 * usuario no está autenticado como admin. `who` = `email || uid` (misma
 * convención que el resto del dashboard, ver `settings/budget/calibration-actions.ts`)
 * y es lo que se sella en `createdBy`/`updatedBy`.
 */
export async function requireAdminOrFail(): Promise<AdminGuardOk | AdminGuardFail> {
    const auth = await verifyAuth(true);
    if (!auth) return { ok: false, error: 'forbidden' };
    return { ok: true, who: auth.email || auth.userId, userId: auth.userId, email: auth.email };
}

/**
 * Input de creación / preview: la regla SIN los campos que sella el servidor
 * (`id`, `createdBy`/`createdAt`, `updatedBy`/`updatedAt`). `active` es opcional
 * (default true en create).
 */
export const MaterialPriceRuleInputSchema = MaterialPriceRuleSchema.omit({
    id: true,
    active: true,
    createdBy: true,
    createdAt: true,
    updatedBy: true,
    updatedAt: true,
}).extend({
    active: z.boolean().optional(),
});
export type MaterialPriceRuleInput = z.infer<typeof MaterialPriceRuleInputSchema>;

/** Patch de update: cualquier subconjunto del input (todo opcional). */
export const MaterialPriceRulePatchSchema = MaterialPriceRuleInputSchema.partial();
export type MaterialPriceRulePatch = z.infer<typeof MaterialPriceRulePatchSchema>;

/**
 * Comprueba que el `target` trae el campo que exige el `scope`. El schema base
 * deja todos los campos de `target` opcionales, así que sin esto se podría crear
 * p.ej. una regla `category` sin categoría (que no casaría con nada).
 * Devuelve el mensaje de error o `null` si es coherente.
 */
export function scopeTargetError(
    scope: MaterialPriceRule['scope'],
    target: MaterialPriceRule['target'],
): string | null {
    switch (scope) {
        case 'global':
            return null;
        case 'category':
            return target.category ? null : "target.category es obligatorio para scope 'category'";
        case 'material':
            return target.sku ? null : "target.sku es obligatorio para scope 'material'";
        case 'client':
            return target.leadId ? null : "target.leadId es obligatorio para scope 'client'";
        case 'budget':
            return target.budgetId ? null : "target.budgetId es obligatorio para scope 'budget'";
        default:
            return 'scope inválido';
    }
}

/** Aplana los issues de zod en un único string legible. */
export function zodMessage(error: z.ZodError): string {
    return error.issues.map((i) => i.message).join('; ') || 'input inválido';
}

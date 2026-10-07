/**
 * Guards de autorización compartidos por las server actions.
 *
 * IMPORTANTE: este módulo NO lleva `'use server'`. Si lo llevara, cada export
 * se convertiría en un endpoint POST público más. Solo lo importan otras
 * server actions (código de servidor).
 *
 * Contexto: toda server action exportada desde un fichero `'use server'` es
 * invocable por cualquiera que conozca su id (POST a la página con la cabecera
 * `Next-Action`). Por eso la autorización tiene que vivir DENTRO de la acción;
 * que el componente que la llama esté detrás del login del dashboard no
 * protege nada.
 *
 * Dos estilos, según el contrato de retorno de la acción:
 *
 *   - Acciones que devuelven `{ success, error }` (u `{ ok, error }`):
 *       const auth = await checkAdmin();
 *       if (!auth) return unauthorizedResult();
 *     Así el cliente recibe `error: 'No autorizado'` también en producción.
 *
 *   - Acciones que devuelven datos crudos (arrays, entidades, `null`):
 *       await requireAdmin();
 *     Lanza `UnauthorizedError('No autorizado')`. Ojo: en builds de producción
 *     Next.js sustituye el mensaje de los errores lanzados por uno genérico,
 *     así que el cliente solo sabe que "falló"; los llamadores deben tener
 *     try/catch (ver docs/security/server-actions-inventory.md).
 *
 * Admin = claim `admin: true` o `role` `admin` / `super-admin` (ver
 * `verifyAuth` en src/backend/auth/auth.middleware.ts, que no se modifica).
 */
import { verifyAuth } from '@/backend/auth/auth.middleware';

export const UNAUTHORIZED_MESSAGE = 'No autorizado';

export type AuthContext = NonNullable<Awaited<ReturnType<typeof verifyAuth>>>;

export class UnauthorizedError extends Error {
    readonly code = 'UNAUTHORIZED' as const;
    constructor(message: string = UNAUTHORIZED_MESSAGE) {
        super(message);
        this.name = 'UnauthorizedError';
    }
}

/** Devuelve el contexto de auth si la sesión es admin; `null` si no. Nunca lanza. */
export async function checkAdmin(): Promise<AuthContext | null> {
    try {
        return await verifyAuth(true);
    } catch {
        return null;
    }
}

/** Devuelve el contexto de auth si hay sesión válida (cualquier rol); `null` si no. Nunca lanza. */
export async function checkUser(): Promise<AuthContext | null> {
    try {
        return await verifyAuth(false);
    } catch {
        return null;
    }
}

/** Exige sesión admin. Lanza `UnauthorizedError` ('No autorizado') si no la hay. */
export async function requireAdmin(): Promise<AuthContext> {
    const auth = await checkAdmin();
    if (!auth) throw new UnauthorizedError();
    return auth;
}

/** Exige sesión (cualquier rol). Lanza `UnauthorizedError` ('No autorizado') si no la hay. */
export async function requireUser(): Promise<AuthContext> {
    const auth = await checkUser();
    if (!auth) throw new UnauthorizedError();
    return auth;
}

/** Resultado uniforme para acciones con contrato `{ success, error }`. */
export function unauthorizedResult(): { success: false; error: typeof UNAUTHORIZED_MESSAGE } {
    return { success: false, error: UNAUTHORIZED_MESSAGE };
}

/** Variante para acciones con contrato `{ ok, error }`. */
export function unauthorizedOkResult(): { ok: false; error: typeof UNAUTHORIZED_MESSAGE } {
    return { ok: false, error: UNAUTHORIZED_MESSAGE };
}

/** True si `value` es un error/resultado de "No autorizado" (útil en tests y en catch de servidor). */
export function isUnauthorized(value: unknown): boolean {
    if (value instanceof UnauthorizedError) return true;
    if (value && typeof value === 'object') {
        const v = value as { error?: unknown; message?: unknown };
        return v.error === UNAUTHORIZED_MESSAGE || v.message === UNAUTHORIZED_MESSAGE;
    }
    return false;
}

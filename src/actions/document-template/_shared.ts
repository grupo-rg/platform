/**
 * Utilidades compartidas por las server actions de plantillas de documento y
 * listas de precios. SIN `'use server'` (exporta valores no-async).
 */
import { z } from 'zod';
import { verifyAuth } from '@/backend/auth/auth.middleware';

export type AdminGuardOk = { ok: true; who: string; userId: string };
export type AdminGuardFail = { ok: false; error: string };

/** Gate admin (misma convención que `material-catalog/_shared.ts`: who = email || uid). */
export async function requireAdminOrFail(): Promise<AdminGuardOk | AdminGuardFail> {
    const auth = await verifyAuth(true);
    if (!auth) return { ok: false, error: 'No autorizado' };
    return { ok: true, who: auth.email || auth.userId, userId: auth.userId };
}

export function zodMessage(error: z.ZodError): string {
    return error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') || 'Datos inválidos';
}

export type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export function errorMessage(e: unknown, fallback: string): string {
    if (e instanceof z.ZodError) return zodMessage(e);
    if (e instanceof Error && e.message) return e.message;
    return fallback;
}

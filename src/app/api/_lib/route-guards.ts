/**
 * Guards compartidos para Route Handlers (`src/app/api/**`).
 *
 * La carpeta `_lib` empieza por guion bajo → Next.js la trata como privada
 * (no genera rutas). Solo código de servidor.
 *
 *   - `requireAdminRoute()`  → sesión admin vía cookie `session` (verifyAuth(true)).
 *   - `requireSecretHeader()` / `requireBearerSecret()` → secretos de cron /
 *     workers internos, comparados en tiempo constante y FALLANDO CERRADO si
 *     la variable de entorno no está definida.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyAuth } from '@/backend/auth/auth.middleware';

export const UNAUTHORIZED_MESSAGE = 'No autorizado';

function unauthorized(status: 401 | 403 = 401): NextResponse {
    return NextResponse.json({ success: false, error: UNAUTHORIZED_MESSAGE }, { status });
}

/**
 * Exige sesión admin. Devuelve `null` si está autorizado, o la respuesta de
 * error (401 sin sesión / 403 con sesión no-admin) que el handler debe
 * devolver tal cual.
 */
export async function requireAdminRoute(): Promise<NextResponse | null> {
    try {
        const admin = await verifyAuth(true);
        if (admin) return null;
        const user = await verifyAuth(false);
        return unauthorized(user ? 403 : 401);
    } catch {
        return unauthorized(401);
    }
}

/**
 * Comparación en tiempo constante. Hashea ambos lados para que la longitud
 * del secreto tampoco se filtre por timing.
 */
export function safeEqual(provided: string, expected: string): boolean {
    const a = createHash('sha256').update(provided, 'utf8').digest();
    const b = createHash('sha256').update(expected, 'utf8').digest();
    return timingSafeEqual(a, b);
}

/**
 * Valida una cabecera contra un secreto de entorno. Falla cerrado: si la
 * variable no existe o está vacía, deniega (y lo registra).
 */
export function requireSecretHeader(
    req: NextRequest | Request,
    headerName: string,
    envVar: string,
    opts: { bearer?: boolean } = {},
): NextResponse | null {
    const expected = process.env[envVar];
    if (!expected) {
        console.error(`[route-guards] ${envVar} no configurado: endpoint deshabilitado (fail-closed).`);
        return unauthorized(401);
    }
    let provided = req.headers.get(headerName) || '';
    if (opts.bearer) {
        if (!provided.startsWith('Bearer ')) return unauthorized(401);
        provided = provided.slice('Bearer '.length);
    }
    if (!provided || !safeEqual(provided, expected)) return unauthorized(401);
    return null;
}

/** `Authorization: Bearer <secret>` (patrón estándar de Vercel Cron). */
export function requireBearerSecret(req: NextRequest | Request, envVar: string): NextResponse | null {
    return requireSecretHeader(req, 'authorization', envVar, { bearer: true });
}

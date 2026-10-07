import { adminAuth } from '@/backend/shared/infrastructure/firebase/admin-app';
import { cookies } from 'next/headers';
import {
    isAdminRole,
    resolvePlatformRole,
    toLegacyRole,
    type PlatformRole,
} from './roles';

export type { PlatformRole } from './roles';

export type AuthResult = {
    userId: string;
    email?: string;
    /**
     * Rol binario legacy. 'admin' = admin o super-admin. Lo siguen usando
     * todos los llamadores de `verifyAuth(true)`; NO cambiar su semántica.
     */
    role: 'admin' | 'user';
    /** Rol de plataforma completo (super-admin / admin / encargado / user). */
    platformRole: PlatformRole;
    claims: any;
};

export const SESSION_COOKIE_NAME = 'session';

/**
 * Verifica la cookie de sesión (firma + revocación) y devuelve la identidad.
 *
 * - `verifyAuth()`      → cualquier usuario autenticado (incluido 'user' sin permisos).
 * - `verifyAuth(true)`  → solo admin o super-admin; null en cualquier otro caso.
 */
export async function verifyAuth(requireAdmin = false): Promise<AuthResult | null> {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!sessionCookie) return null;

    try {
        // Verify the session cookie (checkRevoked = true)
        const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie, true);

        // Acepta el claim legacy `{ admin: true }` y el claim `role` que
        // escriben scripts/set-admin.js y /dashboard/settings/users.
        const platformRole = resolvePlatformRole(decodedClaims as Record<string, unknown>);
        const role = toLegacyRole(platformRole);

        if (requireAdmin && role !== 'admin') {
            return null;
        }

        return {
            userId: decodedClaims.uid,
            email: decodedClaims.email,
            role,
            platformRole,
            claims: decodedClaims
        };
    } catch {
        // Session cookie is invalid, expired or revoked
        return null;
    }
}

// ---------------------------------------------------------------------------
// Helpers para server actions
// ---------------------------------------------------------------------------

export type AuthErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN';

export class AuthorizationError extends Error {
    readonly code: AuthErrorCode;
    constructor(code: AuthErrorCode, message?: string) {
        super(message ?? (code === 'UNAUTHENTICATED' ? 'No autenticado' : 'Sin permisos'));
        this.name = 'AuthorizationError';
        this.code = code;
    }
}

export function isAuthorizationError(err: unknown): err is AuthorizationError {
    return err instanceof AuthorizationError
        || (typeof err === 'object' && err !== null && (err as any).name === 'AuthorizationError');
}

/**
 * Exige que el usuario tenga uno de `roles`. Lanza `AuthorizationError`
 * ('UNAUTHENTICATED' sin sesión, 'FORBIDDEN' con rol insuficiente).
 *
 * Uso típico en una server action:
 *   const auth = await requireRole(['super-admin', 'admin', 'encargado']);
 */
export async function requireRole(roles: readonly PlatformRole[]): Promise<AuthResult> {
    const auth = await verifyAuth(false);
    if (!auth) throw new AuthorizationError('UNAUTHENTICATED');
    if (!roles.includes(auth.platformRole)) throw new AuthorizationError('FORBIDDEN');
    return auth;
}

/** Atajo: admin o super-admin. */
export async function requireAdmin(): Promise<AuthResult> {
    const auth = await requireRole(['super-admin', 'admin']);
    if (!isAdminRole(auth.platformRole)) throw new AuthorizationError('FORBIDDEN');
    return auth;
}

/** Atajo: solo super-admin. */
export async function requireSuperAdmin(): Promise<AuthResult> {
    return requireRole(['super-admin']);
}

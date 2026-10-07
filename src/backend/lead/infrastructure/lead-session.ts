import 'server-only';
import { cookies } from 'next/headers';
import {
    LEAD_SESSION_COOKIE,
    LEAD_SESSION_TTL_SECONDS,
    LeadSession,
    signLeadSessionToken,
    verifyLeadSessionToken,
} from './lead-session-token';

export type { LeadSession } from './lead-session-token';

/**
 * Lee la sesión de lead de la cookie httpOnly firmada. Devuelve null si no
 * hay cookie, la firma no cuadra o ha expirado. Nunca lanza.
 */
export async function getLeadSession(): Promise<LeadSession | null> {
    try {
        const store = await cookies();
        return verifyLeadSessionToken(store.get(LEAD_SESSION_COOKIE)?.value);
    } catch (err) {
        console.error('[lead-session] No se pudo leer la sesión de lead:', err);
        return null;
    }
}

/**
 * Emite (o renueva) la cookie de sesión de lead. Sólo puede llamarse desde
 * Server Actions / Route Handlers (Next lo impone).
 */
export async function setLeadSession(leadId: string, verified: boolean): Promise<void> {
    const store = await cookies();
    store.set(LEAD_SESSION_COOKIE, signLeadSessionToken({ leadId, verified }), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: LEAD_SESSION_TTL_SECONDS,
    });
}

export async function clearLeadSession(): Promise<void> {
    try {
        const store = await cookies();
        store.delete(LEAD_SESSION_COOKIE);
    } catch {
        // best-effort
    }
}

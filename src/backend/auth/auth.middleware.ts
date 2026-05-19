
import { adminAuth } from '@/backend/shared/infrastructure/firebase/admin-app';
import { cookies } from 'next/headers';

type AuthResult = {
    userId: string;
    email?: string;
    role: 'admin' | 'user';
    claims: any;
};

export async function verifyAuth(requireAdmin = false): Promise<AuthResult | null> {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('session')?.value;

    // TEMP DEBUG — show whether the session cookie exists at all.
    if (requireAdmin) {
        const allCookieNames = cookieStore.getAll().map(c => c.name);
        console.log('[verifyAuth][DEBUG] requireAdmin=true', {
            hasSessionCookie: !!sessionCookie,
            sessionCookieLength: sessionCookie?.length ?? 0,
            allCookieNames,
        });
    }

    if (!sessionCookie) return null;

    try {
        // Verify the session cookie
        const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie, true);

        if (requireAdmin) {
            console.log('[verifyAuth][DEBUG] decodedClaims for', decodedClaims.email, ':', {
                uid: decodedClaims.uid,
                admin: decodedClaims.admin,
                role: decodedClaims.role,
                allKeys: Object.keys(decodedClaims),
                authTime: decodedClaims.auth_time
                    ? new Date(decodedClaims.auth_time * 1000).toISOString()
                    : null,
            });
        }

        // Accept either the legacy `{ admin: true }` claim or the actual
        // claim that scripts/set-admin.js writes: `{ role: 'super-admin' }`.
        const isAdmin = decodedClaims.admin === true
            || decodedClaims.role === 'super-admin'
            || decodedClaims.role === 'admin';
        const role: 'admin' | 'user' = isAdmin ? 'admin' : 'user';

        if (requireAdmin && role !== 'admin') {
            console.log('[verifyAuth][DEBUG] user NOT admin, returning null. role=', role);
            return null;
        }

        return {
            userId: decodedClaims.uid,
            email: decodedClaims.email,
            role,
            claims: decodedClaims
        };
    } catch (error: any) {
        // Session cookie is invalid or expired
        if (requireAdmin) {
            console.log('[verifyAuth][DEBUG] verifySessionCookie threw:', error?.code, error?.message);
        }
        return null;
    }
}

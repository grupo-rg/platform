
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

    if (!sessionCookie) return null;

    try {
        // Verify the session cookie
        const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie, true);

        // TEMP DEBUG — remove once admin detection is confirmed working.
        // Logs only when requireAdmin is true to keep regular paths quiet.
        if (requireAdmin) {
            console.log('[verifyAuth][DEBUG] session claims for', decodedClaims.email, ':', {
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
        // Both mean "admin"; without this OR the admin pages reject every
        // user even though set-admin.js was run.
        const isAdmin = decodedClaims.admin === true
            || decodedClaims.role === 'super-admin'
            || decodedClaims.role === 'admin';
        const role: 'admin' | 'user' = isAdmin ? 'admin' : 'user';

        if (requireAdmin && role !== 'admin') {
            return null; // or throw forbidden
        }

        return {
            userId: decodedClaims.uid,
            email: decodedClaims.email,
            role,
            claims: decodedClaims
        };
    } catch (error) {
        // Session cookie is invalid or expired
        return null;
    }
}

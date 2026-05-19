
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

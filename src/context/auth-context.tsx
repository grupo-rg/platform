'use client';

import React, { createContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { User, onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { getSafeAuth } from '@/lib/firebase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { resolvePlatformRole, toLegacyRole, type PlatformRole } from '@/backend/auth/roles';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  /** Rol binario legacy: 'admin' = admin o super-admin. */
  role: 'admin' | 'user';
  /** Rol de plataforma leído de los custom claims del ID token. */
  platformRole: PlatformRole;
  signOut: () => void;
  /**
   * Re-emite el ID token (claims frescos) y re-crea la cookie de sesión.
   * Úsalo tras un cambio de rol o al aceptar una invitación.
   */
  refreshSession: () => Promise<boolean>;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  role: 'user',
  platformRole: 'user',
  signOut: () => {},
  refreshSession: async () => false,
});

/**
 * Crea la cookie de sesión `session` a partir del usuario actual. Exportada
 * para que login/signup puedan esperarla antes de navegar al panel (el
 * middleware exige la cookie en /dashboard).
 */
export async function createServerSession(user: User): Promise<{ ok: boolean; platformRole: PlatformRole }> {
  // Force refresh so the ID Token carries the latest custom claims.
  const idToken = await user.getIdToken(true);
  const tokenResult = await user.getIdTokenResult();
  const platformRole = resolvePlatformRole(tokenResult.claims as Record<string, unknown>);
  const res = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  return { ok: res.ok, platformRole };
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [platformRole, setPlatformRole] = useState<PlatformRole>('user');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // getSafeAuth will only run on the client, preventing build errors
    const auth = getSafeAuth();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      // Rol inicial desde el token cacheado (sin red) para no retrasar el
      // primer render; el refresh forzado de abajo lo actualiza.
      if (user) {
        try {
          const cached = await user.getIdTokenResult();
          setPlatformRole(resolvePlatformRole(cached.claims as Record<string, unknown>));
        } catch {
          setPlatformRole('user');
        }
      } else {
        setPlatformRole('user');
      }
      setUser(user);
      setLoading(false);

      // Sync the server-side session cookie with the client auth state.
      // Without this, verifyAuth() in server actions/components always
      // returns null because cookies().get('session') is undefined.
      try {
        if (user) {
          const { platformRole } = await createServerSession(user);
          setPlatformRole(platformRole);
        } else {
          await fetch('/api/auth/session', { method: 'DELETE' });
        }
      } catch (err) {
        // Token revocado (cambio de rol / cuenta desactivada) → el refresh
        // falla. Cerramos sesión en cliente para no quedar en un estado zombi.
        console.error('[AuthContext] session cookie sync failed:', err);
        const code = (err as any)?.code as string | undefined;
        if (user && (code === 'auth/user-token-expired' || code === 'auth/user-disabled' || code === 'auth/invalid-user-token')) {
          await firebaseSignOut(auth).catch(() => {});
          await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => {});
        }
      }
    });

    return () => unsubscribe();
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const auth = getSafeAuth();
      const current = auth.currentUser;
      if (!current) return false;
      const { ok, platformRole } = await createServerSession(current);
      setPlatformRole(platformRole);
      return ok;
    } catch (err) {
      console.error('[AuthContext] refreshSession failed:', err);
      return false;
    }
  }, []);

  const signOut = async () => {
    try {
      const auth = getSafeAuth();
      await firebaseSignOut(auth);
      setPlatformRole('user');
      // Clearing here too in case onAuthStateChanged is slow — defensive.
      await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => {});
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  if (loading) {
    return (
        <div className="w-full h-screen flex flex-col items-center justify-center space-y-4">
            <Skeleton className="h-16 w-full" />
            <div className="container flex-1 p-8">
                <Skeleton className="h-32 w-full" />
                <div className="grid grid-cols-3 gap-4 mt-8">
                    <Skeleton className="h-64" />
                    <Skeleton className="h-64" />
                    <Skeleton className="h-64" />
                </div>
            </div>
        </div>
    )
  }

  return (
    <AuthContext.Provider value={{ user, loading, role: toLegacyRole(platformRole), platformRole, signOut, refreshSession }}>
      {children}
    </AuthContext.Provider>
  );
};

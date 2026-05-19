'use client';

import React, { createContext, useState, useEffect, ReactNode } from 'react';
import { User, onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { getSafeAuth } from '@/lib/firebase/client';
import { Skeleton } from '@/components/ui/skeleton';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signOut: () => void;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signOut: () => {},
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // getSafeAuth will only run on the client, preventing build errors
    const auth = getSafeAuth();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      setLoading(false);

      // Sync the server-side session cookie with the client auth state.
      // Without this, verifyAuth() in server actions/components always
      // returns null because cookies().get('session') is undefined.
      try {
        if (user) {
          // Force refresh so the ID Token carries the latest custom claims
          // (e.g. role: 'super-admin' set by scripts/set-admin.js after a
          // previous login session was minted).
          const idToken = await user.getIdToken(true);
          await fetch('/api/auth/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken }),
          });
        } else {
          await fetch('/api/auth/session', { method: 'DELETE' });
        }
      } catch (err) {
        console.error('[AuthContext] session cookie sync failed:', err);
      }
    });

    return () => unsubscribe();
  }, []);

  const signOut = async () => {
    try {
      const auth = getSafeAuth();
      await firebaseSignOut(auth);
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
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

'use client';

import { useState } from 'react';
import { ShieldOff, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { useRouter } from '@/i18n/navigation';

/**
 * Pantalla para usuarios autenticados sin rol con acceso al panel
 * (platformRole 'user'). El acceso se concede por invitación.
 */
export function NoAccess({ email }: { email?: string | null }) {
    const { signOut } = useAuth();
    const router = useRouter();
    const [busy, setBusy] = useState(false);

    const handleSignOut = async () => {
        setBusy(true);
        try {
            await signOut();
            router.push('/login');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
            <Card className="max-w-md w-full">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                        <ShieldOff className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <CardTitle className="text-xl">Sin acceso al panel</CardTitle>
                    <CardDescription>
                        {email ? <>La cuenta <strong>{email}</strong> no tiene permisos para entrar al panel.</> : 'Tu cuenta no tiene permisos para entrar al panel.'}
                        {' '}El acceso es solo por invitación: pide a un administrador que te invite.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center">
                    <Button variant="outline" onClick={handleSignOut} disabled={busy}>
                        <LogOut className="mr-2 h-4 w-4" />
                        {busy ? 'Cerrando sesión…' : 'Cerrar sesión'}
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}

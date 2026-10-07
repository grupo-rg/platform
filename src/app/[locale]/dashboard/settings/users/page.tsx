import { redirect } from 'next/navigation';
import { verifyAuth } from '@/backend/auth/auth.middleware';
import { canManageUsers } from '@/backend/auth/roles';
import { listUsersAction } from '@/actions/users/user-management.action';
import { UsersClient } from './users-client';

export const dynamic = 'force-dynamic';

export default async function UsersSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    // Guard propio de la página (los layouts no protegen páginas en App Router).
    const auth = await verifyAuth();
    if (!auth) redirect(`/${locale}/login`);
    if (!canManageUsers(auth.platformRole)) redirect(`/${locale}/dashboard`);

    const res = await listUsersAction();

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium">Usuarios</h3>
                <p className="text-sm text-muted-foreground">
                    El acceso al panel es solo por invitación. Invita a nuevas personas, cambia su rol o desactiva su cuenta.
                    Cambiar el rol o desactivar cierra todas las sesiones de ese usuario.
                </p>
            </div>
            {res.success ? (
                <UsersClient
                    locale={locale}
                    me={res.data.me}
                    initialUsers={res.data.users}
                    initialInvitations={res.data.invitations}
                />
            ) : (
                <p className="text-sm text-destructive">No se pudieron cargar los usuarios: {res.error}</p>
            )}
        </div>
    );
}

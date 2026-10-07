'use server';

import { headers } from 'next/headers';
import {
    isAuthorizationError,
    requireRole,
    type AuthResult,
} from '@/backend/auth/auth.middleware';
import { isPlatformRole, PLATFORM_ROLE_LABELS, type PlatformRole } from '@/backend/auth/roles';
import {
    UserManagementError,
    UserManagementService,
    type ManagedUser,
    type PendingInvitation,
} from '@/backend/auth/user-management.service';
import { ResendEmailService } from '@/backend/shared/infrastructure/messaging/resend-email.service';

/**
 * Server actions de /dashboard/settings/users. Todas exigen admin o
 * super-admin; la regla "solo super-admin gestiona super-admins" se aplica
 * en UserManagementService.
 */

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

const MANAGER_ROLES: readonly PlatformRole[] = ['super-admin', 'admin'];

async function guard(): Promise<AuthResult> {
    return requireRole(MANAGER_ROLES);
}

function fail(err: unknown): { success: false; error: string } {
    if (isAuthorizationError(err)) {
        return { success: false, error: err.code === 'UNAUTHENTICATED' ? 'Sesión no válida.' : 'No tienes permisos.' };
    }
    if (err instanceof UserManagementError) return { success: false, error: err.message };
    console.error('[users.action] error:', err);
    return { success: false, error: 'Error inesperado. Inténtalo de nuevo.' };
}

async function resolveBaseUrl(): Promise<string> {
    try {
        const h = await headers();
        const host = h.get('x-forwarded-host') || h.get('host');
        if (host) {
            const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
            return `${proto}://${host}`;
        }
    } catch { /* fuera de request */ }
    return process.env.NEXT_PUBLIC_SITE_URL || 'https://constructoresenmallorca.com';
}

export async function listUsersAction(): Promise<ActionResult<{
    users: ManagedUser[];
    invitations: PendingInvitation[];
    me: { uid: string; platformRole: PlatformRole };
}>> {
    try {
        const auth = await guard();
        const [users, invitations] = await Promise.all([
            UserManagementService.listUsers(),
            UserManagementService.listPendingInvitations(),
        ]);
        return { success: true, data: { users, invitations, me: { uid: auth.userId, platformRole: auth.platformRole } } };
    } catch (err) {
        return fail(err);
    }
}

export async function inviteUserAction(input: { email: string; role: string; locale?: string; sendEmail?: boolean }): Promise<ActionResult<{
    link: string;
    expiresAt: number;
    emailSent: boolean;
    emailError: string | null;
}>> {
    try {
        const auth = await guard();
        if (!isPlatformRole(input.role)) return { success: false, error: 'Rol no válido.' };
        const { token, expiresAt } = await UserManagementService.createInvitation({
            actorUid: auth.userId,
            actorRole: auth.platformRole,
            email: input.email,
            role: input.role,
        });
        const locale = ['es', 'en', 'ca', 'de', 'nl'].includes(input.locale ?? '') ? input.locale : 'es';
        const link = `${await resolveBaseUrl()}/${locale}/signup?invite=${encodeURIComponent(token)}`;

        let emailSent = false;
        let emailError: string | null = null;
        if (input.sendEmail !== false) {
            const roleLabel = PLATFORM_ROLE_LABELS[input.role];
            const expires = new Date(expiresAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
            const res = await ResendEmailService.send({
                to: input.email.trim(),
                subject: 'Invitación al panel de Grupo RG',
                html: `<p>Hola,</p>
<p>Te han invitado a acceder al panel de <strong>Grupo RG</strong> con el rol <strong>${roleLabel}</strong>.</p>
<p><a href="${link}">Aceptar invitación y crear mi acceso</a></p>
<p>El enlace es personal y caduca el ${expires}.</p>
<p>Si no esperabas este correo, puedes ignorarlo.</p>`,
                text: `Te han invitado al panel de Grupo RG (${roleLabel}). Acepta aquí: ${link} — caduca el ${expires}.`,
                tags: [{ name: 'category', value: 'user_invitation' }],
            });
            emailSent = !!res.id;
            emailError = res.error;
        }
        return { success: true, data: { link, expiresAt, emailSent, emailError } };
    } catch (err) {
        return fail(err);
    }
}

export async function revokeInvitationAction(id: string): Promise<ActionResult<null>> {
    try {
        const auth = await guard();
        await UserManagementService.revokeInvitation({ actorRole: auth.platformRole, id });
        return { success: true, data: null };
    } catch (err) {
        return fail(err);
    }
}

export async function changeUserRoleAction(uid: string, role: string): Promise<ActionResult<ManagedUser>> {
    try {
        const auth = await guard();
        if (!isPlatformRole(role)) return { success: false, error: 'Rol no válido.' };
        const user = await UserManagementService.changeRole({
            actorUid: auth.userId,
            actorRole: auth.platformRole,
            targetUid: uid,
            role,
        });
        return { success: true, data: user };
    } catch (err) {
        return fail(err);
    }
}

export async function setUserDisabledAction(uid: string, disabled: boolean): Promise<ActionResult<ManagedUser>> {
    try {
        const auth = await guard();
        const user = await UserManagementService.setDisabled({
            actorUid: auth.userId,
            actorRole: auth.platformRole,
            targetUid: uid,
            disabled: !!disabled,
        });
        return { success: true, data: user };
    } catch (err) {
        return fail(err);
    }
}

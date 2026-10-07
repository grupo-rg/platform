'use server';

import { adminAuth } from '@/backend/shared/infrastructure/firebase/admin-app';
import {
    INVITATION_REASON_MESSAGES,
    normalizeEmail,
    type InvitationInvalidReason,
} from '@/backend/auth/invitation-token';
import { PLATFORM_ROLE_LABELS, type PlatformRole } from '@/backend/auth/roles';
import { UserManagementError, UserManagementService } from '@/backend/auth/user-management.service';

/**
 * Acciones PÚBLICAS de la página /signup. No requieren sesión: la
 * autorización es la posesión del token de invitación (single-use, 7 días,
 * guardado como hash).
 */

export type InvitationPreview =
    | { valid: true; email: string; role: PlatformRole; roleLabel: string; accountExists: boolean; expiresAt: number }
    | { valid: false; reason: InvitationInvalidReason; message: string };

function reasonMessage(code: string): string {
    return (INVITATION_REASON_MESSAGES as Record<string, string>)[code] ?? code;
}

export async function getInvitationPreviewAction(token: string): Promise<InvitationPreview> {
    try {
        const found = await UserManagementService.findInvitationByToken(token);
        if (!found.ok) return { valid: false, reason: found.reason, message: reasonMessage(found.reason) };
        const accountExists = await UserManagementService.emailHasAccount(found.invitation.email);
        return {
            valid: true,
            email: found.invitation.email,
            role: found.invitation.role,
            roleLabel: PLATFORM_ROLE_LABELS[found.invitation.role],
            accountExists,
            expiresAt: found.invitation.expiresAt,
        };
    } catch (err) {
        console.error('[invitation-accept] preview failed:', err);
        return { valid: false, reason: 'not_found', message: 'No se pudo comprobar la invitación.' };
    }
}

type AcceptResult = { success: true; role: PlatformRole } | { success: false; error: string };

function fail(err: unknown): { success: false; error: string } {
    if (err instanceof UserManagementError) return { success: false, error: reasonMessage(err.code) === err.code ? err.message : reasonMessage(err.code) };
    const code = (err as any)?.code;
    if (code === 'auth/email-already-exists') return { success: false, error: 'Ya existe una cuenta con ese email: inicia sesión desde esta misma página.' };
    if (code === 'auth/invalid-password') return { success: false, error: 'La contraseña no cumple los requisitos.' };
    console.error('[invitation-accept] failed:', err);
    return { success: false, error: 'No se pudo aceptar la invitación.' };
}

/** Alta de cuenta nueva con invitación (la cuenta se crea con admin SDK). */
export async function acceptInvitationWithSignupAction(input: { token: string; email: string; password: string }): Promise<AcceptResult> {
    try {
        const { role } = await UserManagementService.acceptInvitation({
            token: input.token,
            email: input.email,
            newPassword: input.password,
        });
        return { success: true, role };
    } catch (err) {
        return fail(err);
    }
}

/**
 * Usuario que ya tenía cuenta: demuestra la identidad con un idToken recién
 * emitido (signInWithEmailAndPassword en el cliente) del MISMO email.
 */
export async function acceptInvitationForExistingUserAction(input: { token: string; idToken: string }): Promise<AcceptResult> {
    try {
        const decoded = await adminAuth.verifyIdToken(input.idToken, true);
        if (!decoded.email) return { success: false, error: 'La cuenta no tiene email.' };
        const { role } = await UserManagementService.acceptInvitation({
            token: input.token,
            email: normalizeEmail(decoded.email),
            existingUid: decoded.uid,
        });
        return { success: true, role };
    } catch (err) {
        return fail(err);
    }
}

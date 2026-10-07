import 'server-only';
import { adminAuth, adminFirestore } from '@/backend/shared/infrastructure/firebase/admin-app';
import type { UserRecord } from 'firebase-admin/auth';
import {
    canAssignRole,
    resolvePlatformRole,
    type PlatformRole,
} from './roles';
import {
    INVITATIONS_COLLECTION,
    computeInvitationExpiry,
    generateInvitationToken,
    hashInvitationToken,
    isWellFormedInvitationToken,
    normalizeEmail,
    validateInvitation,
    type InvitationInvalidReason,
    type InvitationRecord,
} from './invitation-token';

/**
 * Casos de uso de gestión de usuarios e invitaciones (admin SDK).
 * NO hace comprobaciones de sesión: las server actions que lo llaman deben
 * pasar el rol del actor ya verificado con `requireRole`.
 */

export interface ManagedUser {
    uid: string;
    email: string | null;
    displayName: string | null;
    platformRole: PlatformRole;
    disabled: boolean;
    createdAt: string | null;
    lastSignInAt: string | null;
    lastActiveAt: string | null;
}

export interface PendingInvitation {
    id: string;
    email: string;
    role: PlatformRole;
    expiresAt: number;
    createdBy: string;
    createdAt: number | null;
}

export class UserManagementError extends Error {
    constructor(public readonly code: string, message: string) {
        super(message);
        this.name = 'UserManagementError';
    }
}

function toManagedUser(u: UserRecord): ManagedUser {
    return {
        uid: u.uid,
        email: u.email ?? null,
        displayName: u.displayName ?? null,
        platformRole: resolvePlatformRole((u.customClaims ?? {}) as Record<string, unknown>),
        disabled: u.disabled,
        createdAt: u.metadata.creationTime ? new Date(u.metadata.creationTime).toISOString() : null,
        lastSignInAt: u.metadata.lastSignInTime ? new Date(u.metadata.lastSignInTime).toISOString() : null,
        lastActiveAt: u.metadata.lastRefreshTime ? new Date(u.metadata.lastRefreshTime).toISOString() : null,
    };
}

/**
 * Escribe el claim de rol conservando el resto de claims y eliminando el
 * legacy `admin: true` (si no, un usuario degradado seguiría siendo admin).
 */
async function writeRoleClaim(uid: string, role: PlatformRole, existing?: Record<string, unknown>): Promise<void> {
    const current = existing ?? ((await adminAuth.getUser(uid)).customClaims ?? {});
    const next: Record<string, unknown> = { ...current, role };
    delete next.admin;
    await adminAuth.setCustomUserClaims(uid, next);
}

export const UserManagementService = {
    async listUsers(): Promise<ManagedUser[]> {
        const users: ManagedUser[] = [];
        let pageToken: string | undefined;
        do {
            const page = await adminAuth.listUsers(1000, pageToken);
            users.push(...page.users.map(toManagedUser));
            pageToken = page.pageToken;
        } while (pageToken && users.length < 5000);
        return users.sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''));
    },

    async changeRole(params: { actorUid: string; actorRole: PlatformRole; targetUid: string; role: PlatformRole }): Promise<ManagedUser> {
        const { actorUid, actorRole, targetUid, role } = params;
        if (actorUid === targetUid) {
            throw new UserManagementError('SELF', 'No puedes cambiar tu propio rol.');
        }
        const target = await adminAuth.getUser(targetUid);
        const claims = (target.customClaims ?? {}) as Record<string, unknown>;
        const currentRole = resolvePlatformRole(claims);
        if (!canAssignRole(actorRole, role, currentRole)) {
            throw new UserManagementError('FORBIDDEN', 'Solo un super-admin puede crear o retirar super-admins.');
        }
        await writeRoleClaim(targetUid, role, claims);
        // Fuerza a re-autenticarse: la cookie de sesión lleva los claims
        // congelados y verifySessionCookie(checkRevoked) la rechazará.
        await adminAuth.revokeRefreshTokens(targetUid);
        return toManagedUser(await adminAuth.getUser(targetUid));
    },

    async setDisabled(params: { actorUid: string; actorRole: PlatformRole; targetUid: string; disabled: boolean }): Promise<ManagedUser> {
        const { actorUid, actorRole, targetUid, disabled } = params;
        if (actorUid === targetUid) {
            throw new UserManagementError('SELF', 'No puedes desactivar tu propia cuenta.');
        }
        const target = await adminAuth.getUser(targetUid);
        const currentRole = resolvePlatformRole((target.customClaims ?? {}) as Record<string, unknown>);
        if (currentRole === 'super-admin' && actorRole !== 'super-admin') {
            throw new UserManagementError('FORBIDDEN', 'Solo un super-admin puede desactivar a otro super-admin.');
        }
        await adminAuth.updateUser(targetUid, { disabled });
        if (disabled) await adminAuth.revokeRefreshTokens(targetUid);
        return toManagedUser(await adminAuth.getUser(targetUid));
    },

    // -------------------------------------------------------------------
    // Invitaciones
    // -------------------------------------------------------------------

    async createInvitation(params: { actorUid: string; actorRole: PlatformRole; email: string; role: PlatformRole; now?: number }): Promise<{ id: string; token: string; expiresAt: number }> {
        const email = normalizeEmail(params.email);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new UserManagementError('INVALID_EMAIL', 'Email no válido.');
        }
        if (params.role === 'user') {
            throw new UserManagementError('INVALID_ROLE', 'Elige un rol con acceso al panel.');
        }
        // Si el usuario ya existe, el rol actual cuenta para la regla de super-admins.
        let currentRole: PlatformRole = 'user';
        try {
            const existing = await adminAuth.getUserByEmail(email);
            currentRole = resolvePlatformRole((existing.customClaims ?? {}) as Record<string, unknown>);
        } catch (err: any) {
            if (err?.code !== 'auth/user-not-found') throw err;
        }
        if (!canAssignRole(params.actorRole, params.role, currentRole)) {
            throw new UserManagementError('FORBIDDEN', 'Solo un super-admin puede invitar super-admins.');
        }

        const now = params.now ?? Date.now();
        const token = generateInvitationToken();
        const record: InvitationRecord = {
            email,
            role: params.role,
            tokenHash: hashInvitationToken(token),
            expiresAt: computeInvitationExpiry(now),
            createdBy: params.actorUid,
            createdAt: now,
            usedAt: null,
            usedBy: null,
            revokedAt: null,
        };
        const ref = await adminFirestore.collection(INVITATIONS_COLLECTION).add(record);
        return { id: ref.id, token, expiresAt: record.expiresAt };
    },

    async listPendingInvitations(now = Date.now()): Promise<PendingInvitation[]> {
        const snap = await adminFirestore.collection(INVITATIONS_COLLECTION).where('usedAt', '==', null).get();
        return snap.docs
            .map(d => ({ id: d.id, data: d.data() as InvitationRecord }))
            .filter(({ data }) => !data.revokedAt && data.expiresAt > now)
            .map(({ id, data }) => ({
                id,
                email: data.email,
                role: data.role,
                expiresAt: data.expiresAt,
                createdBy: data.createdBy,
                createdAt: data.createdAt ?? null,
            }))
            .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    },

    async revokeInvitation(params: { actorRole: PlatformRole; id: string }): Promise<void> {
        const ref = adminFirestore.collection(INVITATIONS_COLLECTION).doc(params.id);
        const snap = await ref.get();
        if (!snap.exists) return;
        const data = snap.data() as InvitationRecord;
        if (data.role === 'super-admin' && params.actorRole !== 'super-admin') {
            throw new UserManagementError('FORBIDDEN', 'Solo un super-admin puede anular invitaciones de super-admin.');
        }
        await ref.update({ revokedAt: Date.now() });
    },

    /** Busca la invitación por hash del token y la valida. */
    async findInvitationByToken(token: unknown, now = Date.now()): Promise<
        | { ok: true; id: string; invitation: InvitationRecord }
        | { ok: false; reason: InvitationInvalidReason }
    > {
        if (!isWellFormedInvitationToken(token)) return { ok: false, reason: 'malformed' };
        const snap = await adminFirestore
            .collection(INVITATIONS_COLLECTION)
            .where('tokenHash', '==', hashInvitationToken(token))
            .limit(1)
            .get();
        const doc = snap.docs[0];
        const invitation = doc ? (doc.data() as InvitationRecord) : null;
        const v = validateInvitation({ token, invitation, now });
        if (!v.ok) return v;
        return { ok: true, id: doc!.id, invitation: invitation! };
    },

    async emailHasAccount(email: string): Promise<boolean> {
        try {
            await adminAuth.getUserByEmail(normalizeEmail(email));
            return true;
        } catch (err: any) {
            if (err?.code === 'auth/user-not-found') return false;
            throw err;
        }
    },

    /**
     * Acepta una invitación de forma atómica: marca `usedAt` dentro de una
     * transacción (si dos peticiones compiten, solo una gana) y después crea
     * el usuario (si no existe) y asigna el claim de rol.
     *
     * - `newPassword`: alta de cuenta nueva (se crea con admin SDK, así el
     *   registro funciona aunque el alta pública esté desactivada en Firebase).
     * - `existingUid`: usuario ya autenticado con el mismo email (idToken verificado).
     */
    async acceptInvitation(params: {
        token: string;
        email: string;
        newPassword?: string;
        existingUid?: string;
        now?: number;
    }): Promise<{ uid: string; role: PlatformRole }> {
        const now = params.now ?? Date.now();
        const found = await this.findInvitationByToken(params.token, now);
        if (!found.ok) throw new UserManagementError(found.reason, found.reason);
        const v = validateInvitation({ token: params.token, invitation: found.invitation, now, email: params.email });
        if (!v.ok) throw new UserManagementError(v.reason, v.reason);

        const ref = adminFirestore.collection(INVITATIONS_COLLECTION).doc(found.id);
        // 1) Reservar la invitación (single-use).
        await adminFirestore.runTransaction(async tx => {
            const fresh = await tx.get(ref);
            const data = fresh.data() as InvitationRecord | undefined;
            const check = validateInvitation({ token: params.token, invitation: data, now, email: params.email });
            if (!check.ok) throw new UserManagementError(check.reason, check.reason);
            tx.update(ref, { usedAt: now });
        });

        try {
            let uid = params.existingUid;
            if (!uid) {
                if (!params.newPassword || params.newPassword.length < 8) {
                    throw new UserManagementError('WEAK_PASSWORD', 'La contraseña debe tener al menos 8 caracteres.');
                }
                const created = await adminAuth.createUser({
                    email: found.invitation.email,
                    password: params.newPassword,
                    emailVerified: true, // el enlace llegó a ese email (o lo entregó un admin)
                });
                uid = created.uid;
            }
            await writeRoleClaim(uid, found.invitation.role);
            // Invalida sesiones previas sin el rol (el cliente re-crea la cookie).
            await adminAuth.revokeRefreshTokens(uid);
            await ref.update({ usedBy: uid });
            return { uid, role: found.invitation.role };
        } catch (err) {
            // Liberar la invitación si falló el alta (p.ej. email ya registrado).
            await ref.update({ usedAt: null, usedBy: null }).catch(() => {});
            throw err;
        }
    },
};

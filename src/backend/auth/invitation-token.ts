/**
 * Tokens de invitación — lógica pura (sin Firestore) para poder testearla.
 *
 * El token en claro solo existe en el enlace que se entrega al invitado.
 * En Firestore se guarda `tokenHash = sha256(token)` para que una lectura de
 * la colección no permita aceptar invitaciones.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isPlatformRole, type PlatformRole } from './roles';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITATION_TOKEN_BYTES = 32;
export const INVITATIONS_COLLECTION = 'user_invitations';

/** base64url de 32 bytes → 43 caracteres. */
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

export function generateInvitationToken(): string {
    return randomBytes(INVITATION_TOKEN_BYTES).toString('base64url');
}

export function hashInvitationToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isWellFormedInvitationToken(token: unknown): token is string {
    return typeof token === 'string' && TOKEN_FORMAT.test(token);
}

export function tokenMatchesHash(token: string, tokenHash: string): boolean {
    const a = Buffer.from(hashInvitationToken(token), 'hex');
    const b = Buffer.from(tokenHash || '', 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
}

export function normalizeEmail(email: string): string {
    return (email || '').trim().toLowerCase();
}

export interface InvitationRecord {
    email: string;
    role: PlatformRole;
    tokenHash: string;
    /** epoch ms */
    expiresAt: number;
    createdBy: string;
    createdAt?: number;
    usedAt: number | null;
    usedBy?: string | null;
    revokedAt?: number | null;
}

export type InvitationInvalidReason =
    | 'malformed'
    | 'not_found'
    | 'hash_mismatch'
    | 'expired'
    | 'used'
    | 'revoked'
    | 'invalid_role'
    | 'email_mismatch';

export type InvitationValidation =
    | { ok: true }
    | { ok: false; reason: InvitationInvalidReason };

export const INVITATION_REASON_MESSAGES: Record<InvitationInvalidReason, string> = {
    malformed: 'El enlace de invitación no es válido.',
    not_found: 'La invitación no existe.',
    hash_mismatch: 'El enlace de invitación no es válido.',
    expired: 'La invitación ha caducado. Pide una nueva.',
    used: 'Esta invitación ya se ha utilizado.',
    revoked: 'Esta invitación ha sido anulada.',
    invalid_role: 'La invitación tiene un rol no válido.',
    email_mismatch: 'El email no coincide con el de la invitación.',
};

/**
 * Valida una invitación ya cargada frente a un token en claro.
 * `email` (opcional) es el email con el que se intenta aceptar.
 */
export function validateInvitation(params: {
    token: unknown;
    invitation: InvitationRecord | null | undefined;
    now: number;
    email?: string;
}): InvitationValidation {
    const { token, invitation, now, email } = params;
    if (!isWellFormedInvitationToken(token)) return { ok: false, reason: 'malformed' };
    if (!invitation) return { ok: false, reason: 'not_found' };
    if (!tokenMatchesHash(token, invitation.tokenHash)) return { ok: false, reason: 'hash_mismatch' };
    if (invitation.revokedAt) return { ok: false, reason: 'revoked' };
    if (invitation.usedAt) return { ok: false, reason: 'used' };
    if (!Number.isFinite(invitation.expiresAt) || now >= invitation.expiresAt) {
        return { ok: false, reason: 'expired' };
    }
    if (!isPlatformRole(invitation.role) || invitation.role === 'user') {
        return { ok: false, reason: 'invalid_role' };
    }
    if (email !== undefined && normalizeEmail(email) !== normalizeEmail(invitation.email)) {
        return { ok: false, reason: 'email_mismatch' };
    }
    return { ok: true };
}

export function computeInvitationExpiry(now: number): number {
    return now + INVITATION_TTL_MS;
}

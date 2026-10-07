import { describe, expect, it } from 'vitest';
import {
    INVITATION_TTL_MS,
    computeInvitationExpiry,
    generateInvitationToken,
    hashInvitationToken,
    isWellFormedInvitationToken,
    tokenMatchesHash,
    validateInvitation,
    type InvitationRecord,
} from './invitation-token';

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);

function makeInvitation(token: string, overrides: Partial<InvitationRecord> = {}): InvitationRecord {
    return {
        email: 'Jefe.Obra@Example.com',
        role: 'encargado',
        tokenHash: hashInvitationToken(token),
        expiresAt: computeInvitationExpiry(NOW),
        createdBy: 'admin-uid',
        createdAt: NOW,
        usedAt: null,
        ...overrides,
    };
}

describe('tokens de invitación', () => {
    it('genera tokens base64url de 32 bytes, distintos entre sí', () => {
        const a = generateInvitationToken();
        const b = generateInvitationToken();
        expect(a).not.toBe(b);
        expect(isWellFormedInvitationToken(a)).toBe(true);
        expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    });

    it('guarda hash sha256 (hex) y nunca el token', () => {
        const t = generateInvitationToken();
        const h = hashInvitationToken(t);
        expect(h).toMatch(/^[0-9a-f]{64}$/);
        expect(h).not.toContain(t);
        expect(tokenMatchesHash(t, h)).toBe(true);
        expect(tokenMatchesHash(generateInvitationToken(), h)).toBe(false);
        expect(tokenMatchesHash(t, '')).toBe(false);
    });

    it('rechaza tokens mal formados', () => {
        expect(isWellFormedInvitationToken('')).toBe(false);
        expect(isWellFormedInvitationToken('abc')).toBe(false);
        expect(isWellFormedInvitationToken(123)).toBe(false);
        expect(isWellFormedInvitationToken('a'.repeat(42) + '=')).toBe(false);
    });

    it('caduca a los 7 días', () => {
        expect(computeInvitationExpiry(NOW) - NOW).toBe(INVITATION_TTL_MS);
        expect(INVITATION_TTL_MS).toBe(7 * 24 * 3600 * 1000);
    });
});

describe('validateInvitation', () => {
    const token = generateInvitationToken();

    it('acepta una invitación vigente con el mismo email (sin distinguir mayúsculas)', () => {
        expect(validateInvitation({ token, invitation: makeInvitation(token), now: NOW + 1000 })).toEqual({ ok: true });
        expect(validateInvitation({ token, invitation: makeInvitation(token), now: NOW, email: ' jefe.obra@example.com ' })).toEqual({ ok: true });
    });

    it('detecta cada motivo de rechazo', () => {
        const inv = makeInvitation(token);
        expect(validateInvitation({ token: 'x', invitation: inv, now: NOW })).toEqual({ ok: false, reason: 'malformed' });
        expect(validateInvitation({ token, invitation: null, now: NOW })).toEqual({ ok: false, reason: 'not_found' });
        expect(validateInvitation({ token: generateInvitationToken(), invitation: inv, now: NOW })).toEqual({ ok: false, reason: 'hash_mismatch' });
        expect(validateInvitation({ token, invitation: { ...inv, usedAt: NOW }, now: NOW })).toEqual({ ok: false, reason: 'used' });
        expect(validateInvitation({ token, invitation: { ...inv, revokedAt: NOW }, now: NOW })).toEqual({ ok: false, reason: 'revoked' });
        expect(validateInvitation({ token, invitation: inv, now: inv.expiresAt })).toEqual({ ok: false, reason: 'expired' });
        expect(validateInvitation({ token, invitation: { ...inv, role: 'user' }, now: NOW })).toEqual({ ok: false, reason: 'invalid_role' });
        expect(validateInvitation({ token, invitation: { ...inv, role: 'root' as any }, now: NOW })).toEqual({ ok: false, reason: 'invalid_role' });
        expect(validateInvitation({ token, invitation: inv, now: NOW, email: 'otro@example.com' })).toEqual({ ok: false, reason: 'email_mismatch' });
    });
});

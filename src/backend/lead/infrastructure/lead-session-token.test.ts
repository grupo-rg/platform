import { describe, it, expect } from 'vitest';
import { signLeadSessionToken, verifyLeadSessionToken, LEAD_SESSION_TTL_SECONDS } from './lead-session-token';

const SECRET = 'session-secret-session-secret-session-secret';

function tamperPayload(token: string, mutate: (p: any) => void): string {
    const [body, mac] = token.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    mutate(payload);
    return `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${mac}`;
}

describe('lead-session-token', () => {
    it('firma y verifica (30 días, flag verified)', () => {
        const now = Date.UTC(2026, 9, 7);
        const token = signLeadSessionToken({ leadId: 'lead-123', verified: true, nowMs: now }, SECRET);
        const session = verifyLeadSessionToken(token, SECRET, now + 1000);
        expect(session).not.toBeNull();
        expect(session!.leadId).toBe('lead-123');
        expect(session!.verified).toBe(true);
        expect(session!.expiresAt.getTime()).toBe(Math.floor(now / 1000) * 1000 + LEAD_SESSION_TTL_SECONDS * 1000);

        const owner = verifyLeadSessionToken(signLeadSessionToken({ leadId: 'x', verified: false }, SECRET), SECRET);
        expect(owner!.verified).toBe(false);
    });

    it('rechaza un leadId manipulado (firma no coincide)', () => {
        const token = signLeadSessionToken({ leadId: 'lead-123', verified: true }, SECRET);
        const forged = tamperPayload(token, p => { p.lid = 'lead-victima'; });
        expect(verifyLeadSessionToken(forged, SECRET)).toBeNull();
    });

    it('rechaza elevar v=0 → v=1 o alargar exp', () => {
        const token = signLeadSessionToken({ leadId: 'lead-123', verified: false }, SECRET);
        expect(verifyLeadSessionToken(tamperPayload(token, p => { p.v = 1; }), SECRET)).toBeNull();
        expect(verifyLeadSessionToken(tamperPayload(token, p => { p.exp += 9999999; }), SECRET)).toBeNull();
    });

    it('rechaza otro secreto, tokens caducados y basura', () => {
        const now = Date.now();
        const token = signLeadSessionToken({ leadId: 'lead-123', verified: true, nowMs: now, ttlSeconds: 60 }, SECRET);
        expect(verifyLeadSessionToken(token, 'otro-secreto-otro-secreto-otro-secreto')).toBeNull();
        expect(verifyLeadSessionToken(token, SECRET, now + 61_000)).toBeNull();
        expect(verifyLeadSessionToken('', SECRET)).toBeNull();
        expect(verifyLeadSessionToken(undefined, SECRET)).toBeNull();
        expect(verifyLeadSessionToken('abc', SECRET)).toBeNull();
        expect(verifyLeadSessionToken('a.b.c', SECRET)).toBeNull();
        expect(verifyLeadSessionToken(`${token}x`, SECRET)).toBeNull();
    });
});

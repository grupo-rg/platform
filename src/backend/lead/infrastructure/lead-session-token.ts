import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Token firmado de sesión de lead (cookie httpOnly `rg_lead_session`).
 *
 * Es la ÚNICA fuente de identidad del lead en servidor: ninguna server
 * action pública acepta un `leadId` enviado por el navegador.
 *
 * Formato: `base64url(JSON payload) + '.' + base64url(HMAC-SHA256(payload))`
 *
 * Payload:
 *   - `lid` leadId
 *   - `v`   1 = identidad verificada por OTP · 0 = lead creado por este
 *           navegador en esta sesión (p. ej. handoff del chat de un email
 *           nuevo). Ambos permiten gestionar SUS reservas; sólo `v=1`
 *           permite precargar datos personales en formularios.
 *   - `iat` / `exp` en segundos epoch.
 *
 * Sin `server-only` para poder testearlo; la lectura/escritura de la cookie
 * vive en `lead-session.ts` (server-only).
 */

export const LEAD_SESSION_COOKIE = 'rg_lead_session';
export const LEAD_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 días

export interface LeadSessionPayload {
    lid: string;
    v: 0 | 1;
    iat: number;
    exp: number;
}

export interface LeadSession {
    leadId: string;
    verified: boolean;
    expiresAt: Date;
}

const DEV_FALLBACK_SECRET = 'dev-only-lead-session-secret-change-me-0123456789';
let warnedFallback = false;

export function getLeadSessionSecret(): string {
    const secret = process.env.LEAD_SESSION_SECRET;
    if (secret && secret.length >= 32) return secret;
    if (process.env.NODE_ENV === 'production') {
        throw new Error('LEAD_SESSION_SECRET no configurado (mínimo 32 caracteres).');
    }
    if (!warnedFallback) {
        warnedFallback = true;
        console.warn('[lead-session] LEAD_SESSION_SECRET ausente o corto — usando secreto de desarrollo.');
    }
    return DEV_FALLBACK_SECRET;
}

function b64url(input: Buffer | string): string {
    return Buffer.from(input).toString('base64url');
}

function sign(data: string, secret: string): string {
    return createHmac('sha256', secret).update(data).digest('base64url');
}

export function signLeadSessionToken(
    params: { leadId: string; verified: boolean; nowMs?: number; ttlSeconds?: number },
    secret: string = getLeadSessionSecret()
): string {
    const iat = Math.floor((params.nowMs ?? Date.now()) / 1000);
    const payload: LeadSessionPayload = {
        lid: params.leadId,
        v: params.verified ? 1 : 0,
        iat,
        exp: iat + (params.ttlSeconds ?? LEAD_SESSION_TTL_SECONDS),
    };
    const body = b64url(JSON.stringify(payload));
    return `${body}.${sign(body, secret)}`;
}

/** Devuelve la sesión si firma y expiración son válidas; si no, null. */
export function verifyLeadSessionToken(
    token: string | undefined | null,
    secret: string = getLeadSessionSecret(),
    nowMs: number = Date.now()
): LeadSession | null {
    if (!token || typeof token !== 'string' || token.length > 1024) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body, mac] = parts;
    if (!body || !mac) return null;

    const expected = Buffer.from(sign(body, secret));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

    let payload: LeadSessionPayload;
    try {
        payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
    if (!payload || typeof payload.lid !== 'string' || !payload.lid || payload.lid.length > 128) return null;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= nowMs) return null;
    if (payload.v !== 0 && payload.v !== 1) return null;

    return {
        leadId: payload.lid,
        verified: payload.v === 1,
        expiresAt: new Date(payload.exp * 1000),
    };
}

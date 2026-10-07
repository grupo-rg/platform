import { createHmac, randomInt, timingSafeEqual } from 'crypto';

/**
 * Criptografía del OTP de leads.
 *
 *  - Generación con `crypto.randomInt` (CSPRNG), nunca `Math.random`.
 *  - Se guarda sólo `HMAC-SHA256(secret, leadId + ':' + code)`. El leadId
 *    actúa como sal: el mismo código en dos leads produce hashes distintos.
 *  - Comparación en tiempo constante.
 *
 * Secreto: `OTP_HMAC_SECRET` (≥ 32 caracteres). En producción es
 * obligatorio; en desarrollo/test se usa un secreto fijo con aviso.
 *
 * Sin `server-only` a propósito para poder testearlo con vitest; nunca se
 * importa desde componentes cliente.
 */

const DEV_FALLBACK_SECRET = 'dev-only-otp-hmac-secret-change-me-0123456789';
let warnedFallback = false;

export function getOtpSecret(): string {
    const secret = process.env.OTP_HMAC_SECRET;
    if (secret && secret.length >= 32) return secret;
    if (process.env.NODE_ENV === 'production') {
        throw new Error('OTP_HMAC_SECRET no configurado (mínimo 32 caracteres).');
    }
    if (!warnedFallback) {
        warnedFallback = true;
        console.warn('[otp-crypto] OTP_HMAC_SECRET ausente o corto — usando secreto de desarrollo.');
    }
    return DEV_FALLBACK_SECRET;
}

/** Código numérico de `length` dígitos, uniforme (incluye ceros a la izquierda). */
export function generateOtpCode(length: number = 6): string {
    const max = 10 ** length;
    return randomInt(0, max).toString().padStart(length, '0');
}

export function hashOtp(leadId: string, code: string, secret: string = getOtpSecret()): string {
    return createHmac('sha256', secret).update(`${leadId}:${code}`).digest('hex');
}

export function otpMatches(leadId: string, code: string, storedHash: string, secret: string = getOtpSecret()): boolean {
    if (!storedHash || !/^\d{4,10}$/.test(code || '')) return false;
    const candidate = Buffer.from(hashOtp(leadId, code, secret), 'hex');
    const stored = Buffer.from(storedHash, 'hex');
    if (candidate.length !== stored.length) return false;
    return timingSafeEqual(candidate, stored);
}

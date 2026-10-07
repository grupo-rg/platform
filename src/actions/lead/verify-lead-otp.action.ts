'use server';

import { VerifyLeadAccess } from '@/backend/lead/application/verify-lead-access';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { HmacOtpHasher } from '@/backend/lead/infrastructure/resend-otp-adapter';
import { setLeadSession } from '@/backend/lead/infrastructure/lead-session';
import { buildConsents, type ConsentDeclaration } from '@/backend/lead/domain/lead-consent';
import { checkRateLimit, RATE_LIMITS } from '@/backend/shared/security/rate-limiter';
import { getClientIp } from '@/backend/shared/security/client-identity';
import { logSecurityEvent } from '@/backend/shared/security/audit-log';

/**
 * Verifica el OTP enviado al email. Si es correcto emite la cookie httpOnly
 * firmada `rg_lead_session` (30 días), que pasa a ser la ÚNICA fuente de
 * identidad del lead en servidor.
 *
 * Devuelve el leadId propio (ya demostrado) sólo como pista para la UI.
 */
export async function verifyLeadOtpAction(
    email: string,
    otpCode: string,
    consent?: ConsentDeclaration
): Promise<{ success: boolean; leadId?: string; error?: string; locked?: boolean }> {
    try {
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const code = String(otpCode || '').trim();
        if (!normalizedEmail || !/^\d{6}$/.test(code)) {
            return { success: false, error: 'Código inválido o caducado.' };
        }

        const ip = await getClientIp();
        const rl = await checkRateLimit('leadOtpVerifyIp', ip, RATE_LIMITS.leadOtpVerifyIp);
        if (!rl.allowed) {
            return {
                success: false,
                error: `Demasiados intentos. Inténtalo de nuevo en ${Math.ceil(rl.retryAfterSeconds / 60)} minutos.`,
                locked: true,
            };
        }

        const useCase = new VerifyLeadAccess(new FirestoreLeadRepository(), new HmacOtpHasher());
        const consents = consent ? buildConsents(consent, 'identity_form', ip) : [];
        const result = await useCase.execute(normalizedEmail, code, consents);

        if (!result.success || !result.leadId) {
            if (result.reason === 'locked') {
                await logSecurityEvent({
                    type: 'rate_limit_exceeded',
                    identity: ip,
                    action: 'leadOtpVerify',
                    details: { reason: 'otp_locked' },
                });
                return {
                    success: false,
                    error: 'Demasiados intentos fallidos. Solicita un código nuevo en 15 minutos.',
                    locked: true,
                };
            }
            if (result.reason === 'expired' || result.reason === 'no_code') {
                return { success: false, error: 'El código ha caducado. Solicita uno nuevo.' };
            }
            return { success: false, error: 'Código inválido o caducado.' };
        }

        await setLeadSession(result.leadId, true);
        return { success: true, leadId: result.leadId };
    } catch (error: any) {
        console.error('Error verifying OTP:', error);
        return { success: false, error: 'Internal server error' };
    }
}

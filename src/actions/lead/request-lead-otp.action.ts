'use server';

import { RequestLeadAccess } from '@/backend/lead/application/request-lead-access';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { HmacOtpHasher, ResendOtpAdapter } from '@/backend/lead/infrastructure/resend-otp-adapter';
import { PersonalInfo, LeadPreferences } from '@/backend/lead/domain/lead';
import { buildConsents, type ConsentDeclaration } from '@/backend/lead/domain/lead-consent';
import { checkRateLimit, RATE_LIMITS } from '@/backend/shared/security/rate-limiter';
import { getClientIp } from '@/backend/shared/security/client-identity';
import { sanitizeUserText } from '@/backend/shared/security/input-sanitizer';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/** Respuesta genérica: idéntica exista o no el email (anti-enumeración). */
const GENERIC_OK = {
    success: true as const,
    message: 'Si el email es correcto, recibirás un código de verificación en unos segundos.',
};

/**
 * Solicita un OTP para verificar el email del visitante.
 *
 * Ya NO devuelve `leadId`: la identidad sólo se obtiene tras verificar el
 * código (`verifyLeadOtpAction`), que emite la cookie firmada de sesión.
 */
export async function requestLeadOtpAction(
    info: PersonalInfo,
    preferences: LeadPreferences,
    consent?: ConsentDeclaration
): Promise<{ success: boolean; message?: string; error?: string; rateLimited?: boolean }> {
    try {
        const email = String(info?.email || '').trim().toLowerCase();
        if (!email || !EMAIL_RE.test(email)) {
            return { success: false, error: 'Email inválido' };
        }
        if (!consent?.privacyAccepted) {
            return { success: false, error: 'Debes aceptar la política de privacidad para continuar.' };
        }

        const ip = await getClientIp();
        const [byEmail, byIp] = await Promise.all([
            checkRateLimit('leadOtpRequest', email, RATE_LIMITS.leadOtpRequest),
            checkRateLimit('leadOtpRequestIp', ip, RATE_LIMITS.leadOtpRequestIp),
        ]);
        const blocked = !byEmail.allowed ? byEmail : !byIp.allowed ? byIp : null;
        if (blocked) {
            return {
                success: false,
                error: `Demasiadas solicitudes de código. Inténtalo de nuevo en ${Math.ceil(blocked.retryAfterSeconds / 60)} minutos.`,
                rateLimited: true,
            };
        }

        const safeInfo: PersonalInfo = {
            name: sanitizeUserText(String(info.name || ''), 120).text,
            email,
            phone: String(info.phone || '').replace(/[^\d+ ]/g, '').slice(0, 25),
        };
        const safePrefs: LeadPreferences = {
            contactMethod: ['whatsapp', 'email', 'phone'].includes(preferences?.contactMethod)
                ? preferences.contactMethod
                : 'email',
            language: String(preferences?.language || 'es').slice(0, 5),
        };

        const useCase = new RequestLeadAccess(
            new FirestoreLeadRepository(),
            new ResendOtpAdapter(),
            new HmacOtpHasher()
        );
        // El resultado (enviado / bloqueado) no se revela al navegador.
        await useCase.execute(safeInfo, safePrefs, buildConsents(consent, 'identity_form', ip));
        return GENERIC_OK;
    } catch (error: any) {
        console.error('Error requesting OTP:', error);
        // Los errores del proveedor de email sí se muestran (son útiles y no
        // revelan si el email existe), el resto se generaliza.
        const msg = typeof error?.message === 'string' && error.message.length < 200
            ? error.message
            : 'No se pudo enviar el código. Inténtalo de nuevo.';
        return { success: false, error: msg };
    }
}

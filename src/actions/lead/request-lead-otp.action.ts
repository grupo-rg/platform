'use server';

import { RequestLeadAccess } from '@/backend/lead/application/request-lead-access';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { ResendOtpAdapter } from '@/backend/lead/infrastructure/resend-otp-adapter';
import { PersonalInfo, LeadPreferences } from '@/backend/lead/domain/lead';
import { checkRateLimit, RATE_LIMITS } from '@/backend/shared/security/rate-limiter';

export async function requestLeadOtpAction(info: PersonalInfo, preferences: LeadPreferences) {
    try {
        if (!info.email) {
            return { success: false, error: 'Email requerido' };
        }

        // Rate limit por email — protege contra abuso de envío de OTPs.
        const rateLimit = await checkRateLimit('leadOtpRequest', info.email.toLowerCase(), RATE_LIMITS.leadOtpRequest);
        if (!rateLimit.allowed) {
            return {
                success: false,
                error: `Demasiadas solicitudes de código para este email. Inténtalo de nuevo en ${Math.ceil(rateLimit.retryAfterSeconds / 60)} minutos.`,
                rateLimited: true,
            };
        }

        const leadRepo = new FirestoreLeadRepository();
        const otpService = new ResendOtpAdapter();
        const useCase = new RequestLeadAccess(leadRepo, otpService);

        const result = await useCase.execute(info, preferences);
        return { success: true, leadId: result.leadId };
    } catch (error: any) {
        console.error('Error requesting OTP:', error);
        return { success: false, error: error.message };
    }
}

import { LeadRepository } from '../domain/lead-repository';
import { OtpHasher } from '../domain/otp-service';
import type { OtpVerificationResult } from '../domain/lead';
import type { LeadConsent } from '../domain/lead-consent';

export interface VerifyLeadAccessResult {
    success: boolean;
    /** Sólo presente si success=true (el lead demostró controlar el email). */
    leadId?: string;
    name?: string;
    reason?: Exclude<OtpVerificationResult, 'verified'> | 'not_found';
}

/**
 * Verifica el OTP de un email. La identidad que devuelve (leadId) es la que
 * la action convierte en cookie firmada de sesión de lead.
 */
export class VerifyLeadAccess {
    constructor(
        private leadRepository: LeadRepository,
        private otpHasher: OtpHasher
    ) { }

    async execute(email: string, otpCode: string, consents: LeadConsent[] = []): Promise<VerifyLeadAccessResult> {
        const lead = await this.leadRepository.findByEmail(email);
        if (!lead) {
            // Mismo mensaje que un código inválido: no revelamos si el email existe.
            return { success: false, reason: 'not_found' };
        }

        const result = lead.verifyOtp(otpCode, (code, hash) => this.otpHasher.matches(lead.id, code, hash));

        if (result !== 'verified') {
            // Persistimos contador de intentos / bloqueo / invalidación.
            await this.leadRepository.save(lead);
            return { success: false, reason: result };
        }

        // Identidad demostrada: ahora sí registramos lo que declara el titular.
        lead.recordConsents(consents);
        await this.leadRepository.save(lead);

        return { success: true, leadId: lead.id, name: lead.personalInfo.name };
    }
}

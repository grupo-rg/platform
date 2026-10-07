import { Lead, PersonalInfo, LeadPreferences } from '../domain/lead';
import { LeadRepository } from '../domain/lead-repository';
import { OtpHasher, OtpService } from '../domain/otp-service';
import type { LeadConsent } from '../domain/lead-consent';
import { v4 as uuidv4 } from 'uuid';

export type RequestLeadAccessOutcome = 'sent' | 'locked';

/**
 * Emite un OTP para el email indicado.
 *
 * Seguridad:
 *  - NUNCA devuelve el leadId (evita enumeración / IDOR: antes cualquiera
 *    obtenía el leadId de cualquier email). La action responde siempre con un
 *    mensaje genérico.
 *  - Si el lead ya existe NO se sobrescriben sus datos personales ni sus
 *    consentimientos con lo que envíe un tercero no verificado.
 *  - Sólo se guarda el hash del código.
 */
export class RequestLeadAccess {
    constructor(
        private leadRepository: LeadRepository,
        private otpService: OtpService,
        private otpHasher: OtpHasher
    ) { }

    async execute(
        info: PersonalInfo,
        preferences: LeadPreferences,
        consents: LeadConsent[] = []
    ): Promise<{ outcome: RequestLeadAccessOutcome }> {
        let lead = await this.leadRepository.findByEmail(info.email);

        if (!lead) {
            lead = Lead.create(uuidv4(), info, preferences);
            // Lead nuevo: los consentimientos los declara su propio creador.
            lead.recordConsents(consents);
        }

        const code = this.otpService.generateCode();
        const issued = lead.generateOtp(this.otpHasher.hash(lead.id, code));
        if (!issued) {
            // Bloqueado por intentos fallidos: no enviamos nada.
            return { outcome: 'locked' };
        }

        await this.leadRepository.save(lead);
        await this.otpService.sendOtp(lead.personalInfo.email, code);

        return { outcome: 'sent' };
    }
}

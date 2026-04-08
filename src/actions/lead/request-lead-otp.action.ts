'use server';

import { RequestLeadAccess } from '@/backend/lead/application/request-lead-access';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { NodemailerOtpAdapter } from '@/backend/lead/infrastructure/nodemailer-otp-adapter';
import { PersonalInfo, LeadPreferences } from '@/backend/lead/domain/lead';

export async function requestLeadOtpAction(info: PersonalInfo, preferences: LeadPreferences) {
    try {
        const leadRepo = new FirestoreLeadRepository();
        const otpService = new NodemailerOtpAdapter();
        const useCase = new RequestLeadAccess(leadRepo, otpService);

        const result = await useCase.execute(info, preferences);
        return { success: true, leadId: result.leadId };
    } catch (error: any) {
        console.error('Error requesting OTP:', error);
        return { success: false, error: error.message };
    }
}

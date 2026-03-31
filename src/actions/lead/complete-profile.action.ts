'use server';

import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import {
    BiggestPain,
    ProjectScale,
    CurrentStack,
    AnnualSurveyorSpend,
    WeeklyManualHours,
    ClientRole
} from '@/backend/lead/domain/lead';

const leadRepo = new FirestoreLeadRepository();

export interface ProfileData {
    biggestPain: BiggestPain[];
    simultaneousProjects: ProjectScale;
    currentStack: CurrentStack[];
    companyName: string;
    companySize: 'solo' | '2-5' | '6-15' | '16-50' | '50+';
    annualSurveyorSpend?: AnnualSurveyorSpend;
    weeklyManualHours?: WeeklyManualHours;
    role: ClientRole;
    web?: string;
}

/**
 * Complete a lead's client profile after OTP verification.
 * Called from the Profiling Wizard.
 */
export async function completeProfileAction(
    leadId: string,
    data: ProfileData
): Promise<{ success: boolean; error?: string }> {
    try {
        const lead = await leadRepo.findById(leadId);
        if (!lead) return { success: false, error: 'Lead no encontrado.' };

        if (!lead.verification.isVerified) {
            return { success: false, error: 'Verificación OTP requerida.' };
        }

        lead.completeProfile(data);
        // If website is provided, persist it on personalInfo
        if (data.web) {
            lead.personalInfo.web = data.web;
        }
        await leadRepo.save(lead);

        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

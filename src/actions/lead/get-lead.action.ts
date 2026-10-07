'use server';

import { checkAdmin, unauthorizedResult } from '@/actions/_guards';

import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';

const leadRepo = new FirestoreLeadRepository();

export async function getLeadAction(leadId: string) {
    try {
        const auth = await checkAdmin();
        if (!auth) return unauthorizedResult();

        const lead = await leadRepo.findById(leadId);
        if (!lead) return { success: false, error: 'Lead no encontrado' };

        return {
            success: true,
            data: {
                name: lead.personalInfo.name,
                email: lead.personalInfo.email,
                companyName: lead.profile?.companyName,
                web: lead.personalInfo.web,
                hasFeedback: !!lead.profile?.feedback
            }
        };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

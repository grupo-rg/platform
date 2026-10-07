'use server';

import { checkAdmin, unauthorizedResult } from '@/actions/_guards';

import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';

export async function markDemoPdfDownloadedAction(leadId: string) {
    if (!(await checkAdmin())) return unauthorizedResult();
    try {
        const leadRepo = new FirestoreLeadRepository();
        const lead = await leadRepo.findById(leadId);

        if (!lead) {
            return { success: false, error: 'Lead not found' };
        }

        lead.incrementDemoPdfs();
        await leadRepo.save(lead);

        return { success: true };
    } catch (error: any) {
        console.error('Error marking demo PDF as downloaded:', error);
        return { success: false, error: 'Internal server error' };
    }
}

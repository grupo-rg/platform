'use server';

import { FirestoreLeadRepository } from '../../backend/lead/infrastructure/firestore-lead-repository';
import { ClientProfile } from '../../backend/lead/domain/lead';

export async function saveLeadFeedbackAction(leadId: string, feedback: Record<string, string>) {
    try {
        const repo = new FirestoreLeadRepository();
        const lead = await repo.findById(leadId);

        if (!lead) {
            return { success: false, error: 'Lead not found' };
        }

        if (!lead.profile) {
            // Create a dummy profile if none exists, just to store feedback
            lead.completeProfile({
                biggestPain: [],
                simultaneousProjects: '1-3',
                currentStack: [],
                companyName: 'Buscando perfil...',
                companySize: 'solo',
                annualSurveyorSpend: '<10k',
                weeklyManualHours: '<5h',
                role: 'owner',
                feedback: feedback
            } as Omit<ClientProfile, 'completedAt'>);
        } else {
            lead.profile.feedback = {
                ...lead.profile.feedback,
                ...feedback
            };
        }

        lead.updatedAt = new Date();
        await repo.save(lead);

        return { success: true };
    } catch (error: any) {
        console.error('Failed to save lead feedback:', error);
        return { success: false, error: error.message || 'Unknown error' };
    }
}

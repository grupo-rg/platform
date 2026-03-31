'use server';

import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';

export async function getLeadPdfConfigAction(leadId: string) {
    if (!leadId || leadId === 'unassigned') {
        return null;
    }

    try {
        const repository = new FirestoreLeadRepository();
        const lead = await repository.findById(leadId);

        if (!lead) return null;

        let pdfMetadata: any = lead.pdfMetadata || {};
        
        // The lead executing the platform is the emitting company, not the client!
        if (!pdfMetadata.companyName && lead.profile?.companyName) {
            pdfMetadata.companyName = lead.profile.companyName;
        } else if (!pdfMetadata.companyName && lead.personalInfo?.name) {
            pdfMetadata.companyName = lead.personalInfo.name;
        }

        return Object.keys(pdfMetadata).length > 0 ? pdfMetadata : null;
    } catch (error) {
        console.error("Error fetching PDF config for lead:", error);
        return null;
    }
}

'use server';

import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { revalidatePath } from 'next/cache';

export async function saveLeadPdfConfigAction(
    leadId: string,
    pdfConfig: {
        companyName: string;
        companyLogo: string;
        clientName: string;
        clientAddress: string;
        notes: string;
    }
) {
    try {
        const repository = new FirestoreLeadRepository();
        const lead = await repository.findById(leadId);
        
        if (!lead) {
            throw new Error("Lead no encontrado.");
        }

        lead.updatePdfMetadata(pdfConfig);
        await repository.save(lead);

        return { success: true };
    } catch (error: any) {
        console.error("Error saving PDF config:", error);
        return { success: false, error: error.message };
    }
}

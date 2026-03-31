'use server';

import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { revalidatePath } from 'next/cache';

export async function deleteLeadAction(leadId: string) {
    try {
        if (!leadId) {
            return { success: false, error: 'Lead ID no proporcionado.' };
        }

        const repo = new FirestoreLeadRepository();
        await repo.delete(leadId);

        revalidatePath('/dashboard/leads');
        revalidatePath('/dashboard/admin/leads'); // In case it exists

        return { success: true };
    } catch (error: any) {
        console.error('Error deleting lead:', error);
        return { success: false, error: error.message || 'Error al eliminar el lead.' };
    }
}

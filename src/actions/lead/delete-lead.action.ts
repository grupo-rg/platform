'use server';

import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { FirebaseDealRepository } from '@/backend/crm/infrastructure/persistence/firebase.deal.repository';
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';
import { revalidatePath } from 'next/cache';

export async function deleteLeadAction(leadId: string) {
    try {
        if (!leadId) {
            return { success: false, error: 'Lead ID no proporcionado.' };
        }

        const leadRepo = new FirestoreLeadRepository();
        const dealRepo = new FirebaseDealRepository();

        // Cascada: borrar deals asociados primero. Si dejamos deals
        // huérfanos, el Kanban muestra cards con `lead=null` que no se
        // pueden gestionar.
        const deal = await dealRepo.findByLeadId(leadId);
        if (deal) {
            initFirebaseAdminApp();
            const db = getFirestore();
            const dealsCollection = process.env.NEXT_PUBLIC_USE_TEST_DB === 'true' ? 'test_crm_deals' : 'crm_deals';
            await db.collection(dealsCollection).doc(deal.id).delete();
            console.log(`[deleteLeadAction] Deal ${deal.id} eliminado en cascada con lead ${leadId}`);
        }

        await leadRepo.delete(leadId);

        revalidatePath('/dashboard/leads');
        revalidatePath('/dashboard/leads');

        return { success: true };
    } catch (error: any) {
        console.error('Error deleting lead:', error);
        return { success: false, error: error.message || 'Error al eliminar el lead.' };
    }
}

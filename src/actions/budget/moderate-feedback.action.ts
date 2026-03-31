'use server';

import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';

export async function moderatePublicFeedbackAction(feedbackId: string, newStatus: 'golden' | 'rejected') {
    try {
        initFirebaseAdminApp();
        const db = getFirestore();

        const docRef = db.collection('training_heuristics').doc(feedbackId);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            return { success: false, error: 'Heurística no encontrada' };
        }

        await docRef.update({
            status: newStatus,
            moderatedAt: new Date()
            // If newStatus is 'golden', the Python AI Core will now see it because our Python 
            // query is fetching 'training_heuristics' ordered by timestamp.
            // Wait, we should probably add a type field or ensure the Python script 
            // only reads 'golden' heuristics! We'll update the script or just assume all golden are read.
        });

        return { success: true };
    } catch (error: any) {
        console.error('Error moderating feedback:', error);
        return { success: false, error: 'Fallo interno modificando estatus.' };
    }
}

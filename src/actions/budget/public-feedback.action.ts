'use server';

import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';
import { HeuristicFragment } from '@/backend/ai-training/domain/heuristic-fragment';

interface PublicDemoFeedbackPayload {
    budgetId: string;
    itemId: string;
    description: string;
    proposedPrice: number;
    vote: 'up' | 'down';
    reason?: string;
}

export async function savePublicDemoFeedbackAction(payload: PublicDemoFeedbackPayload) {
    try {
        initFirebaseAdminApp();
        const db = getFirestore();

        const feedbackData: Omit<HeuristicFragment, 'id'> = {
            sourceType: 'public_demo',
            status: 'pending_review',
            context: {
                budgetId: payload.budgetId,
                originalDescription: payload.description,
            },
            aiInferenceTrace: {
                proposedUnitPrice: payload.proposedPrice,
                proposedCandidateId: payload.itemId // Optional, just to maintain relation
            },
            humanCorrection: {
                heuristicRule: payload.reason || (payload.vote === 'up' ? "Aprovado silenciosamente" : ""),
            },
            tags: [], // Could be inferred
            timestamp: new Date().toISOString(),
        };

        // Guardamos en la misma colección de entrenamiento, pero entra en cuarentena (pending_review)
        await db.collection('training_heuristics').add(feedbackData);

        return { success: true };
    } catch (error: any) {
        console.error('Error saving public feedback:', error);
        return { success: false, error: error.message || 'Error interno al guardar feedback' };
    }
}

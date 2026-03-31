'use server';

import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';
import { HeuristicFragment } from '@/backend/ai-training/domain/heuristic-fragment';
interface ICLFeedbackPayload {
    itemId: string;
    leadId: string;
    originalDescription: string;
    selectedCandidateCode: string;
    selectedCandidateDescription: string;
    humanReasoning: string;
    finalPrice: number;
    finalQuantity: number;
    finalUnit: string;
    chapter: string;
}

export async function saveIclFeedbackAction(payload: ICLFeedbackPayload) {
    try {
        initFirebaseAdminApp();
        const db = getFirestore();

        const heuristicData: Omit<HeuristicFragment, 'id'> = {
            sourceType: 'internal_admin',
            status: 'pending_review', // Can be promoted to golden in Admin Trace, or directly if desired
            context: {
                budgetId: payload.leadId, // currently we pass leadId
                originalDescription: payload.originalDescription,
                originalQuantity: payload.finalQuantity,
                originalUnit: payload.finalUnit
            },
            aiInferenceTrace: {
                proposedUnitPrice: 0, // Ignored or unknown here as it's an internal fast track
            },
            humanCorrection: {
                selectedCandidateCode: payload.selectedCandidateCode,
                selectedCandidateTuple: payload.selectedCandidateDescription,
                correctedUnitPrice: payload.finalPrice,
                correctedUnit: payload.finalUnit,
                heuristicRule: payload.humanReasoning
            },
            tags: [payload.chapter],
            timestamp: new Date().toISOString()
        };

        // Save to a specialized collection for training heuristics
        await db.collection('training_heuristics').add(heuristicData);

        return { success: true };
    } catch (error: any) {
        console.error('Error saving ICL feedback:', error);
        return { success: false, error: error.message || 'Error interno al guardar la heurística' };
    }
}

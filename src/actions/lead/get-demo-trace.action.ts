'use server';

import { FirestoreAiTrainingRepository } from '@/backend/ai-training/infrastructure/firestore-ai-training-repository';

export async function getPublicDemoTraceByLeadIdAction(leadId: string) {
    try {
        const repo = new FirestoreAiTrainingRepository();
        const existingTraces = await repo.findByLeadId(leadId);
        
        if (existingTraces && existingTraces.length > 0) {
            // Sort by createdAt descending to get the most recent one just in case
            const sortedTraces = existingTraces.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            return { success: true, traceId: sortedTraces[0].id };
        }
        
        return { success: false, error: 'No demo trace found' };
    } catch (err: any) {
        console.error("Error fetching demo trace:", err);
        return { success: false, error: 'Internal server error' };
    }
}

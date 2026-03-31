'use server';

import { FirestoreAiTrainingRepository } from '@/backend/ai-training/infrastructure/firestore-ai-training-repository';

export async function getAiTrainingDataAction() {
    try {
        const repo = new FirestoreAiTrainingRepository();
        const traces = await repo.findAll();

        return {
            success: true,
            data: traces.map(trace => trace.toMap())
        };
    } catch (error: any) {
        console.error("Error fetching AI Training Data:", error);
        return { success: false, error: error.message };
    }
}

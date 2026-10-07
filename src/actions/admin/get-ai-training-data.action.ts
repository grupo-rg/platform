'use server';

import { checkAdmin, unauthorizedResult } from '@/actions/_guards';

import { FirestoreAiTrainingRepository } from '@/backend/ai-training/infrastructure/firestore-ai-training-repository';

export async function getAiTrainingDataAction() {
    if (!(await checkAdmin())) return unauthorizedResult();
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

'use server';

import { FirestoreAiTrainingRepository } from '@/backend/ai-training/infrastructure/firestore-ai-training-repository';
import { SaveFinalHumanEditUseCase } from '@/backend/ai-training/application/save-final-human-edit.use-case';

export async function saveTrainingDeltaAction(
    traceId: string,
    finalFormattedJson: any,
    timeSpentEditingMs: number
) {
    try {
        console.log(`>> Saving Human-Edited RLHF Delta for trace: ${traceId}...`);

        const repository = new FirestoreAiTrainingRepository();
        const useCase = new SaveFinalHumanEditUseCase(repository);

        await useCase.execute(traceId, finalFormattedJson, timeSpentEditingMs);

        return { success: true };
    } catch (error: any) {
        console.error("Error saving training delta:", error);
        // Important: We don't want to break the user's PDF download if telemetry fails
        return { success: false, error: error.message };
    }
}

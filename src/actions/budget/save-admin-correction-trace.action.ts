'use server';

import { FirestoreAiTrainingRepository } from '@/backend/ai-training/infrastructure/firestore-ai-training-repository';
import { AiTrainingData } from '@/backend/ai-training/domain/ai-training-data';

export async function saveAdminCorrectionTraceAction(
    budgetId: string,
    originalBudgetState: any,
    finalEditedState: any,
    timeSpentEditingMs: number
) {
    try {
        console.log(`>> Capturing Admin RLHF Correction for budget: ${budgetId}...`);

        const repository = new FirestoreAiTrainingRepository();
        
        // We use a prefix to distinct private traces from public demo ones
        const virtualTraceId = `admin-trace-${budgetId}-${Date.now()}`;
        
        const trace = AiTrainingData.captureInteraction(
            virtualTraceId,
            'private_admin_editor',
            'Admin Private Edition', // Original prompt not applicable
            originalBudgetState,
            { baselineTokens: 0, baselineTimeMs: 0 },
            budgetId
        );
        
        trace.recordHumanEdit(finalEditedState, timeSpentEditingMs);
        
        await repository.save(trace);

        return { success: true, traceId: virtualTraceId };
    } catch (error: any) {
        console.error("Error saving admin telemetry trace:", error);
        // Do not break the app for telemetry failure
        return { success: false, error: error.message };
    }
}

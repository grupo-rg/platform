import { AiTrainingData, AiGenerationMetrics } from '../domain/ai-training-data';
import { AiTrainingRepository } from '../domain/ai-training-repository';
import * as crypto from 'crypto';

export class RecordInitialAiTraceUseCase {
    constructor(private readonly repository: AiTrainingRepository) { }

    async execute(
        leadId: string,
        prompt: string,
        baselineJson: any,
        metrics: Omit<AiGenerationMetrics, 'humanEditTimeMs'>,
        projectId?: string
    ): Promise<string> {
        // Generate a deterministic or random UUID for this generation
        const traceId = crypto.randomUUID();

        const trace = AiTrainingData.captureInteraction(
            traceId,
            leadId,
            prompt,
            baselineJson,
            metrics,
            projectId
        );

        await this.repository.save(trace);

        return traceId;
    }
}

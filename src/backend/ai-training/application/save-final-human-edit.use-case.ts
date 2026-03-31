import { AiTrainingRepository } from '../domain/ai-training-repository';

export class SaveFinalHumanEditUseCase {
    constructor(private readonly repository: AiTrainingRepository) { }

    async execute(
        traceId: string,
        finalFormattedJson: any,
        timeSpentEditingMs: number
    ): Promise<void> {
        const trace = await this.repository.findById(traceId);

        if (!trace) {
            throw new Error(`AiTrainingTrace with id ${traceId} not found.`);
        }

        trace.recordHumanEdit(finalFormattedJson, timeSpentEditingMs);

        await this.repository.save(trace);
    }
}

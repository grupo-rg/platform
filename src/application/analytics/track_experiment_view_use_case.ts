import { ExperimentEvent } from '../../domain/analytics/ab-testing/entity/experiment_event';
import { IExperimentRepository } from '../../domain/analytics/ab-testing/repository/i_experiment_repository';

export interface TrackExperimentViewCommand {
    experimentId: string;
    variantId: string;
    visitorId: string;
    metadata?: Record<string, any>;
}

export class TrackExperimentViewUseCase {
    constructor(private experimentRepository: IExperimentRepository) { }

    public async execute(command: TrackExperimentViewCommand): Promise<void> {
        const event = ExperimentEvent.create({
            id: crypto.randomUUID(),
            experimentId: command.experimentId,
            variantId: command.variantId,
            visitorId: command.visitorId,
            metadata: command.metadata
        });

        await this.experimentRepository.saveEvent(event);
    }
}

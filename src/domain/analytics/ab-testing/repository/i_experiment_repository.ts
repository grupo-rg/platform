import { ExperimentEvent } from '../entity/experiment_event';

export interface IExperimentRepository {
    saveEvent(event: ExperimentEvent): Promise<void>;
    getEventsByExperiment(experimentId: string): Promise<ExperimentEvent[]>;
}

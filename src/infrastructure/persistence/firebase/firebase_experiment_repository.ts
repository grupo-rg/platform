import { ExperimentEvent } from '../../../domain/analytics/ab-testing/entity/experiment_event';
import { IExperimentRepository } from '../../../domain/analytics/ab-testing/repository/i_experiment_repository';

export class FirebaseExperimentRepository implements IExperimentRepository {
    private collectionPath = 'ab_test_events';

    public async saveEvent(event: ExperimentEvent): Promise<void> {
        const data = {
            id: event.id,
            experimentId: event.experimentId,
            variantId: event.variantId,
            visitorId: event.visitorId,
            timestamp: event.timestamp.toISOString(),
            metadata: event.metadata || null,
        };
        // await this.db.collection(this.collectionPath).doc(event.id).set(data);
        console.log(`[Firestore Mock] Tracked AB Test Event`, data);
    }

    public async getEventsByExperiment(experimentId: string): Promise<ExperimentEvent[]> {
        // Fetch and reconstruct
        return [];
    }
}

import { SequenceRepository } from '../../domain/marketing.repository';
import { Sequence, SequenceStep } from '../../domain/sequence';
import { getFirestore } from 'firebase-admin/firestore';

export class FirebaseSequenceRepository implements SequenceRepository {
    private get collectionName() {
        return process.env.NEXT_PUBLIC_USE_TEST_DB === 'true' ? 'test_marketing_sequences' : 'marketing_sequences';
    }

    private get db() {
        return getFirestore();
    }

    async save(sequence: Sequence): Promise<void> {
        const data = {
            id: sequence.id,
            name: sequence.name,
            active: sequence.active,
            steps: sequence.steps
        };
        await this.db.collection(this.collectionName).doc(sequence.id).set(data, { merge: true });
    }

    async findById(id: string): Promise<Sequence | null> {
        const doc = await this.db.collection(this.collectionName).doc(id).get();
        if (!doc.exists) return null;
        
        const data = doc.data() as any;
        return new Sequence(
            data.id,
            data.name,
            data.steps as SequenceStep[],
            data.active
        );
    }

    async findAllActive(): Promise<Sequence[]> {
        const snapshot = await this.db.collection(this.collectionName).where('active', '==', true).get();
        if (snapshot.empty) return [];
        
        return snapshot.docs.map(doc => {
            const data = doc.data() as any;
            return new Sequence(data.id, data.name, data.steps as SequenceStep[], data.active);
        });
    }
}

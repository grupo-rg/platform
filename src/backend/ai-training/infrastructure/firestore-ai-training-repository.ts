import { AiTrainingData } from '../domain/ai-training-data';
import { AiTrainingRepository } from '../domain/ai-training-repository';
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';

export class FirestoreAiTrainingRepository implements AiTrainingRepository {
    private db;
    private readonly COLLECTION_NAME = 'ai_training_traces';

    constructor() {
        initFirebaseAdminApp();
        this.db = getFirestore();
    }

    async save(data: AiTrainingData): Promise<void> {
        const docRef = this.db.collection(this.COLLECTION_NAME).doc(data.id);
        await docRef.set(data.toMap());
    }

    async findById(id: string): Promise<AiTrainingData | null> {
        const docRef = this.db.collection(this.COLLECTION_NAME).doc(id);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            return null;
        }

        return AiTrainingData.fromMap(docSnap.data());
    }

    async findByLeadId(leadId: string): Promise<AiTrainingData[]> {
        const snapshot = await this.db.collection(this.COLLECTION_NAME)
            .where('leadId', '==', leadId)
            .orderBy('createdAt', 'desc')
            .get();

        return snapshot.docs.map(doc => AiTrainingData.fromMap(doc.data()));
    }

    async findAllWithEdits(): Promise<AiTrainingData[]> {
        const snapshot = await this.db.collection(this.COLLECTION_NAME)
            .where('resolution', 'in', ['human_edited', 'accepted_as_is'])
            .orderBy('createdAt', 'desc')
            .get();

        return snapshot.docs.map(doc => AiTrainingData.fromMap(doc.data()));
    }

    async findAll(): Promise<AiTrainingData[]> {
        const snapshot = await this.db.collection(this.COLLECTION_NAME)
            .orderBy('createdAt', 'desc')
            .get();

        return snapshot.docs.map(doc => AiTrainingData.fromMap(doc.data()));
    }
}

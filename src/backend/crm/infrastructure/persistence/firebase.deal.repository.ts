import { DealRepository } from '../../domain/deal.repository';
import { Deal, PipelineStage } from '../../domain/deal';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

export class FirebaseDealRepository implements DealRepository {
    private get collectionName() {
        return process.env.NEXT_PUBLIC_USE_TEST_DB === 'true' ? 'test_crm_deals' : 'crm_deals';
    }
    
    // Lazy loaded db getter to ensure it works within Next.js API routes where app might not be initialized immediately on boot
    private get db() {
        return getFirestore();
    }

    async save(deal: Deal): Promise<void> {
        const isValidDate = (d: any) => d instanceof Date && !isNaN(d.getTime());
        
        const data = {
            id: deal.id,
            leadId: deal.leadId,
            pipelineStageId: deal.stage,
            estimatedValue: deal.estimatedValue,
            createdAt: isValidDate(deal.createdAt) ? Timestamp.fromDate(deal.createdAt) : FieldValue.serverTimestamp(),
            updatedAt: isValidDate(deal.updatedAt) ? Timestamp.fromDate(deal.updatedAt) : FieldValue.serverTimestamp(),
            stageHistory: deal.stageHistory,
            metadata: deal.metadata || {}
        };
        await this.db.collection(this.collectionName).doc(deal.id).set(data, { merge: true });
        console.log(`[Firestore CRM] Deal ${deal.id} saved in PipelineStage ${deal.stage}`);
    }

    async findById(id: string): Promise<Deal | null> {
        const doc = await this.db.collection(this.collectionName).doc(id).get();
        if (!doc.exists) return null;
        
        const data = doc.data() as any;
        return new Deal(
            data.id,
            data.leadId,
            data.stage as PipelineStage,
            data.estimatedValue,
            new Date(data.createdAt),
            new Date(data.updatedAt),
            (data.stageHistory || []).map((h: any) => ({
                stage: h.stage as PipelineStage,
                timestamp: new Date(h.timestamp)
            }))
        );
    }

    async findByLeadId(leadId: string): Promise<Deal | null> {
        const snapshot = await this.db.collection(this.collectionName).where('leadId', '==', leadId).limit(1).get();
        if (snapshot.empty) return null;
        
        const data = snapshot.docs[0].data() as any;
        return new Deal(
            data.id,
            data.leadId,
            data.stage as PipelineStage,
            data.estimatedValue,
            new Date(data.createdAt),
            new Date(data.updatedAt),
            (data.stageHistory || []).map((h: any) => ({
                stage: h.stage as PipelineStage,
                timestamp: new Date(h.timestamp)
            }))
        );
    }

    async findAllByStage(stage: string): Promise<Deal[]> {
        const snapshot = await this.db.collection(this.collectionName).where('stage', '==', stage).get();
        if (snapshot.empty) return [];
        
        return snapshot.docs.map(doc => {
            const data = doc.data() as any;
            return new Deal(
                data.id,
                data.leadId,
                data.stage as PipelineStage,
                data.estimatedValue,
                new Date(data.createdAt),
                new Date(data.updatedAt),
                (data.stageHistory || []).map((h: any) => ({
                    stage: h.stage as PipelineStage,
                    timestamp: new Date(h.timestamp)
                }))
            );
        });
    }

    async findAll(): Promise<Deal[]> {
        const snapshot = await this.db.collection(this.collectionName).get();
        if (snapshot.empty) return [];
        
        return snapshot.docs.map(doc => {
            const data = doc.data() as any;
            return new Deal(
                data.id,
                data.leadId,
                data.stage as PipelineStage,
                data.estimatedValue,
                new Date(data.createdAt),
                new Date(data.updatedAt),
                (data.stageHistory || []).map((h: any) => ({
                    stage: h.stage as PipelineStage,
                    timestamp: new Date(h.timestamp)
                }))
            );
        });
    }
}

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
            // El nombre del campo debe coincidir con el que leen findById/findByLeadId/findAllByStage.
            stage: deal.stage,
            estimatedValue: deal.estimatedValue,
            createdAt: isValidDate(deal.createdAt) ? Timestamp.fromDate(deal.createdAt) : FieldValue.serverTimestamp(),
            updatedAt: isValidDate(deal.updatedAt) ? Timestamp.fromDate(deal.updatedAt) : FieldValue.serverTimestamp(),
            stageHistory: (deal.stageHistory || []).map(h => ({
                stage: h.stage,
                timestamp: isValidDate(h.timestamp) ? Timestamp.fromDate(h.timestamp) : FieldValue.serverTimestamp(),
            })),
            // intakeSnapshot puede traer campos opcionales (postalCode, city,
            // approxBudget, etc.) en undefined. Firestore rechaza undefined
            // si las settings no se aplicaron a tiempo; limpiamos defensivamente.
            metadata: stripUndefinedDeep(deal.metadata || {}),
        };
        await this.db.collection(this.collectionName).doc(deal.id).set(data, { merge: true });
        console.log(`[Firestore CRM] Deal ${deal.id} saved in PipelineStage ${deal.stage}`);
    }

    async findById(id: string): Promise<Deal | null> {
        const doc = await this.db.collection(this.collectionName).doc(id).get();
        if (!doc.exists) return null;
        
        return mapDocToDeal(doc.data());
    }

    async findByLeadId(leadId: string): Promise<Deal | null> {
        // Devuelve el deal más reciente del lead.
        const snapshot = await this.db.collection(this.collectionName)
            .where('leadId', '==', leadId)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();
        if (snapshot.empty) return null;
        return mapDocToDeal(snapshot.docs[0].data());
    }

    async findAllByLeadId(leadId: string): Promise<Deal[]> {
        const snapshot = await this.db.collection(this.collectionName)
            .where('leadId', '==', leadId)
            .orderBy('createdAt', 'desc')
            .get();
        if (snapshot.empty) return [];
        return snapshot.docs.map(d => mapDocToDeal(d.data()));
    }

    async findAllByStage(stage: string): Promise<Deal[]> {
        const snapshot = await this.db.collection(this.collectionName).where('stage', '==', stage).get();
        if (snapshot.empty) return [];
        
        return snapshot.docs.map(d => mapDocToDeal(d.data()));
    }

    async findAll(): Promise<Deal[]> {
        const snapshot = await this.db.collection(this.collectionName).get();
        if (snapshot.empty) return [];

        return snapshot.docs.map(d => mapDocToDeal(d.data()));
    }
}

function toDate(value: any): Date {
    if (!value) return new Date();
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') return value.toDate(); // Firestore Timestamp
    if (typeof value === 'string' || typeof value === 'number') return new Date(value);
    return new Date();
}

/**
 * Quita recursivamente las claves cuyo valor es `undefined`. No toca
 * Date, Timestamp ni FieldValue (sólo objetos planos y arrays). Usado
 * para sanear el `metadata` del Deal antes de persistir.
 */
function stripUndefinedDeep<T>(value: T): T {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) {
        return value
            .filter(v => v !== undefined)
            .map(v => stripUndefinedDeep(v)) as unknown as T;
    }
    if (typeof value === 'object') {
        // Preservar instancias especiales (Timestamp, FieldValue, Date, etc.)
        const proto = Object.getPrototypeOf(value);
        if (proto && proto !== Object.prototype) {
            return value;
        }
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(value as Record<string, any>)) {
            if (v === undefined) continue;
            out[k] = stripUndefinedDeep(v);
        }
        return out as T;
    }
    return value;
}

function mapDocToDeal(data: any): Deal {
    return new Deal(
        data.id,
        data.leadId,
        // Compatibilidad hacia atrás: docs antiguos persistidos con `pipelineStageId`.
        (data.stage || data.pipelineStageId) as PipelineStage,
        data.estimatedValue || 0,
        toDate(data.createdAt),
        toDate(data.updatedAt),
        (data.stageHistory || []).map((h: any) => ({
            stage: h.stage as PipelineStage,
            timestamp: toDate(h.timestamp),
        })),
        data.metadata || {}
    );
}

/**
 * Sprint 3 — S3-07 partial
 *
 * Adaptador Firestore para `CorrectionPair`. Sigue el mismo patrón que
 * `FirestoreAiTrainingRepository` (admin-SDK, instancia singleton).
 *
 * Collection: `correction_pairs/{id}`.
 * Las firestore.rules niegan toda escritura cliente — solo admin SDK.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';
import { CorrectionPair, CorrectionPairRepository } from '../domain/correction-pair';

export class FirestoreCorrectionPairRepository implements CorrectionPairRepository {
    private db;
    private readonly COLLECTION_NAME = 'correction_pairs';

    constructor() {
        initFirebaseAdminApp();
        this.db = getFirestore();
    }

    async save(pair: CorrectionPair): Promise<void> {
        const docRef = this.db.collection(this.COLLECTION_NAME).doc(pair.id);
        await docRef.set(pair.toMap());
    }

    async findById(id: string): Promise<CorrectionPair | null> {
        const snap = await this.db.collection(this.COLLECTION_NAME).doc(id).get();
        if (!snap.exists) return null;
        return CorrectionPair.fromMap(snap.data());
    }

    async findByBudgetId(budgetId: string): Promise<CorrectionPair[]> {
        const snap = await this.db.collection(this.COLLECTION_NAME)
            .where('budgetId', '==', budgetId)
            .orderBy('corrected_at', 'desc')
            .get();
        return snap.docs.map(d => CorrectionPair.fromMap(d.data()));
    }

    /**
     * `count()` aggregation (Firestore Admin SDK >= 12). Si la versión no lo
     * soporta, hacemos fallback a un `get().size` (lectura completa). Cualquiera
     * de las dos es admin-SDK-only así que no incurrimos en facturación cliente.
     */
    async count(): Promise<number> {
        try {
            const aggSnap = await this.db.collection(this.COLLECTION_NAME).count().get();
            return aggSnap.data().count;
        } catch {
            // Fallback compat — solo se ejecuta si `count()` no está disponible.
            const snap = await this.db.collection(this.COLLECTION_NAME).get();
            return snap.size;
        }
    }

    async findAll(limit: number = 500): Promise<CorrectionPair[]> {
        const snap = await this.db.collection(this.COLLECTION_NAME)
            .orderBy('corrected_at', 'desc')
            .limit(limit)
            .get();
        return snap.docs.map(d => CorrectionPair.fromMap(d.data()));
    }
}

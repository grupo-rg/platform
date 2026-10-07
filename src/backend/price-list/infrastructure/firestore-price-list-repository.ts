import { adminFirestore } from '@/backend/shared/infrastructure/firebase/admin-app';
import { formatPriceListReference, nextPriceListSeq, type PriceList } from '../domain/price-list';
import type { PriceListRepository } from '../application/price-list-service';

const COUNTER_COLLECTION = 'counters';
const COUNTER_DOC = 'price_list_reference';

/**
 * Colección `price_lists` (admin SDK). La referencia `LP-YYYY-NNNN` se reserva
 * con una transacción sobre `counters/price_list_reference` (mismo patrón que
 * `budget-number-generator.ts`), reiniciando la secuencia cada año.
 */
export class FirestorePriceListRepository implements PriceListRepository {
    private get collection() {
        return adminFirestore.collection('price_lists');
    }

    newId(): string {
        return this.collection.doc().id;
    }

    async listAll(): Promise<PriceList[]> {
        const snap = await this.collection.get();
        return snap.docs.map((d) => ({ ...(d.data() as PriceList), id: d.id }));
    }

    async get(id: string): Promise<PriceList | null> {
        const snap = await this.collection.doc(id).get();
        return snap.exists ? ({ ...(snap.data() as PriceList), id: snap.id }) : null;
    }

    async save(list: PriceList): Promise<void> {
        // Firestore rechaza `undefined`; JSON round-trip los elimina (null se conserva).
        await this.collection.doc(list.id).set(JSON.parse(JSON.stringify(list)));
    }

    async delete(id: string): Promise<void> {
        await this.collection.doc(id).delete();
    }

    async nextReference(year: number): Promise<string> {
        const ref = adminFirestore.collection(COUNTER_COLLECTION).doc(COUNTER_DOC);
        const seq = await adminFirestore.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const next = nextPriceListSeq(snap.exists ? (snap.data() as any) : undefined, year);
            tx.set(ref, { year, lastSeq: next, updatedAt: new Date() }, { merge: true });
            return next;
        });
        return formatPriceListReference(year, seq);
    }
}

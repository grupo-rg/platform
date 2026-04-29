import 'server-only';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';
import type {
    ReEngagementScheduleEntry,
    ReEngagementScheduleRepository,
    ReEngagementAttempt,
} from '../domain/schedule-entry';

const COLLECTION = 'lead_re_engagement_schedule';

function toDate(value: any): Date {
    if (!value) return new Date();
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value === 'string' || typeof value === 'number') return new Date(value);
    return new Date();
}

export class FirestoreReEngagementScheduleRepository implements ReEngagementScheduleRepository {
    private get db() {
        initFirebaseAdminApp();
        return getFirestore();
    }

    private get collection() {
        const name = process.env.NEXT_PUBLIC_USE_TEST_DB === 'true'
            ? `test_${COLLECTION}`
            : COLLECTION;
        return this.db.collection(name);
    }

    async save(entry: ReEngagementScheduleEntry): Promise<void> {
        await this.collection.doc(entry.id).set({
            id: entry.id,
            leadId: entry.leadId,
            leadEmail: entry.leadEmail,
            leadName: entry.leadName,
            locale: entry.locale,
            attempt: entry.attempt,
            scheduledAt: Timestamp.fromDate(entry.scheduledAt),
            createdAt: Timestamp.fromDate(entry.createdAt),
            ...(entry.sentAt ? { sentAt: Timestamp.fromDate(entry.sentAt) } : {}),
            ...(entry.cancelledAt ? { cancelledAt: Timestamp.fromDate(entry.cancelledAt) } : {}),
            ...(entry.cancelledReason ? { cancelledReason: entry.cancelledReason } : {}),
        }, { merge: true });
    }

    async findById(id: string): Promise<ReEngagementScheduleEntry | null> {
        const doc = await this.collection.doc(id).get();
        if (!doc.exists) return null;
        return this.mapDoc(doc.data());
    }

    async findDue(now: Date, limit: number): Promise<ReEngagementScheduleEntry[]> {
        // Sólo filtramos por scheduledAt (un solo where ordenable). El filtro
        // de "sin sentAt y sin cancelledAt" se aplica en memoria — el volumen
        // esperado es bajo (decenas/día) y evita índice compuesto.
        const snapshot = await this.collection
            .where('scheduledAt', '<=', Timestamp.fromDate(now))
            .orderBy('scheduledAt', 'asc')
            .limit(limit * 3)
            .get();
        const entries = snapshot.docs.map(d => this.mapDoc(d.data()));
        return entries
            .filter(e => !e.sentAt && !e.cancelledAt)
            .slice(0, limit);
    }

    async cancelAllForLead(leadId: string, reason: string): Promise<number> {
        const snapshot = await this.collection.where('leadId', '==', leadId).get();
        const cancelledAt = Timestamp.fromDate(new Date());
        let count = 0;
        const batch = this.db.batch();
        for (const doc of snapshot.docs) {
            const data = doc.data();
            if (data.sentAt || data.cancelledAt) continue;
            batch.update(doc.ref, { cancelledAt, cancelledReason: reason });
            count++;
        }
        if (count > 0) await batch.commit();
        return count;
    }

    private mapDoc(data: any): ReEngagementScheduleEntry {
        return {
            id: data.id,
            leadId: data.leadId,
            leadEmail: data.leadEmail,
            leadName: data.leadName,
            locale: data.locale || 'es',
            attempt: (data.attempt as ReEngagementAttempt) || 1,
            scheduledAt: toDate(data.scheduledAt),
            sentAt: data.sentAt ? toDate(data.sentAt) : undefined,
            cancelledAt: data.cancelledAt ? toDate(data.cancelledAt) : undefined,
            cancelledReason: data.cancelledReason,
            createdAt: toDate(data.createdAt),
        };
    }
}

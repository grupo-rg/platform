import { SessionRepository, ABTestRepository } from '../domain/analytics-repository';
import { Session } from '../domain/session';
import { ABTest, Variant, ABTestMetric, ABTestStatus } from '../domain/ab-test';
import { PageView } from '../domain/page-view';
import { AnalyticsEvent, AnalyticsEventType } from '../domain/analytics-event';
import { getFirestore } from 'firebase-admin/firestore';

const db = () => getFirestore();

// ─── Session Repository ───

export class FirestoreSessionRepository implements SessionRepository {
    private collection = 'analytics_sessions';

    async save(session: Session): Promise<void> {
        await db().collection(this.collection).doc(session.id).set({
            fingerprint: session.fingerprint,
            startedAt: session.startedAt,
            lastActiveAt: session.lastActiveAt,
            pageViews: session.pageViews.map(pv => ({
                path: pv.path,
                referrer: pv.referrer,
                userAgent: pv.userAgent,
                locale: pv.locale,
                timestamp: pv.timestamp,
                ...(pv.variantId && { variantId: pv.variantId })
            })),
            events: session.events.map(ev => ({
                id: ev.id,
                sessionId: ev.sessionId,
                type: ev.type,
                metadata: ev.metadata,
                timestamp: ev.timestamp
            })),
            variantAssignments: session.variantAssignments,
            locale: session.locale,
            userAgent: session.userAgent,
            referrer: session.referrer
        }, { merge: true });
    }

    async findById(id: string): Promise<Session | null> {
        const doc = await db().collection(this.collection).doc(id).get();
        if (!doc.exists) return null;
        return this.toSession(doc.id, doc.data()!);
    }

    async findByFingerprint(fingerprint: string): Promise<Session | null> {
        const snap = await db().collection(this.collection)
            .where('fingerprint', '==', fingerprint)
            .orderBy('startedAt', 'desc')
            .limit(1)
            .get();

        if (snap.empty) return null;
        const doc = snap.docs[0];
        return this.toSession(doc.id, doc.data());
    }

    async findRecent(limit: number): Promise<Session[]> {
        const snap = await db().collection(this.collection)
            .orderBy('startedAt', 'desc')
            .limit(limit)
            .get();

        return snap.docs.map(doc => this.toSession(doc.id, doc.data()));
    }

    private toSession(id: string, data: any): Session {
        return new Session(
            id,
            data.fingerprint,
            data.startedAt?.toDate?.() ?? new Date(data.startedAt),
            data.lastActiveAt?.toDate?.() ?? new Date(data.lastActiveAt),
            (data.pageViews ?? []).map((pv: any) => ({
                path: pv.path,
                referrer: pv.referrer,
                userAgent: pv.userAgent,
                locale: pv.locale,
                timestamp: pv.timestamp?.toDate?.() ?? new Date(pv.timestamp),
                variantId: pv.variantId
            } as PageView)),
            (data.events ?? []).map((ev: any) => ({
                id: ev.id,
                sessionId: ev.sessionId,
                type: ev.type as AnalyticsEventType,
                metadata: ev.metadata,
                timestamp: ev.timestamp?.toDate?.() ?? new Date(ev.timestamp)
            } as AnalyticsEvent)),
            data.variantAssignments ?? {},
            data.locale ?? '',
            data.userAgent ?? '',
            data.referrer ?? null
        );
    }
}

// ─── ABTest Repository ───

export class FirestoreABTestRepository implements ABTestRepository {
    private collection = 'ab_tests';

    async save(test: ABTest): Promise<void> {
        await db().collection(this.collection).doc(test.id).set({
            name: test.name,
            hypothesis: test.hypothesis,
            variants: test.variants,
            status: test.status,
            metrics: test.metrics,
            startDate: test.startDate,
            endDate: test.endDate,
            requiredSampleSize: test.requiredSampleSize,
            createdAt: test.createdAt
        });
    }

    async findById(id: string): Promise<ABTest | null> {
        const doc = await db().collection(this.collection).doc(id).get();
        if (!doc.exists) return null;
        return this.toABTest(doc.id, doc.data()!);
    }

    async findActive(): Promise<ABTest[]> {
        const snap = await db().collection(this.collection)
            .where('status', '==', 'ACTIVE')
            .get();

        return snap.docs.map(doc => this.toABTest(doc.id, doc.data()));
    }

    private toABTest(id: string, data: any): ABTest {
        return new ABTest(
            id,
            data.name,
            data.hypothesis,
            data.variants as Variant[],
            data.status as ABTestStatus,
            data.metrics as ABTestMetric[],
            data.startDate?.toDate?.() ?? new Date(data.startDate),
            data.endDate ? (data.endDate.toDate?.() ?? new Date(data.endDate)) : null,
            data.requiredSampleSize,
            data.createdAt?.toDate?.() ?? new Date(data.createdAt)
        );
    }
}

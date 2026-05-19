import 'server-only';
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';
import {
    ContentBrief,
    ContentBriefRepository,
    ContentBriefStatus,
} from '../../domain/content-brief';
import { BlogLocale } from '../../domain/blog-post';

/**
 * Persistencia Firestore para `ContentBrief`. Colección `content_briefs` en
 * producción, `test_content_briefs` cuando NEXT_PUBLIC_USE_TEST_DB=true.
 *
 * No expone reglas cliente — solo escribe admin SDK desde el dashboard y
 * el agente. Firestore rules deben bloquearlo desde fuera (igual que
 * `blog_posts`).
 */
export class FirestoreContentBriefRepository implements ContentBriefRepository {
    private get collectionName() {
        return process.env.NEXT_PUBLIC_USE_TEST_DB === 'true' ? 'test_content_briefs' : 'content_briefs';
    }

    private get db() {
        initFirebaseAdminApp();
        return getFirestore();
    }

    private toDate(v: any): Date | undefined {
        if (!v) return undefined;
        if (v instanceof Date) return v;
        if (typeof v.toDate === 'function') return v.toDate();
        return new Date(v);
    }

    private rehydrate(data: any): ContentBrief {
        return {
            ...data,
            proposedPublishAt: this.toDate(data.proposedPublishAt),
            createdAt: this.toDate(data.createdAt) ?? new Date(),
            updatedAt: this.toDate(data.updatedAt) ?? new Date(),
        } as ContentBrief;
    }

    async save(brief: ContentBrief): Promise<void> {
        const data: Record<string, any> = { ...brief, updatedAt: new Date() };
        Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
        await this.db.collection(this.collectionName).doc(brief.id).set(data, { merge: true });
    }

    async saveBatch(briefs: ContentBrief[]): Promise<void> {
        const batch = this.db.batch();
        for (const brief of briefs) {
            const data: Record<string, any> = { ...brief, updatedAt: new Date() };
            Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
            const ref = this.db.collection(this.collectionName).doc(brief.id);
            batch.set(ref, data, { merge: true });
        }
        await batch.commit();
    }

    async findById(id: string): Promise<ContentBrief | null> {
        const snap = await this.db.collection(this.collectionName).doc(id).get();
        if (!snap.exists) return null;
        return this.rehydrate({ id: snap.id, ...snap.data() });
    }

    async listByPlan(planId: string): Promise<ContentBrief[]> {
        const snap = await this.db
            .collection(this.collectionName)
            .where('planId', '==', planId)
            .orderBy('proposedPublishAt', 'asc')
            .get();
        return snap.docs.map(d => this.rehydrate({ id: d.id, ...d.data() }));
    }

    async listByStatus(status: ContentBriefStatus, locale?: BlogLocale, limit = 50): Promise<ContentBrief[]> {
        let q: FirebaseFirestore.Query = this.db
            .collection(this.collectionName)
            .where('status', '==', status);
        if (locale) q = q.where('locale', '==', locale);
        q = q.orderBy('updatedAt', 'desc').limit(limit);
        const snap = await q.get();
        return snap.docs.map(d => this.rehydrate({ id: d.id, ...d.data() }));
    }

    async delete(id: string): Promise<void> {
        await this.db.collection(this.collectionName).doc(id).delete();
    }
}

import { getFirestore } from 'firebase-admin/firestore';
import { BlogPost, BlogPostRepository, BlogPostStatus, BlogLocale } from '../../domain/blog-post';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';

export class FirestoreBlogPostRepository implements BlogPostRepository {
    private get collectionName() {
        return process.env.NEXT_PUBLIC_USE_TEST_DB === 'true' ? 'test_blog_posts' : 'blog_posts';
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

    private rehydrate(data: any): BlogPost {
        return {
            ...data,
            publishAt: this.toDate(data.publishAt),
            publishedAt: this.toDate(data.publishedAt),
            createdAt: this.toDate(data.createdAt) ?? new Date(),
            updatedAt: this.toDate(data.updatedAt) ?? new Date(),
        } as BlogPost;
    }

    async save(post: BlogPost): Promise<void> {
        const data: Record<string, any> = { ...post, updatedAt: new Date() };
        // Firestore no acepta undefined
        Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
        await this.db.collection(this.collectionName).doc(post.id).set(data, { merge: true });
    }

    async findById(id: string): Promise<BlogPost | null> {
        const snap = await this.db.collection(this.collectionName).doc(id).get();
        if (!snap.exists) return null;
        return this.rehydrate({ id: snap.id, ...snap.data() });
    }

    async findBySlug(locale: BlogLocale, slug: string): Promise<BlogPost | null> {
        const snap = await this.db
            .collection(this.collectionName)
            .where('locale', '==', locale)
            .where('slug', '==', slug)
            .where('status', '==', 'published')
            .limit(1)
            .get();
        if (snap.empty) return null;
        const doc = snap.docs[0];
        return this.rehydrate({ id: doc.id, ...doc.data() });
    }

    async listByStatus(status: BlogPostStatus, limit = 50): Promise<BlogPost[]> {
        const snap = await this.db
            .collection(this.collectionName)
            .where('status', '==', status)
            .orderBy('updatedAt', 'desc')
            .limit(limit)
            .get();
        return snap.docs.map(d => this.rehydrate({ id: d.id, ...d.data() }));
    }

    async listPublished(locale: BlogLocale, limit = 20): Promise<BlogPost[]> {
        const snap = await this.db
            .collection(this.collectionName)
            .where('locale', '==', locale)
            .where('status', '==', 'published')
            .orderBy('publishedAt', 'desc')
            .limit(limit)
            .get();
        return snap.docs.map(d => this.rehydrate({ id: d.id, ...d.data() }));
    }

    async listScheduled(): Promise<BlogPost[]> {
        const snap = await this.db
            .collection(this.collectionName)
            .where('status', '==', 'scheduled')
            .orderBy('publishAt', 'asc')
            .get();
        return snap.docs.map(d => this.rehydrate({ id: d.id, ...d.data() }));
    }

    async delete(id: string): Promise<void> {
        await this.db.collection(this.collectionName).doc(id).delete();
    }
}

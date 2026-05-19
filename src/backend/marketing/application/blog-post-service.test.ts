/**
 * Smoke test del ciclo de vida draft → scheduled → published. Es la primera
 * red de seguridad del módulo SEO antes de meter el blog en producción.
 *
 * Cubre las transiciones críticas de estado, idempotencia mínima de la
 * publicación, y la guardarraíl de "no se puede programar en pasado".
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

// Vitest no entiende el guard `server-only` que Next.js inyecta en los módulos
// del bundle de servidor. Lo mockeamos a un módulo vacío para poder cargar el
// service en el entorno de test.
vi.mock('server-only', () => ({}));

import { BlogPostService } from './blog-post-service';
import type {
    BlogLocale,
    BlogPost,
    BlogPostRepository,
} from '../domain/blog-post';

class InMemoryBlogPostRepo implements BlogPostRepository {
    public store = new Map<string, BlogPost>();
    async save(post: BlogPost): Promise<void> { this.store.set(post.id, { ...post }); }
    async findById(id: string) { return this.store.get(id) ?? null; }
    async findBySlug(locale: BlogLocale, slug: string) {
        for (const p of this.store.values()) {
            if (p.locale === locale && p.slug === slug) return { ...p };
        }
        return null;
    }
    async listByStatus(status: BlogPost['status']) {
        return [...this.store.values()].filter(p => p.status === status);
    }
    async listScheduled() {
        return [...this.store.values()]
            .filter(p => p.status === 'scheduled')
            .sort((a, b) => (a.publishAt?.getTime() ?? 0) - (b.publishAt?.getTime() ?? 0));
    }
    async listPublished(locale: BlogLocale, limit?: number) {
        const all = [...this.store.values()]
            .filter(p => p.status === 'published' && p.locale === locale)
            .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
        return typeof limit === 'number' ? all.slice(0, limit) : all;
    }
    async delete(id: string) { this.store.delete(id); }
    async publishAtomically(id: string): Promise<BlogPost | null> {
        const post = this.store.get(id);
        if (!post) throw new Error(`BlogPost ${id} not found`);
        if (post.status === 'published') return null;
        const now = new Date();
        const updated: BlogPost = {
            ...post,
            status: 'published',
            publishedAt: now,
            updatedAt: now,
            failureReason: undefined,
        };
        this.store.set(id, updated);
        return { ...updated };
    }
}

describe('BlogPostService — state machine', () => {
    let repo: InMemoryBlogPostRepo;
    let svc: BlogPostService;

    beforeEach(() => {
        repo = new InMemoryBlogPostRepo();
        svc = new BlogPostService(repo);
    });

    it('crea un draft con defaults sensatos', async () => {
        const post = await svc.createDraft({
            locale: 'es',
            title: 'Cómo reformar una cocina en Mallorca',
            contentMarkdown: '# Hola',
        });
        expect(post.status).toBe('draft');
        expect(post.slug).toMatch(/como-reformar-una-cocina-en-mallorca/i);
        expect(post.metaTitle).toBe(post.title); // fallback al title
        expect(post.analytics).toEqual({ views: 0, readsTo80: 0 });
        expect(repo.store.size).toBe(1);
    });

    it('schedule rechaza fechas en pasado', async () => {
        const post = await svc.createDraft({
            locale: 'es', title: 'Test', contentMarkdown: '...',
        });
        await expect(svc.schedule(post.id, new Date(Date.now() - 60_000)))
            .rejects.toThrow(/futuro/);
    });

    it('schedule pasa draft → scheduled con publishAt', async () => {
        const post = await svc.createDraft({
            locale: 'es', title: 'Test', contentMarkdown: '...',
        });
        const future = new Date(Date.now() + 24 * 60 * 60_000);
        const scheduled = await svc.schedule(post.id, future);
        expect(scheduled.status).toBe('scheduled');
        expect(scheduled.publishAt?.getTime()).toBe(future.getTime());
    });

    it('publishNow pasa el post a published y marca publishedAt', async () => {
        const post = await svc.createDraft({
            locale: 'es', title: 'Test', contentMarkdown: '...',
        });
        const before = Date.now();
        const published = await svc.publishNow(post.id);
        expect(published.status).toBe('published');
        expect(published.publishedAt).toBeInstanceOf(Date);
        expect(published.publishedAt!.getTime()).toBeGreaterThanOrEqual(before);
        expect(published.failureReason).toBeUndefined();
    });

    it('publishNow es idempotente: reaplicarlo preserva publishedAt original (transacción)', async () => {
        const post = await svc.createDraft({
            locale: 'es', title: 'Test', contentMarkdown: '...',
        });
        const first = await svc.publishNow(post.id);
        // Esperamos 5ms reales para detectar si publishedAt se sobrescribió
        await new Promise(r => setTimeout(r, 5));
        const second = await svc.publishNow(post.id);
        expect(second.status).toBe('published');
        expect(second.id).toBe(first.id);
        // Tras la transacción atómica el segundo publish debería retornar el
        // doc tal y como estaba (publishedAt no se mueve). Sin atomicidad,
        // este test antes pasaba aunque publishedAt cambiase.
        expect(second.publishedAt!.getTime()).toBe(first.publishedAt!.getTime());
    });

    it('markFailed registra el motivo del fallo', async () => {
        const post = await svc.createDraft({
            locale: 'es', title: 'Test', contentMarkdown: '...',
        });
        const future = new Date(Date.now() + 60_000);
        await svc.schedule(post.id, future);
        const failed = await svc.markFailed(post.id, 'Cloud Task 500');
        expect(failed.status).toBe('failed');
        expect(failed.failureReason).toBe('Cloud Task 500');
    });

    it('listDrafts / listScheduled / listPublished devuelven filtrados', async () => {
        await svc.createDraft({ locale: 'es', title: 'A', contentMarkdown: '...' });
        const b = await svc.createDraft({ locale: 'es', title: 'B', contentMarkdown: '...' });
        await svc.schedule(b.id, new Date(Date.now() + 60_000));
        const c = await svc.createDraft({ locale: 'es', title: 'C', contentMarkdown: '...' });
        await svc.publishNow(c.id);

        expect((await svc.listDrafts()).length).toBe(1);
        expect((await svc.listScheduled()).length).toBe(1);
        expect((await svc.listPublishedAll('es')).length).toBe(1);
    });

    it('findBySlug encuentra por locale + slug', async () => {
        await svc.createDraft({
            locale: 'es', title: 'Reformas integrales en Palma',
            slug: 'reformas-integrales-palma', contentMarkdown: '...',
        });
        const found = await svc.findBySlug('es', 'reformas-integrales-palma');
        expect(found).not.toBeNull();
        expect(found!.title).toBe('Reformas integrales en Palma');

        const wrongLocale = await svc.findBySlug('en', 'reformas-integrales-palma');
        expect(wrongLocale).toBeNull();
    });
});

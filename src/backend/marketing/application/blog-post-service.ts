import 'server-only';
import { BlogPost, BlogPostRepository, BlogLocale, slugify } from '../domain/blog-post';
import { FirestoreBlogPostRepository } from '../infrastructure/persistence/firebase.blog-post.repository';

export class BlogPostService {
    private repo: BlogPostRepository;
    constructor(repo?: BlogPostRepository) {
        this.repo = repo ?? new FirestoreBlogPostRepository();
    }

    async createDraft(input: Partial<BlogPost> & { title: string; locale: BlogLocale; contentMarkdown: string }): Promise<BlogPost> {
        const id = input.id ?? `bp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const slug = input.slug ?? slugify(input.title);
        const now = new Date();
        const post: BlogPost = {
            id,
            slug,
            locale: input.locale,
            title: input.title,
            metaTitle: input.metaTitle ?? input.title,
            metaDescription: input.metaDescription ?? '',
            keywords: input.keywords ?? [],
            tags: input.tags ?? [],
            categoryId: input.categoryId,
            heroImageUrl: input.heroImageUrl,
            ogImageUrl: input.ogImageUrl,
            imageAltText: input.imageAltText,
            imageAttribution: input.imageAttribution,
            contentMarkdown: input.contentMarkdown,
            status: 'draft',
            authorId: input.authorId,
            seoScore: input.seoScore,
            analytics: { views: 0, readsTo80: 0 },
            createdAt: now,
            updatedAt: now,
        };
        await this.repo.save(post);
        return post;
    }

    async update(id: string, patch: Partial<BlogPost>): Promise<BlogPost> {
        const existing = await this.repo.findById(id);
        if (!existing) throw new Error(`BlogPost ${id} not found`);
        const merged: BlogPost = { ...existing, ...patch, id, updatedAt: new Date() };
        await this.repo.save(merged);
        return merged;
    }

    async schedule(id: string, publishAt: Date): Promise<BlogPost> {
        if (publishAt.getTime() <= Date.now()) {
            throw new Error('publishAt debe estar en el futuro');
        }
        return this.update(id, { status: 'scheduled', publishAt });
    }

    async publishNow(id: string): Promise<BlogPost> {
        // Transacción atómica: previene doble-publicación cuando el endpoint
        // de Cloud Task y el cron de rescate disparan a la vez. Si el post
        // ya estaba publicado, devolvemos el doc tal cual estaba.
        const published = await this.repo.publishAtomically(id);
        if (published) return published;
        const existing = await this.repo.findById(id);
        if (!existing) throw new Error(`BlogPost ${id} not found`);
        return existing;
    }

    async markFailed(id: string, reason: string): Promise<BlogPost> {
        return this.update(id, { status: 'failed', failureReason: reason });
    }

    async listDrafts() { return this.repo.listByStatus('draft'); }
    async listScheduled() { return this.repo.listScheduled(); }
    async listPublishedAll(locale: BlogLocale, limit?: number) { return this.repo.listPublished(locale, limit); }
    async findById(id: string) { return this.repo.findById(id); }
    async findBySlug(locale: BlogLocale, slug: string) { return this.repo.findBySlug(locale, slug); }
    async delete(id: string) { return this.repo.delete(id); }
}

export const blogPostService = new BlogPostService();

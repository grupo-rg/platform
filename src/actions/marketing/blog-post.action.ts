'use server';

import { blogPostService } from '@/backend/marketing/application/blog-post-service';
import { generateBlogPostFlow } from '@/backend/ai/private/flows/seo/generate-blog-post.flow';
import { BlogPost, BlogLocale } from '@/backend/marketing/domain/blog-post';
import { revalidatePath } from 'next/cache';

/** Genera un nuevo artículo con IA y lo guarda como draft. */
export async function generateAndSaveBlogPostAction(params: {
    keywords: string[];
    targetLocale: BlogLocale;
    tone?: 'profesional' | 'conversacional' | 'técnico' | 'inspirador';
    competitorUrls?: string[];
    targetWordCount?: number;
}): Promise<{ success: true; post: BlogPost } | { success: false; error: string }> {
    try {
        const generated = await generateBlogPostFlow({
            keywords: params.keywords,
            targetLocale: params.targetLocale,
            tone: params.tone,
            competitorUrls: params.competitorUrls,
            targetWordCount: params.targetWordCount ?? 900,
        });

        const post = await blogPostService.createDraft({
            locale: params.targetLocale,
            title: generated.title,
            slug: generated.slug,
            metaTitle: generated.metaTitle,
            metaDescription: generated.metaDescription,
            keywords: generated.keywords,
            tags: generated.tags,
            contentMarkdown: generated.contentMarkdown,
            seoScore: generated.seoScore,
        });

        revalidatePath('/dashboard/seo-generator');
        return { success: true, post };
    } catch (e: any) {
        console.error('[generateAndSaveBlogPostAction]', e);
        return { success: false, error: e?.message || 'Error generando el artículo' };
    }
}

export async function listBlogPostsAction(status: 'draft' | 'scheduled' | 'published' | 'failed', locale?: BlogLocale) {
    if (status === 'published' && locale) {
        return blogPostService.listPublishedAll(locale);
    }
    if (status === 'scheduled') return blogPostService.listScheduled();
    if (status === 'draft') return blogPostService.listDrafts();
    // failed
    const repo = new (await import('@/backend/marketing/infrastructure/persistence/firebase.blog-post.repository')).FirestoreBlogPostRepository();
    return repo.listByStatus('failed');
}

export async function updateBlogPostAction(id: string, patch: Partial<BlogPost>) {
    try {
        const post = await blogPostService.update(id, patch);
        revalidatePath('/dashboard/seo-generator');
        return { success: true as const, post };
    } catch (e: any) {
        return { success: false as const, error: e?.message };
    }
}

export async function deleteBlogPostAction(id: string) {
    try {
        await blogPostService.delete(id);
        revalidatePath('/dashboard/seo-generator');
        return { success: true as const };
    } catch (e: any) {
        return { success: false as const, error: e?.message };
    }
}

/** Programa un post para publicación automática. Encola una Cloud Task. */
export async function scheduleBlogPostAction(id: string, publishAt: Date) {
    try {
        const post = await blogPostService.schedule(id, publishAt);
        // Encolar task
        const { enqueueBlogPublishTask } = await import('@/backend/marketing/infrastructure/queue/blog-publish-queue');
        await enqueueBlogPublishTask({ postId: id, publishAt });
        revalidatePath('/dashboard/seo-generator');
        return { success: true as const, post };
    } catch (e: any) {
        console.error('[scheduleBlogPostAction]', e);
        return { success: false as const, error: e?.message };
    }
}

/** Publica inmediatamente un post (sin esperar a la Cloud Task). */
export async function publishBlogPostNowAction(id: string) {
    try {
        const post = await blogPostService.publishNow(id);
        revalidatePath('/dashboard/seo-generator');
        revalidatePath('/[locale]/blog', 'page');
        return { success: true as const, post };
    } catch (e: any) {
        return { success: false as const, error: e?.message };
    }
}

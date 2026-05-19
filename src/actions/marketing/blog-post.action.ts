'use server';

import { blogPostService } from '@/backend/marketing/application/blog-post-service';
import { generateBlogPostFlow } from '@/backend/ai/private/flows/seo/generate-blog-post.flow';
import { BlogPost, BlogLocale } from '@/backend/marketing/domain/blog-post';
import { verifyAuth } from '@/backend/auth/auth.middleware';
import { revalidatePath } from 'next/cache';

/**
 * Helper: corta el flujo si el usuario no es admin. Cualquier action que
 * mute estado del blog (crear, editar, programar, publicar, borrar) tiene
 * que llamar a esto antes de hacer nada.
 */
async function requireAdminOrFail(): Promise<{ ok: true } | { ok: false; error: string }> {
    const auth = await verifyAuth(true);
    if (!auth) return { ok: false, error: 'No autorizado: se requiere rol admin.' };
    return { ok: true };
}

/** Genera un nuevo artículo con IA y lo guarda como draft. */
export async function generateAndSaveBlogPostAction(params: {
    keywords: string[];
    targetLocale: BlogLocale;
    tone?: 'profesional' | 'conversacional' | 'técnico' | 'inspirador';
    competitorUrls?: string[];
    targetWordCount?: number;
}): Promise<{ success: true; post: BlogPost } | { success: false; error: string }> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };
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
            imageAltText: generated.imageAltText,
        });

        // Imagen cover — best effort. Si falla o no hay UNSPLASH_ACCESS_KEY,
        // dejamos el post sin imagen pero válido (la UI muestra placeholder).
        try {
            const { prepareBlogCoverImage } = await import(
                '@/backend/marketing/infrastructure/images/blog-image-service'
            );
            const query = (generated.imageQueryEN || params.keywords[0] || generated.title).trim();
            const prepared = await prepareBlogCoverImage(post.id, query, generated.title);
            if (prepared) {
                await blogPostService.update(post.id, {
                    heroImageUrl: prepared.url,
                    ogImageUrl: prepared.url,
                    // El alt del LLM suele ser más descriptivo del contexto;
                    // el de Unsplash es más visual. Preferimos el del LLM y
                    // caemos al de Unsplash si no vino.
                    imageAltText: generated.imageAltText || prepared.altText,
                    imageAttribution: prepared.attribution,
                });
                // Refrescamos el objeto para devolverlo con la imagen.
                const refreshed = await blogPostService.findById(post.id);
                if (refreshed) {
                    revalidatePath('/dashboard/seo-generator');
                    return { success: true, post: refreshed };
                }
            }
        } catch (imgErr: any) {
            console.warn('[generateAndSaveBlogPostAction] Imagen no asignada:', imgErr?.message);
        }

        revalidatePath('/dashboard/seo-generator');
        return { success: true, post };
    } catch (e: any) {
        console.error('[generateAndSaveBlogPostAction]', e);
        return { success: false, error: e?.message || 'Error generando el artículo' };
    }
}

export async function listBlogPostsAction(status: 'draft' | 'scheduled' | 'published' | 'failed', locale?: BlogLocale) {
    // El blog público no usa esta action — lee directo del repo (server-side
    // ya). Esta action solo la consume el dashboard admin, así que cerramos
    // con `requireAdmin`. Si dejásemos `listScheduled` abierto, cualquier
    // visitante del sitio podría enumerar lo que está a punto de publicarse.
    const guard = await requireAdminOrFail();
    if (!guard.ok) return [];

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
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false as const, error: guard.error };
    try {
        const post = await blogPostService.update(id, patch);
        revalidatePath('/dashboard/seo-generator');
        return { success: true as const, post };
    } catch (e: any) {
        return { success: false as const, error: e?.message };
    }
}

export async function deleteBlogPostAction(id: string) {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false as const, error: guard.error };
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
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false as const, error: guard.error };
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

/**
 * Reprograma un post ya scheduled a una fecha nueva. Update `publishAt` +
 * encolar nueva Cloud Task. La task antigua que pueda existir es ignorada
 * por el endpoint `/api/marketing/blog/publish` cuando ejecute, porque
 * compara `publishAt` actual del doc contra "ahora": si difiere mucho,
 * descarta el intento (la task vieja ya quedó obsoleta).
 *
 * No cancelamos la Cloud Task antigua de forma activa (requeriría guardar
 * el `taskName` al encolar y llamar `deleteTask`). En la práctica, la task
 * vieja simplemente fallará en seco contra el chequeo de obsolescencia.
 */
export async function rescheduleBlogPostAction(id: string, newPublishAt: Date) {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false as const, error: guard.error };
    try {
        if (newPublishAt.getTime() <= Date.now()) {
            return { success: false as const, error: 'La nueva fecha debe ser futura.' };
        }
        const post = await blogPostService.update(id, {
            status: 'scheduled',
            publishAt: newPublishAt,
            // Reset del contador de rescate: es una reprogramación deliberada.
            recoveryAttempts: 0,
            failureReason: undefined,
        });
        const { enqueueBlogPublishTask } = await import('@/backend/marketing/infrastructure/queue/blog-publish-queue');
        await enqueueBlogPublishTask({ postId: id, publishAt: newPublishAt });
        revalidatePath('/dashboard/seo-generator');
        return { success: true as const, post };
    } catch (e: any) {
        console.error('[rescheduleBlogPostAction]', e);
        return { success: false as const, error: e?.message };
    }
}

/**
 * Reintenta un post en estado `failed`: lo deja en `draft` para que el
 * editor pueda reprogramarlo, o lo programa de nuevo si se pasa `publishAt`.
 */
export async function retryFailedBlogPostAction(id: string, publishAt?: Date) {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false as const, error: guard.error };
    try {
        if (publishAt) {
            return rescheduleBlogPostAction(id, publishAt);
        }
        const post = await blogPostService.update(id, {
            status: 'draft',
            failureReason: undefined,
            recoveryAttempts: 0,
        });
        revalidatePath('/dashboard/seo-generator');
        return { success: true as const, post };
    } catch (e: any) {
        console.error('[retryFailedBlogPostAction]', e);
        return { success: false as const, error: e?.message };
    }
}

/** Publica inmediatamente un post (sin esperar a la Cloud Task). */
export async function publishBlogPostNowAction(id: string) {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false as const, error: guard.error };
    try {
        const post = await blogPostService.publishNow(id);
        revalidatePath('/dashboard/seo-generator');
        revalidatePath('/[locale]/blog', 'page');
        return { success: true as const, post };
    } catch (e: any) {
        return { success: false as const, error: e?.message };
    }
}

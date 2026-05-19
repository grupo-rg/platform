'use server';

/**
 * Server actions del flujo "Plan editorial agéntico":
 *
 *   generatePlan → llama al agente y persiste un batch de briefs como 'proposed'.
 *   listProposed  → para la UI del tab "Plan editorial".
 *   approveBrief  → marca el brief 'approved' y dispara la generación del post
 *                   + scheduling con la fecha sugerida.
 *   rejectBrief   → marca 'rejected' (queda en histórico, no se vuelve a proponer).
 *   regenerateBrief → relanza generación del post si la primera falló.
 */

import { revalidatePath } from 'next/cache';
import { verifyAuth } from '@/backend/auth/auth.middleware';
import { editorialPlannerFlow } from '@/backend/ai/private/flows/seo/editorial-planner.flow';
import { analyzeContentGaps } from '@/backend/marketing/application/content-gap-analyzer';
import { searchKeywordIdeas } from '@/backend/marketing/infrastructure/keyword-research/google-trends-provider';
import { FirestoreContentBriefRepository } from '@/backend/marketing/infrastructure/persistence/firebase.content-brief.repository';
import { generateAndSaveBlogPostAction } from './blog-post.action';
import { scheduleBlogPostAction } from './blog-post.action';
import type { ContentBrief } from '@/backend/marketing/domain/content-brief';
import type { BlogLocale } from '@/backend/marketing/domain/blog-post';

const briefRepo = new FirestoreContentBriefRepository();

async function requireAdminOrFail() {
    const auth = await verifyAuth(true);
    if (!auth) return { ok: false as const, error: 'No autorizado: requiere admin.' };
    return { ok: true as const };
}

export interface GeneratePlanInput {
    locale: BlogLocale;
    weeks: number;
    postsPerWeek: number;
    seedKeywords: string[];
}

/**
 * Orquesta: gaps + keyword research + agente planner + persist batch.
 * Devuelve los briefs propuestos para que la UI los muestre.
 */
export async function generateEditorialPlanAction(
    input: GeneratePlanInput,
): Promise<{ success: true; planId: string; briefs: ContentBrief[] } | { success: false; error: string }> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };

    try {
        // Paralelizamos: gaps + keyword research son independientes y caros.
        const { companyConfigService } = await import('@/backend/platform/application/company-config-service');
        const [gaps, keywordIdeas, company] = await Promise.all([
            analyzeContentGaps(input.locale),
            searchKeywordIdeas({
                seedKeywords: input.seedKeywords,
                locale: input.locale,
                perSeed: 8,
            }),
            companyConfigService.get(),
        ]);

        const planOutput = await editorialPlannerFlow({
            locale: input.locale,
            weeks: input.weeks,
            postsPerWeek: input.postsPerWeek,
            contentGaps: gaps.gaps,
            keywordIdeas: keywordIdeas.map(k => ({
                keyword: k.keyword,
                trendScore: k.trendScore,
                relatedQueries: k.relatedQueries,
            })),
            companyName: company.name || 'la empresa',
            targetRegion: 'Mallorca, Islas Baleares',
        });

        const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const now = new Date();
        const briefs: ContentBrief[] = planOutput.briefs.map((draft, idx) => ({
            id: `${planId}_${idx}`,
            planId,
            locale: input.locale,
            title: draft.title,
            angle: draft.angle,
            primaryKeyword: draft.primaryKeyword,
            secondaryKeywords: draft.secondaryKeywords,
            intent: draft.intent,
            proposedPublishAt: parseISOOrNull(draft.proposedPublishAt) ?? undefined,
            rationale: draft.rationale,
            relatedServicePath: draft.relatedServicePath,
            status: 'proposed',
            createdAt: now,
            updatedAt: now,
        }));

        await briefRepo.saveBatch(briefs);
        revalidatePath('/dashboard/seo-generator');
        return { success: true, planId, briefs };
    } catch (e: any) {
        console.error('[generateEditorialPlanAction]', e);
        return { success: false, error: e?.message || 'Error generando el plan editorial' };
    }
}

/** Lista los briefs propuestos pendientes de revisión (todos los locales). */
export async function listProposedBriefsAction(locale?: BlogLocale): Promise<ContentBrief[]> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return [];
    return briefRepo.listByStatus('proposed', locale, 100);
}

/** Devuelve los briefs de un plan específico para revisar en bloque. */
export async function listBriefsByPlanAction(planId: string): Promise<ContentBrief[]> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return [];
    return briefRepo.listByPlan(planId);
}

/**
 * Aprueba un brief: marca como 'generating' → genera el post → programa
 * publicación con la fecha sugerida → marca 'generated' con el postId.
 *
 * Si la generación falla deja el brief en 'proposed' con `adminNote` para
 * que el usuario pueda reintentar manualmente sin perder el contexto.
 */
export async function approveBriefAction(
    briefId: string,
): Promise<{ success: true; brief: ContentBrief; postId: string } | { success: false; error: string }> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };

    const brief = await briefRepo.findById(briefId);
    if (!brief) return { success: false, error: 'Brief no encontrado.' };
    if (brief.status !== 'proposed') {
        return { success: false, error: `El brief ya está en estado '${brief.status}', no se puede aprobar.` };
    }

    // Marcamos 'generating' antes de invocar al generador para evitar doble
    // aprobación accidental desde dos pestañas.
    await briefRepo.save({ ...brief, status: 'generating', updatedAt: new Date() });

    try {
        const keywords = [brief.primaryKeyword, ...brief.secondaryKeywords].filter(Boolean);
        const result = await generateAndSaveBlogPostAction({
            keywords,
            targetLocale: brief.locale,
            tone: 'profesional',
        });
        if (!result.success) {
            // Devolvemos a 'proposed' con nota del error para que el admin pueda
            // reintentar sin perder el contexto editorial.
            await briefRepo.save({
                ...brief,
                status: 'proposed',
                adminNote: `Generación falló: ${result.error}`,
                updatedAt: new Date(),
            });
            return { success: false, error: result.error };
        }

        const postId = result.post.id;

        // Programa publicación si proposedPublishAt es futura. Si no, queda
        // en draft (el admin puede publicarlo manualmente).
        if (brief.proposedPublishAt && brief.proposedPublishAt.getTime() > Date.now()) {
            await scheduleBlogPostAction(postId, brief.proposedPublishAt);
        }

        const updated: ContentBrief = {
            ...brief,
            status: 'generated',
            generatedPostId: postId,
            updatedAt: new Date(),
        };
        await briefRepo.save(updated);
        revalidatePath('/dashboard/seo-generator');
        return { success: true, brief: updated, postId };
    } catch (e: any) {
        await briefRepo.save({
            ...brief,
            status: 'proposed',
            adminNote: `Error inesperado: ${e?.message}`,
            updatedAt: new Date(),
        });
        return { success: false, error: e?.message || 'Error generando el post desde el brief.' };
    }
}

/** Rechaza un brief: queda en histórico como 'rejected'. */
export async function rejectBriefAction(briefId: string, note?: string) {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false as const, error: guard.error };

    const brief = await briefRepo.findById(briefId);
    if (!brief) return { success: false as const, error: 'Brief no encontrado.' };
    await briefRepo.save({
        ...brief,
        status: 'rejected',
        adminNote: note,
        updatedAt: new Date(),
    });
    revalidatePath('/dashboard/seo-generator');
    return { success: true as const };
}

export async function deleteBriefAction(briefId: string) {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false as const, error: guard.error };
    await briefRepo.delete(briefId);
    revalidatePath('/dashboard/seo-generator');
    return { success: true as const };
}

function parseISOOrNull(iso: string | undefined): Date | null {
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
}

import 'server-only';
import { services } from '@/lib/services';
import { FirestoreBlogPostRepository } from '../infrastructure/persistence/firebase.blog-post.repository';
import type { BlogLocale, BlogPost } from '../domain/blog-post';

/**
 * Analiza qué servicios del catálogo (`src/lib/services.tsx`) NO están
 * cubiertos por ningún post del blog. La idea: el agente editorial usa
 * estos huecos para priorizar qué generar primero (criterio "no debería
 * haber un servicio que ofrezcamos sin un artículo SEO que lo explique").
 *
 * Matching heurístico: un servicio se considera "cubierto" si CUALQUIER
 * post tiene en sus keywords/slug/título alguna de las palabras del
 * subservice id (ignorando stopwords).
 */

export interface ContentGap {
    /** Path canónico, ej: 'construccion-y-reformas/gestion-integral-obra-nueva'. */
    path: string;
    categoryId: string;
    subserviceId: string;
    /** Palabras clave derivadas del id que el agente puede usar para investigar. */
    seedKeywords: string[];
}

export interface ContentCoverage {
    totalServices: number;
    coveredServices: number;
    gaps: ContentGap[];
    /** Posts existentes mapeados a la(s) categoría(s) que tocan. */
    coverageMap: Record<string, string[]>; // serviceId → [postId, ...]
}

const STOPWORDS = new Set([
    'de', 'la', 'el', 'y', 'en', 'a', 'por', 'para', 'los', 'las', 'un', 'una',
    'con', 'sin', 'al', 'del', 'lo', 'su', 'sus', 'o', 'u',
]);

export async function analyzeContentGaps(locale: BlogLocale = 'es'): Promise<ContentCoverage> {
    const repo = new FirestoreBlogPostRepository();
    // Tomamos published + scheduled como cobertura "activa". Drafts no cuentan
    // (pueden ser desechados).
    const [published, scheduled] = await Promise.all([
        repo.listPublished(locale, 200),
        repo.listScheduled(),
    ]);
    const allPosts = [...published, ...scheduled.filter(p => p.locale === locale)];

    const flatServices: ContentGap[] = [];
    for (const cat of services) {
        for (const sub of cat.subservices || []) {
            const subId = (sub as any).id || '';
            if (!subId) continue;
            flatServices.push({
                path: `${cat.id}/${subId}`,
                categoryId: cat.id,
                subserviceId: subId,
                seedKeywords: extractKeywords(subId),
            });
        }
    }

    const coverageMap: Record<string, string[]> = {};
    const gaps: ContentGap[] = [];

    for (const svc of flatServices) {
        const matchedPosts = allPosts.filter(p => postCoversService(p, svc));
        if (matchedPosts.length > 0) {
            coverageMap[svc.path] = matchedPosts.map(p => p.id);
        } else {
            gaps.push(svc);
        }
    }

    return {
        totalServices: flatServices.length,
        coveredServices: flatServices.length - gaps.length,
        gaps,
        coverageMap,
    };
}

function extractKeywords(slug: string): string[] {
    return slug
        .split(/[-_]/)
        .filter(w => w && !STOPWORDS.has(w.toLowerCase()))
        .map(w => w.toLowerCase());
}

function postCoversService(post: BlogPost, service: ContentGap): boolean {
    const hay = [
        post.title,
        post.slug,
        ...(post.keywords || []),
        ...(post.tags || []),
    ].join(' ').toLowerCase();

    // Heurística: el post debe contener al menos 2 de las keywords del slug
    // del servicio. Con 1 keyword había demasiados falsos positivos
    // (ej. "reformas" mata a casi todo).
    if (service.seedKeywords.length === 0) return false;
    if (service.seedKeywords.length === 1) {
        return hay.includes(service.seedKeywords[0]);
    }
    const hits = service.seedKeywords.filter(k => hay.includes(k)).length;
    return hits >= 2;
}

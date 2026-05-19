import 'server-only';
import type { KeywordIdea } from '../../domain/content-brief';

/**
 * Provider de keyword research basado en `google-trends-api`. Esta librería
 * raspa el HTML público de Google Trends — funciona pero rompe
 * ocasionalmente cuando Google cambia su markup. Capturamos errores y
 * devolvemos array vacío para que el agente caiga a sus propias keywords
 * sin romper la planificación.
 *
 * Limitaciones conscientes (v1):
 *   - No devuelve volumen absoluto (Google Trends da "popularidad
 *     relativa" 0-100).
 *   - Cuotas limitadas: si llamamos rápido seguido, Google empieza a
 *     devolver respuestas vacías. Hacemos serie con pausa entre llamadas.
 *
 * Si llegamos a escalar y esto rompe demasiado, mover a SerpAPI (50
 * búsquedas/mes free) sustituyendo solo este archivo — el interfaz
 * `searchKeywordIdeas` no cambia.
 */

// google-trends-api no tiene types
// eslint-disable-next-line @typescript-eslint/no-var-requires
const trends = require('google-trends-api') as {
    interestOverTime: (opts: any) => Promise<string>;
    relatedQueries: (opts: any) => Promise<string>;
};

const REGION_BY_LOCALE: Record<string, string> = {
    es: 'ES',
    en: 'GB',
    ca: 'ES',
    de: 'DE',
    nl: 'NL',
};

export interface KeywordSearchOptions {
    seedKeywords: string[];
    locale: string;
    /** Cuántas ideas relacionadas devolver por seed. */
    perSeed?: number;
}

/**
 * Busca ideas de keywords a partir de varias semillas. Por cada semilla:
 *   1. Llama a `relatedQueries` y extrae las "top" y "rising".
 *   2. Llama a `interestOverTime` (últimos 30 días) y promedia la
 *      popularidad como `trendScore`.
 *
 * Devuelve hasta `seedKeywords.length * perSeed` ideas (deduplicadas).
 */
export async function searchKeywordIdeas(
    options: KeywordSearchOptions,
): Promise<KeywordIdea[]> {
    const geo = REGION_BY_LOCALE[options.locale] || 'ES';
    const perSeed = options.perSeed ?? 8;
    const startTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const ideas: KeywordIdea[] = [];
    const seen = new Set<string>();

    for (const seed of options.seedKeywords) {
        try {
            const related = await fetchRelated(seed, geo, perSeed);
            const score = await fetchTrendScore(seed, geo, startTime);

            for (const k of [seed, ...related]) {
                const norm = k.toLowerCase().trim();
                if (!norm || seen.has(norm)) continue;
                seen.add(norm);
                ideas.push({
                    keyword: k,
                    trendScore: k === seed ? score : undefined,
                    relatedQueries: k === seed ? related : [],
                    source: 'google-trends',
                });
            }
        } catch (e: any) {
            console.warn('[GoogleTrends] seed falló:', seed, e?.message);
            // No devolvemos throw — el agente sigue con las semillas que
            // hayan funcionado.
        }

        // Pausa pequeña para no disparar rate limiting de Google Trends.
        await new Promise(r => setTimeout(r, 300));
    }

    return ideas;
}

async function fetchRelated(keyword: string, geo: string, limit: number): Promise<string[]> {
    const raw = await trends.relatedQueries({ keyword, geo });
    try {
        const parsed = JSON.parse(raw);
        const top = parsed?.default?.rankedList?.[0]?.rankedKeyword || [];
        const rising = parsed?.default?.rankedList?.[1]?.rankedKeyword || [];
        const all = [...top, ...rising]
            .map((k: any) => String(k.query || '').trim())
            .filter(Boolean);
        // Dedupe + corte al límite
        return Array.from(new Set(all)).slice(0, limit);
    } catch {
        return [];
    }
}

async function fetchTrendScore(keyword: string, geo: string, startTime: Date): Promise<number | undefined> {
    const raw = await trends.interestOverTime({ keyword, geo, startTime });
    try {
        const parsed = JSON.parse(raw);
        const points: any[] = parsed?.default?.timelineData || [];
        if (points.length === 0) return undefined;
        const sum = points.reduce((acc, p) => acc + (p?.value?.[0] ?? 0), 0);
        return Math.round(sum / points.length);
    } catch {
        return undefined;
    }
}

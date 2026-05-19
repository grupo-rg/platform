import 'server-only';

/**
 * Cliente mínimo de Unsplash. Usado por `BlogImageService` para escoger una
 * imagen cover por keywords. No depende de ningún SDK oficial (no hace falta
 * para una búsqueda simple) — solo `fetch` y `UNSPLASH_ACCESS_KEY`.
 *
 * Plan gratuito: 50 requests/hora. Para nuestro caso (1 imagen por post,
 * y posts generados manualmente) es más que suficiente. Si llegamos a tasas
 * mayores con la generación batch (F3), añadiremos cache de Storage por
 * (keyword, locale) para reutilizar la misma imagen entre posts similares.
 */

export interface UnsplashPhoto {
    id: string;
    description: string | null;
    altDescription: string | null;
    width: number;
    height: number;
    /** URL "regular" (~1080px ancho). La más adecuada para hero de blog. */
    urlRegular: string;
    /** Atribución obligatoria por términos de Unsplash. */
    photographerName: string;
    photographerUrl: string;
}

export interface UnsplashSearchOptions {
    query: string;
    /** Orientación preferida. 'landscape' para hero/cover. */
    orientation?: 'landscape' | 'portrait' | 'squarish';
    /** Resultados por página (Unsplash hard cap = 30). */
    perPage?: number;
    /** Locale del usuario, se usa solo para tunear el query si no viene en
     * inglés (Unsplash indexa en inglés). */
    locale?: string;
}

const UNSPLASH_API = 'https://api.unsplash.com';

/**
 * Busca fotos en Unsplash. Si no hay `UNSPLASH_ACCESS_KEY` configurada,
 * devuelve `null` (el caller debe tener fallback: dejar `heroImageUrl`
 * vacío y que el post se publique sin imagen).
 */
export async function searchUnsplash(
    options: UnsplashSearchOptions,
): Promise<UnsplashPhoto[] | null> {
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) {
        console.warn('[Unsplash] UNSPLASH_ACCESS_KEY no configurada. Saltando búsqueda de imagen.');
        return null;
    }

    const params = new URLSearchParams({
        query: options.query,
        per_page: String(options.perPage ?? 5),
        orientation: options.orientation ?? 'landscape',
    });

    try {
        const res = await fetch(`${UNSPLASH_API}/search/photos?${params.toString()}`, {
            headers: {
                'Accept-Version': 'v1',
                Authorization: `Client-ID ${accessKey}`,
            },
            // Unsplash recomienda no cachear agresivamente queries; el caller
            // ya hace caching propio en Storage si necesita.
            cache: 'no-store',
        });
        if (!res.ok) {
            console.error(`[Unsplash] ${res.status} ${await res.text().catch(() => '')}`);
            return null;
        }
        const data = await res.json();
        return (data.results || []).map((r: any): UnsplashPhoto => ({
            id: r.id,
            description: r.description,
            altDescription: r.alt_description,
            width: r.width,
            height: r.height,
            urlRegular: r.urls.regular,
            photographerName: r.user.name,
            photographerUrl: r.user.links?.html,
        }));
    } catch (e: any) {
        console.error('[Unsplash] búsqueda falló', e?.message);
        return null;
    }
}

/**
 * Notifica a Unsplash que una imagen fue "descargada" para fines de uso
 * (lo exigen sus ToS aunque la descarga real la hagas tú). Esto es un
 * fire-and-forget — no bloqueamos publish si falla.
 */
export async function pingUnsplashDownload(photoId: string): Promise<void> {
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) return;
    try {
        await fetch(`${UNSPLASH_API}/photos/${photoId}/download`, {
            headers: { Authorization: `Client-ID ${accessKey}` },
            cache: 'no-store',
        });
    } catch {
        // Best-effort, no rompemos publish.
    }
}

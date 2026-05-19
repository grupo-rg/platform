import 'server-only';
import { adminStorage } from '@/backend/shared/infrastructure/firebase/admin-app';
import { searchUnsplash, pingUnsplashDownload, type UnsplashPhoto } from './unsplash-provider';

/**
 * Servicio responsable de elegir + descargar + persistir la imagen cover de
 * un blog post. Reglas de negocio:
 *
 *  - Si no hay `UNSPLASH_ACCESS_KEY`, devuelve null (el caller debe publicar
 *    el post igualmente, sin hero image).
 *  - Si Unsplash no encuentra nada, devuelve null igual.
 *  - Subida a Firebase Storage en path determinista `blog-images/{postId}/cover.jpg`.
 *  - Se hace `makePublic()` para que la URL sea cacheable por CDN y aparezca
 *    en OG/Twitter cards sin firmar.
 *  - Atribución del fotógrafo: la guardamos junto al post (caller decide
 *    si la renderiza al pie del artículo o no).
 */

export interface PreparedBlogImage {
    /** URL pública servida desde `storage.googleapis.com`. */
    url: string;
    /** Texto alt sugerido (heurístico: alt_description de Unsplash o título). */
    altText: string;
    /** Datos de atribución requeridos por Unsplash ToS. */
    attribution: {
        photographerName: string;
        photographerUrl: string;
        source: 'unsplash';
        sourceId: string;
    };
}

const STORAGE_PREFIX = 'blog-images';

/**
 * Busca, descarga y persiste la imagen cover para un post.
 *
 * @param postId id del post (determina el path en Storage)
 * @param query query semántica para Unsplash (suele ser keyword principal + 'construction' / 'home renovation')
 * @param fallbackAlt texto alternativo si Unsplash no devuelve descripción (típicamente, el título del post)
 */
export async function prepareBlogCoverImage(
    postId: string,
    query: string,
    fallbackAlt: string,
): Promise<PreparedBlogImage | null> {
    const photos = await searchUnsplash({ query, orientation: 'landscape', perPage: 5 });
    if (!photos || photos.length === 0) return null;

    // Heurística simple: nos quedamos con la primera (Unsplash ya ordena por
    // relevancia). En el futuro podríamos puntuar por aspect ratio o tamaño.
    const chosen = photos[0];

    let publicUrl: string;
    try {
        publicUrl = await downloadAndStorePhoto(chosen, postId);
    } catch (e: any) {
        console.error('[BlogImageService] fallo al persistir la imagen', e?.message);
        return null;
    }

    // Notifica a Unsplash que descargamos la foto (ToS). Fire-and-forget.
    pingUnsplashDownload(chosen.id);

    return {
        url: publicUrl,
        altText: chosen.altDescription || chosen.description || fallbackAlt,
        attribution: {
            photographerName: chosen.photographerName,
            photographerUrl: chosen.photographerUrl,
            source: 'unsplash',
            sourceId: chosen.id,
        },
    };
}

async function downloadAndStorePhoto(photo: UnsplashPhoto, postId: string): Promise<string> {
    const res = await fetch(photo.urlRegular, { cache: 'no-store' });
    if (!res.ok) {
        throw new Error(`Descarga de Unsplash falló (${res.status})`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());

    const bucket = adminStorage.bucket();
    const filePath = `${STORAGE_PREFIX}/${postId}/cover.jpg`;
    const file = bucket.file(filePath);

    await file.save(buffer, {
        contentType: 'image/jpeg',
        metadata: {
            // Marcado para que un futuro lifecycle rule pueda limpiar imágenes
            // huérfanas de posts borrados sin afectar otras subidas.
            metadata: {
                source: 'unsplash',
                unsplashId: photo.id,
                postId,
            },
            // Cache largo: la imagen no cambia tras subir.
            cacheControl: 'public, max-age=31536000, immutable',
        },
        resumable: false,
    });

    // makePublic deja ACL público; URL estándar:
    //   https://storage.googleapis.com/{bucket}/{path}
    await file.makePublic();
    return `https://storage.googleapis.com/${bucket.name}/${filePath}`;
}

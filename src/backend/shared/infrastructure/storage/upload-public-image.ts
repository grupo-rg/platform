import 'server-only';
import { adminStorage } from '@/backend/shared/infrastructure/firebase/admin-app';
import { randomUUID } from 'crypto';

/**
 * Sube un buffer arbitrario al bucket en la ruta dada y devuelve una URL
 * estable (pública si el bucket lo permite, o firmada como fallback).
 *
 * Se usa para imágenes (`public_uploads/...`) y para PDFs internos
 * (`budgets/...`). El folder se concatena tal cual; el caller controla
 * el prefijo de privacidad.
 */
export async function uploadBuffer(
    buffer: Buffer,
    objectPath: string,
    contentType: string
): Promise<string> {
    const fileRef = adminStorage.bucket().file(objectPath);
    await fileRef.save(buffer, { metadata: { contentType } });

    try {
        await fileRef.makePublic();
        return `https://storage.googleapis.com/${adminStorage.bucket().name}/${objectPath}`;
    } catch {
        const [signedUrl] = await fileRef.getSignedUrl({ action: 'read', expires: '01-01-2099' });
        return signedUrl;
    }
}

/**
 * Sube una imagen base64 al bucket bajo `public_uploads/{folder}/{uuid}.{ext}`
 * y devuelve una URL estable (pública si el bucket lo permite, o URL firmada).
 */
export async function uploadBase64Image(
    base64: string,
    folder: string,
    mimeTypeHint?: string
): Promise<string> {
    const cleaned = base64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleaned, 'base64');

    const mime = mimeTypeHint || (cleaned.startsWith('/9j/') ? 'image/jpeg' : 'image/png');
    const ext = mime.split('/')[1] || 'bin';

    const objectPath = `public_uploads/${folder}/${randomUUID()}.${ext}`;
    return uploadBuffer(buffer, objectPath, mime);
}

/**
 * Normaliza una lista mixta de URLs (ya subidas) y base64 strings:
 * - Las URLs (http/https) se devuelven tal cual.
 * - Las base64 se suben al bucket y se devuelve la URL resultante.
 *
 * Falla "graceful": si una imagen no se puede subir, se descarta y se loguea.
 */
export async function normalizeToPublicUrls(
    items: string[],
    folder: string
): Promise<string[]> {
    const out: string[] = [];
    for (const item of items) {
        if (!item) continue;
        if (item.startsWith('http://') || item.startsWith('https://')) {
            out.push(item);
            continue;
        }
        try {
            const url = await uploadBase64Image(item, folder);
            out.push(url);
        } catch (err) {
            console.error(`[normalizeToPublicUrls] Falló upload en folder=${folder}:`, err);
        }
    }
    return out;
}

import 'server-only';
import { randomUUID } from 'crypto';
import { adminStorage } from '@/backend/shared/infrastructure/firebase/admin-app';
import {
    LEAD_UPLOAD_PREFIX,
    MAX_IMAGE_OR_PDF_BYTES,
    MAX_VIDEO_BYTES,
    buildLeadUploadRef,
    isHttpUrl,
    parseLeadUploadRef,
    sanitizeOwnerKey,
    sniffFileType,
    type SniffedType,
} from './lead-upload-ref';

/**
 * Almacenamiento PRIVADO de adjuntos de leads (ver lead-upload-ref.ts).
 *
 *  - Ruta: `lead_uploads/{leadId|sessionId}/{uuid}.{ext}` (sin email en la ruta).
 *  - Nunca `makePublic`. Lectura sólo vía URL firmada generada en servidor.
 *  - `storage.rules` bloquea cualquier acceso cliente a `lead_uploads/`.
 */

export interface StoredLeadUpload {
    ref: string;
    type: SniffedType;
}

export async function storeLeadUploadBuffer(
    buffer: Buffer,
    owner: string,
    opts: { allowVideo?: boolean; allowPdf?: boolean } = {}
): Promise<StoredLeadUpload> {
    const type = sniffFileType(buffer);
    if (!type) throw new Error('Tipo de archivo no permitido');
    if (type.kind === 'video' && !opts.allowVideo) throw new Error('Vídeo no permitido');
    if (type.kind === 'pdf' && !opts.allowPdf) throw new Error('PDF no permitido');
    const max = type.kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_OR_PDF_BYTES;
    if (buffer.length > max) throw new Error('Archivo demasiado grande');

    const bucket = adminStorage.bucket();
    const objectPath = `${LEAD_UPLOAD_PREFIX}${sanitizeOwnerKey(owner)}/${randomUUID()}.${type.ext}`;
    await bucket.file(objectPath).save(buffer, {
        resumable: false,
        metadata: {
            contentType: type.mime,
            // Evita que un navegador interprete el contenido si alguien consigue la URL firmada.
            contentDisposition: 'inline',
            cacheControl: 'private, max-age=0',
        },
    });
    return { ref: buildLeadUploadRef(bucket.name, objectPath), type };
}

/**
 * Normaliza adjuntos recibidos de un flujo público:
 *  - base64 (con o sin prefijo data:) → se sube a `lead_uploads/{owner}/…`.
 *  - referencia `gs://<bucket>/lead_uploads/…` del propio bucket (devuelta
 *    por `uploadLeadAttachmentAction`) → se acepta tal cual.
 *  - URLs http(s) arbitrarias → SE RECHAZAN (antes se guardaban tal cual:
 *    un visitante podía inyectar cualquier URL como "foto" del intake).
 */
export async function normalizeLeadAttachments(
    items: string[],
    owner: string,
    opts: { allowVideo?: boolean; allowPdf?: boolean; max?: number } = {}
): Promise<string[]> {
    const out: string[] = [];
    const bucketName = adminStorage.bucket().name;
    const max = opts.max ?? 10;
    for (const item of (items || []).slice(0, max)) {
        if (!item || typeof item !== 'string') continue;
        if (item.startsWith('gs://')) {
            const parsed = parseLeadUploadRef(item);
            if (parsed && parsed.bucket === bucketName) out.push(item);
            else console.warn('[lead-uploads] Referencia gs:// rechazada (fuera de lead_uploads o de otro bucket).');
            continue;
        }
        if (isHttpUrl(item)) {
            console.warn('[lead-uploads] URL http(s) enviada por el cliente rechazada como adjunto.');
            continue;
        }
        try {
            const cleaned = item.replace(/^data:[^;]+;base64,/, '');
            const buffer = Buffer.from(cleaned, 'base64');
            const stored = await storeLeadUploadBuffer(buffer, owner, opts);
            out.push(stored.ref);
        } catch (err: any) {
            console.error('[lead-uploads] Adjunto descartado:', err?.message || err);
        }
    }
    return out;
}

/**
 * Convierte referencias privadas en URLs firmadas de corta duración para el
 * panel. Las URLs antiguas (públicas) se devuelven sin cambios.
 */
export async function resolveLeadAssetUrls(urls: string[] | undefined | null, ttlMinutes: number = 60): Promise<string[]> {
    if (!urls || urls.length === 0) return [];
    const bucket = adminStorage.bucket();
    return Promise.all(
        urls.map(async url => {
            const parsed = parseLeadUploadRef(url);
            if (!parsed || parsed.bucket !== bucket.name) return url;
            try {
                const [signed] = await bucket.file(parsed.objectPath).getSignedUrl({
                    version: 'v4',
                    action: 'read',
                    expires: Date.now() + ttlMinutes * 60_000,
                });
                return signed;
            } catch (err) {
                console.error('[lead-uploads] No se pudo firmar URL:', err);
                return '';
            }
        })
    ).then(list => list.filter(Boolean));
}

export async function resolveLeadAssetUrl(url: string, ttlMinutes: number = 60): Promise<string> {
    const [resolved] = await resolveLeadAssetUrls([url], ttlMinutes);
    return resolved || '';
}

'use server';

import { storeLeadUploadBuffer, resolveLeadAssetUrl } from '@/backend/lead/infrastructure/lead-uploads';
import { getLeadSession } from '@/backend/lead/infrastructure/lead-session';
import { checkRateLimit, RATE_LIMITS } from '@/backend/shared/security/rate-limiter';
import { getClientIp } from '@/backend/shared/security/client-identity';
import { MAX_VIDEO_BYTES } from '@/backend/lead/infrastructure/lead-upload-ref';

const UUID_RE = /^[a-f0-9-]{36}$/i;

/**
 * Sube un adjunto (foto / plano / vídeo corto) desde un formulario público a
 * almacenamiento PRIVADO (`lead_uploads/{leadId|sessionId}/{uuid}.ext`).
 *
 * Sustituye a la subida directa desde el navegador a `public_uploads/` (que
 * dejaba los ficheros públicos). Devuelve:
 *  - `ref`: referencia opaca `gs://…` que el formulario envía en `files`.
 *  - `previewUrl`: URL firmada (15 min) sólo para la miniatura del formulario.
 */
export async function uploadLeadAttachmentAction(formData: FormData): Promise<{
    success: boolean;
    ref?: string;
    previewUrl?: string;
    kind?: 'image' | 'pdf' | 'video';
    error?: string;
}> {
    try {
        const ip = await getClientIp();
        const rl = await checkRateLimit('leadUploadIp', ip, RATE_LIMITS.leadUploadIp);
        if (!rl.allowed) {
            return { success: false, error: 'Has subido demasiados archivos. Inténtalo más tarde.' };
        }

        const file = formData.get('file');
        if (!file || typeof file === 'string') return { success: false, error: 'Archivo no recibido' };
        const blob = file as File;
        if (blob.size <= 0 || blob.size > MAX_VIDEO_BYTES) {
            return { success: false, error: 'Archivo vacío o demasiado grande' };
        }

        const session = await getLeadSession();
        const rawSession = String(formData.get('uploadSessionId') || '');
        const owner = session?.leadId || (UUID_RE.test(rawSession) ? `s-${rawSession}` : 'anon');

        const buffer = Buffer.from(await blob.arrayBuffer());
        const stored = await storeLeadUploadBuffer(buffer, owner, { allowPdf: true, allowVideo: true });
        const previewUrl = stored.type.kind === 'image' ? await resolveLeadAssetUrl(stored.ref, 15) : undefined;

        return { success: true, ref: stored.ref, previewUrl, kind: stored.type.kind };
    } catch (error: any) {
        console.error('[uploadLeadAttachmentAction] Error:', error?.message || error);
        return { success: false, error: 'No se pudo subir el archivo (tipos permitidos: imagen, PDF o vídeo; máx. 10 MB, vídeo 50 MB).' };
    }
}

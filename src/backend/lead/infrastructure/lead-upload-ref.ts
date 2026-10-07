/**
 * Helpers puros (testables) para adjuntos privados de leads.
 *
 * Los adjuntos nuevos (fotos/planos de formularios públicos y del chat) se
 * guardan en `lead_uploads/{owner}/{uuid}.{ext}` SIN `makePublic` y se
 * referencian como `gs://{bucket}/lead_uploads/...`. Para mostrarlos en el
 * panel el servidor genera una URL firmada de corta duración
 * (`resolveLeadAssetUrls`).
 *
 * Las URLs antiguas (`https://storage.googleapis.com/.../public_uploads/...`
 * o URLs de descarga de Firebase) siguen funcionando: se devuelven tal cual.
 */

export const LEAD_UPLOAD_PREFIX = 'lead_uploads/';

/** Caracteres permitidos en el segmento owner (leadId / sessionId). */
export function sanitizeOwnerKey(owner: string | undefined | null): string {
    const cleaned = String(owner || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    return cleaned || 'anon';
}

const REF_RE = /^gs:\/\/([a-z0-9._-]+)\/(lead_uploads\/[a-zA-Z0-9_-]{1,64}\/[a-f0-9-]{36}\.[a-z0-9]{2,5})$/;

export function buildLeadUploadRef(bucket: string, objectPath: string): string {
    return `gs://${bucket}/${objectPath}`;
}

/** Devuelve `{bucket, objectPath}` si es una referencia válida a lead_uploads; si no, null. */
export function parseLeadUploadRef(ref: string): { bucket: string; objectPath: string } | null {
    if (typeof ref !== 'string') return null;
    const m = REF_RE.exec(ref);
    if (!m) return null;
    return { bucket: m[1], objectPath: m[2] };
}

export function isHttpUrl(value: string): boolean {
    return typeof value === 'string' && /^https?:\/\//i.test(value);
}

export interface SniffedType {
    mime: string;
    ext: string;
    kind: 'image' | 'pdf' | 'video';
}

/**
 * Detecta el tipo REAL por magic bytes (no nos fiamos del mime que declara
 * el cliente). Sólo se aceptan imágenes comunes, PDF y vídeo mp4/mov/webm.
 */
export function sniffFileType(buf: Uint8Array): SniffedType | null {
    if (!buf || buf.length < 12) return null;
    const b = buf;
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg', kind: 'image' };
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: 'image/png', ext: 'png', kind: 'image' };
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return { mime: 'image/gif', ext: 'gif', kind: 'image' };
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
        return { mime: 'image/webp', ext: 'webp', kind: 'image' };
    }
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { mime: 'application/pdf', ext: 'pdf', kind: 'pdf' };
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { mime: 'video/webm', ext: 'webm', kind: 'video' };
    // ISO BMFF: "ftyp" en offset 4 → mp4 / mov / heic.
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
        const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
        if (/^(heic|heix|mif1|msf1|hevc)$/.test(brand)) return { mime: 'image/heic', ext: 'heic', kind: 'image' };
        if (brand === 'qt  ') return { mime: 'video/quicktime', ext: 'mov', kind: 'video' };
        return { mime: 'video/mp4', ext: 'mp4', kind: 'video' };
    }
    return null;
}

export const MAX_IMAGE_OR_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

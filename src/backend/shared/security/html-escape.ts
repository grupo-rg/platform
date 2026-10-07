/**
 * Escapa texto para interpolarlo en HTML (emails). Úsalo con TODO dato que
 * venga de un visitante (nombre, email, teléfono, descripción, ciudad…).
 */
export function escapeHtml(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Devuelve la URL sólo si es http(s); si no, cadena vacía. Evita
 * `javascript:` / `data:` en atributos href de emails.
 */
export function safeHttpUrl(value: unknown): string {
    if (typeof value !== 'string') return '';
    try {
        const u = new URL(value);
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : '';
    } catch {
        return '';
    }
}

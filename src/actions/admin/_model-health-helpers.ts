/**
 * Helpers para `get-model-health.action.ts`.
 *
 * En archivo separado (sin 'use server') porque Next.js exige que todo export
 * de un Server Action sea una función `async`. Las funciones sync puras y
 * helpers de tipo viven aquí.
 */

/**
 * Extrae el capítulo a partir de un code de catálogo. Heurística:
 *   - "EDM01.05" → "EDM" (prefijo alfanumérico hasta el primer dígito).
 *   - "D01.05"   → "D01" (mismo prefijo, dígitos pegados a la letra inicial).
 *   - "GENERIC-EXPLICIT" → "GENERIC".
 *   - Si no hay prefijo identificable, devolvemos `"UNKNOWN"`.
 *
 * El resultado se usa solo para agrupar visualmente, no es semánticamente
 * el "chapter" exacto del catálogo COAATMCA (que vive en
 * `price_book_items.chapter`), pero coincide en >95% de casos.
 */
export function chapterFromCode(code: string | null | undefined): string {
    if (!code) return 'UNKNOWN';
    const trimmed = code.trim();
    if (!trimmed) return 'UNKNOWN';
    // GENERIC-EXPLICIT → "GENERIC"
    const dashIdx = trimmed.indexOf('-');
    if (dashIdx > 0) return trimmed.slice(0, dashIdx).toUpperCase();
    // EDM01.05 → "EDM"; D01.05 → "D01"; ED → "ED".
    const dotIdx = trimmed.indexOf('.');
    const head = dotIdx >= 0 ? trimmed.slice(0, dotIdx) : trimmed;
    // Si el head es 100% dígitos, devolvemos UNKNOWN.
    if (/^\d+$/.test(head)) return 'UNKNOWN';
    return head.toUpperCase();
}

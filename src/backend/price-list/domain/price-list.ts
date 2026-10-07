import { z } from 'zod';
import { TemplateBlockSchema } from '@/backend/document-template/domain/document-template';

/**
 * Listas de precios / tarifas (colección `price_lists`). TODO manual, sin IA.
 * Caso principal: tarifa de precios por hora para una empresa cliente,
 * organizada por oficio (secciones) con líneas tipo "Oficial 1ª (h)".
 *
 * `items` es una lista PLANA y ordenada donde las filas `section` actúan de
 * encabezado de las `item` que les siguen (las secciones son opcionales: lista
 * plana, con secciones o mezcla — las líneas previas a la primera sección van
 * en un grupo sin título).
 */

export const PRICE_LIST_UNITS = ['h', 'ud', 'm²', 'm³', 'ml', 'm', 'kg', 'PA', '%', 'servicio', 'km', 'día'] as const;
export type PriceListUnit = (typeof PRICE_LIST_UNITS)[number];
/** Unidad de las líneas nuevas (tarifa por horas). */
export const DEFAULT_PRICE_LIST_UNIT: PriceListUnit = 'h';

export const PRICE_LIST_STATUSES = ['draft', 'issued'] as const;
export type PriceListStatus = (typeof PRICE_LIST_STATUSES)[number];
export const PRICE_LIST_STATUS_LABELS: Record<PriceListStatus, string> = {
    draft: 'Borrador',
    issued: 'Emitida',
};

export const PriceListRowSchema = z.object({
    id: z.string().min(1),
    type: z.enum(['section', 'item']),
    code: z.string().max(40).optional(),
    description: z.string().max(2000),
    // Unidad libre (string) para tolerar unidades heredadas; la UI ofrece PRICE_LIST_UNITS.
    unit: z.string().max(20).optional(),
    /** Vacío (undefined / null) = "a completar" — se pinta en blanco en el PDF. */
    unitPrice: z.number().finite().nullable().optional(),
});
export type PriceListRow = z.infer<typeof PriceListRowSchema>;

/** Bloque de contenido libre de la lista (snapshot propio; ver `format: 'list'` para viñetas). */
export const PriceListBlockSchema = TemplateBlockSchema;
export type PriceListBlock = z.infer<typeof PriceListBlockSchema>;

export const PriceListSchema = z.object({
    id: z.string().min(1),
    title: z.string().trim().min(1, 'El título es obligatorio').max(200),
    reference: z.string(),
    clientName: z.string().max(200).optional(),
    clientEmail: z.string().max(200).optional(),
    clientAddress: z.string().max(400).optional(),
    /** Fechas como `YYYY-MM-DD`. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
    validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida').optional(),
    pricesIncludeVat: z.boolean(),
    vatRate: z.number().min(0).max(100),
    /** Introducción / descripción (multilínea), entre la cabecera y la tabla. */
    intro: z.string().max(10000).optional(),
    notes: z.string().max(10000).optional(),
    /** Plantilla de origen (solo informativo: los bloques se copian a `blocks`). */
    documentTemplateId: z.string().nullable().optional(),
    /** Bloques propios de esta lista (snapshot editable), tras la tabla. */
    blocks: z.array(PriceListBlockSchema).max(50).optional(),
    /** Aviso final en cursiva (snapshot editable). */
    disclaimer: z.string().max(2000).optional(),
    status: z.enum(PRICE_LIST_STATUSES),
    items: z.array(PriceListRowSchema).max(2000),
    createdAt: z.string(),
    updatedAt: z.string(),
    createdBy: z.string(),
});
export type PriceList = z.infer<typeof PriceListSchema>;

/** Lo que edita la UI (el servidor sella id, referencia, fechas de auditoría y autor). */
export const PriceListInputSchema = PriceListSchema.omit({
    id: true,
    reference: true,
    createdAt: true,
    updatedAt: true,
    createdBy: true,
});
export type PriceListInput = z.infer<typeof PriceListInputSchema>;

export const DEFAULT_VAT_RATE = 21;

// ─── Referencia automática ────────────────────────────────────────────────

const REF_PAD = 4;

/** `LP-2026-0001`. */
export function formatPriceListReference(year: number, seq: number): string {
    return `LP-${year}-${String(seq).padStart(REF_PAD, '0')}`;
}

/** Siguiente secuencia dado el contador persistido (reinicia al cambiar de año). */
export function nextPriceListSeq(counter: { year?: number; lastSeq?: number } | undefined, year: number): number {
    return counter?.year === year ? Number(counter.lastSeq || 0) + 1 : 1;
}

// ─── Secciones / agrupación ────────────────────────────────────────────────

export interface PriceListSection {
    /** `null` = líneas anteriores a la primera sección (o lista sin secciones). */
    title: string | null;
    sectionId: string | null;
    items: PriceListRow[];
}

/**
 * Agrupa la lista plana en secciones respetando el orden. Las secciones vacías
 * se conservan (el usuario puede estar rellenándolas); un grupo inicial sin
 * título solo aparece si tiene líneas.
 */
export function groupPriceListRows(rows: readonly PriceListRow[]): PriceListSection[] {
    const sections: PriceListSection[] = [];
    let current: PriceListSection = { title: null, sectionId: null, items: [] };
    for (const row of rows) {
        if (row.type === 'section') {
            if (current.title !== null || current.items.length > 0) sections.push(current);
            current = { title: row.description, sectionId: row.id, items: [] };
        } else {
            current.items.push(row);
        }
    }
    if (current.title !== null || current.items.length > 0) sections.push(current);
    return sections;
}

/** Número de líneas con precio (excluye encabezados de sección). */
export function countPriceListItems(rows: readonly PriceListRow[]): number {
    return rows.filter((r) => r.type === 'item').length;
}

/** Normaliza la unidad para comparar ("H" ≡ "h", "m2" ≡ "m²"). */
function normUnit(u?: string): string {
    const v = (u || '').trim().toLowerCase();
    if (v === 'm2') return 'm²';
    if (v === 'm3') return 'm³';
    return v;
}

/**
 * Encabezado de la columna de precio de una sección: `€/h` si TODAS sus líneas
 * son por hora; si no, `Precio`.
 */
export function priceColumnHeader(items: readonly PriceListRow[]): string {
    const lines = items.filter((r) => r.type === 'item');
    if (lines.length > 0 && lines.every((r) => normUnit(r.unit) === 'h')) return '€/h';
    return 'Precio';
}

/** Reordena (mover `fromIndex` → `toIndex`), sin mutar. */
export function moveRow<T>(rows: readonly T[], fromIndex: number, toIndex: number): T[] {
    const next = [...rows];
    if (fromIndex < 0 || fromIndex >= next.length || toIndex < 0 || toIndex >= next.length) return next;
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return next;
}

/** Días entre `date` y `validUntil` (ambos `YYYY-MM-DD`); `null` si falta alguno. */
export function validityDays(date?: string, validUntil?: string): number | null {
    if (!date || !validUntil) return null;
    const a = Date.parse(`${date}T00:00:00Z`);
    const b = Date.parse(`${validUntil}T00:00:00Z`);
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    return Math.round((b - a) / 86_400_000);
}

/** `YYYY-MM-DD` → "7 de octubre de 2026". */
export function formatDateEs(iso?: string): string {
    if (!iso) return '';
    const d = new Date(`${iso}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// ─── Plantilla de arranque "tarifa por horas" ─────────────────────────────

export const HOURLY_RATE_TRADES = ['Albañilería', 'Fontanería', 'Electricidad', 'Pintura'] as const;

/**
 * Filas de arranque de una tarifa por horas: una sección por oficio con
 * Oficial 1ª / Oficial 2ª / Peón (h) y Desplazamiento (servicio). PRECIOS
 * VACÍOS a propósito: los completa el usuario a mano.
 */
export function buildHourlyRateStarterRows(newId: () => string): PriceListRow[] {
    const rows: PriceListRow[] = [];
    for (const trade of HOURLY_RATE_TRADES) {
        rows.push({ id: newId(), type: 'section', description: trade });
        rows.push({ id: newId(), type: 'item', description: 'Oficial 1ª', unit: 'h', unitPrice: null });
        rows.push({ id: newId(), type: 'item', description: 'Oficial 2ª', unit: 'h', unitPrice: null });
        rows.push({ id: newId(), type: 'item', description: 'Peón', unit: 'h', unitPrice: null });
        rows.push({ id: newId(), type: 'item', description: 'Desplazamiento', unit: 'servicio', unitPrice: null });
    }
    return rows;
}

/** Id corto para filas/bloques de UI. */
export function newRowId(): string {
    return `r_${Math.random().toString(36).slice(2, 10)}`;
}

/** `YYYY-MM-DD` de hoy (hora local). */
export function todayIso(now: Date = new Date()): string {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

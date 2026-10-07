import { z } from 'zod';

/**
 * Plantillas de condiciones para los PDFs (colección `document_templates`).
 *
 * Una plantilla es una lista ordenada de BLOQUES (título + cuerpo en texto
 * plano) más un aviso/disclaimer opcional. El cuerpo admite un marcado mínimo
 * que interpreta `parseTemplateBody` (ver `template-body.ts`):
 *   - Línea en blanco          → separa párrafos.
 *   - `**texto**`              → negrita en línea.
 *   - Línea que empieza "✔ "   → punto destacado (en negrita); agrupa el texto
 *                                que le sigue hasta el siguiente punto/encabezado.
 *   - Línea entera `**...**`   → encabezado en negrita (p.ej. pregunta de FAQ);
 *                                agrupa igualmente el texto que le sigue.
 *   - Línea que empieza "- "   → viñeta (•).
 *
 * Marcadores sustituibles: ver `TEMPLATE_PLACEHOLDERS`.
 */

export const DOCUMENT_TEMPLATE_KINDS = ['budget', 'price_list', 'any'] as const;
export type DocumentTemplateKind = (typeof DOCUMENT_TEMPLATE_KINDS)[number];

/** Tipos de documento concretos que se renderizan (una plantilla `any` sirve para ambos). */
export type DocumentKind = Exclude<DocumentTemplateKind, 'any'>;

export const DOCUMENT_TEMPLATE_KIND_LABELS: Record<DocumentTemplateKind, string> = {
    budget: 'Presupuesto',
    price_list: 'Lista de precios',
    any: 'Cualquiera',
};

export const TemplateBlockSchema = z.object({
    id: z.string().min(1),
    title: z.string().max(300).default(''),
    body: z.string().max(20000).default(''),
    /**
     * Presentación del bloque. `highlight` = recuadro gris con el texto centrado
     * en negrita (la frase de cierre de la plantilla estándar). Opcional: ausente
     * equivale a `default`.
     */
    variant: z.enum(['default', 'highlight']).optional(),
    /**
     * Formato del cuerpo. `list` = lista de viñetas: cada línea no vacía es un
     * elemento (p.ej. "Materiales no incluidos"). Ausente equivale a `text`
     * (marcado mínimo descrito arriba).
     */
    format: z.enum(['text', 'list']).optional(),
});
export type TemplateBlock = z.infer<typeof TemplateBlockSchema>;

export const DocumentTemplateSchema = z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
    kind: z.enum(DOCUMENT_TEMPLATE_KINDS),
    isDefault: z.boolean(),
    blocks: z.array(TemplateBlockSchema).max(50),
    disclaimer: z.string().max(2000).optional(),
    /** ISO strings (serializables por el boundary de Server Actions). */
    createdAt: z.string(),
    updatedAt: z.string(),
    createdBy: z.string().optional(),
    updatedBy: z.string().optional(),
});
export type DocumentTemplate = z.infer<typeof DocumentTemplateSchema>;

/** Input editable desde la UI (sin campos que sella el servidor). */
export const DocumentTemplateInputSchema = DocumentTemplateSchema.pick({
    name: true,
    kind: true,
    blocks: true,
    disclaimer: true,
}).extend({
    isDefault: z.boolean().optional(),
});
export type DocumentTemplateInput = z.infer<typeof DocumentTemplateInputSchema>;

/** Lo que consume el renderizador del PDF: solo contenido. */
export interface ResolvedDocumentTemplate {
    blocks: TemplateBlock[];
    disclaimer?: string;
    /** De dónde salió: asignada al documento, predeterminada en Firestore o constante en código. */
    source: 'assigned' | 'default' | 'builtin';
    templateId?: string;
    name: string;
}

/**
 * Marcadores admitidos. `appliesTo` documenta en qué tipo de documento tienen
 * valor; en el resto se sustituyen por cadena vacía.
 */
export const TEMPLATE_PLACEHOLDERS = [
    { key: 'empresa', label: 'Nombre comercial de la empresa (Ajustes › Empresa)', appliesTo: ['budget', 'price_list'] },
    { key: 'cliente', label: 'Nombre del cliente', appliesTo: ['budget', 'price_list'] },
    { key: 'fecha', label: 'Fecha del documento', appliesTo: ['budget', 'price_list'] },
    { key: 'total', label: 'Total del presupuesto (IVA incl.)', appliesTo: ['budget'] },
    {
        key: 'validez_dias',
        label: 'Días de validez (presupuesto: 15; lista: días entre fecha y "válida hasta")',
        appliesTo: ['budget', 'price_list'],
    },
] as const satisfies ReadonlyArray<{ key: string; label: string; appliesTo: readonly DocumentKind[] }>;

export type TemplatePlaceholderKey = (typeof TEMPLATE_PLACEHOLDERS)[number]['key'];
export type TemplatePlaceholderValues = Partial<Record<TemplatePlaceholderKey, string>>;

const KNOWN_KEYS = new Set<string>(TEMPLATE_PLACEHOLDERS.map((p) => p.key));

/**
 * Sustituye `{{marcador}}` (tolera espacios: `{{ cliente }}`). Los marcadores
 * conocidos sin valor → cadena vacía. Los DESCONOCIDOS se dejan tal cual para
 * que el autor vea la errata en el PDF.
 */
export function applyTemplatePlaceholders(text: string, values: TemplatePlaceholderValues): string {
    if (!text) return text;
    return text.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (match, rawKey: string) => {
        const key = rawKey.toLowerCase();
        if (!KNOWN_KEYS.has(key)) return match;
        return values[key as TemplatePlaceholderKey] ?? '';
    });
}

/** ¿La plantilla sirve para este tipo de documento? */
export function templateMatchesKind(template: Pick<DocumentTemplate, 'kind'>, kind: DocumentKind): boolean {
    return template.kind === kind || template.kind === 'any';
}

/** Genera un id corto para bloques nuevos (no criptográfico; solo clave de UI). */
export function newBlockId(): string {
    return `b_${Math.random().toString(36).slice(2, 10)}`;
}


import { z } from 'zod';

// Zod Schema for validation (Can be used in Application/Interface layers)
export const PriceBookItemSchema = z.object({
    id: z.string().optional(),
    code: z.string().describe("The unique code of the item from the PDF (e.g., 'D01.05')"),
    description: z.string().describe("Full description of the construction task"),
    unit: z.string().describe("Unit of measurement (e.g., 'm2', 'u', 'ml')"),
    priceLabor: z.number().optional().describe("Cost of labor per unit"),
    priceMaterial: z.number().optional().describe("Cost of materials per unit"),
    priceTotal: z.number().describe("Total execution cost (Material + Labor)"),
    year: z.number().optional().describe("Year of the price book"),
    chapter: z.string().optional(),
    section: z.string().optional(),
    page: z.number().optional(),
    // Forma canónica del catálogo `price_book_2025` (la que ingesta COAATMCA y
    // exige `PriceBookItemEntry` del pipeline híbrido, ver
    // services/ai-core/.../price_book_entry.py). El buscador híbrido
    // (`list_all_items` → BM25) filtra `where("kind","==","item")` y luego hace
    // `PriceBookItemEntry(**data)`, que REQUIERE `unit_raw` y `chapter`. Sin estos
    // campos, las partidas guardadas por el editor (from_scratch/IA) quedan fuera
    // del índice híbrido y solo se reutilizan por el path vectorial legacy.
    kind: z.literal('item').optional().describe("Discriminador item/breakdown del catálogo; el híbrido filtra kind=='item'"),
    unit_raw: z.string().optional().describe("Unidad tal cual (= unit); requerida por PriceBookItemEntry"),
    unit_normalized: z.string().optional(),
    unit_dimension: z.string().optional(),
    searchKeywords: z.array(z.string()).optional(),
    createdAt: z.date().optional(),
    updatedAt: z.date().optional(),
    // Procedencia / etiquetado. El catálogo COAATMCA no marca `source` (ausente =
    // catálogo oficial). Las partidas guardadas por el constructor desde el editor
    // se etiquetan `ai_generated` para distinguirlas y auditarlas, conservando la
    // traza al presupuesto/partida de origen.
    source: z.enum(['ai_generated', 'coaatmca', 'manual']).optional(),
    matchKind: z.enum(['1:1', '1:N', 'from_scratch']).optional(),
    originBudgetId: z.string().optional(),
    originPartidaCode: z.string().optional(),
    savedByUserId: z.string().optional(),
});

/**
 * Domain Entity: PriceBookComponent
 */
export interface PriceBookComponent {
    code: string;
    unit?: string;
    description?: string;
    quantity: number;
    price: number;
    is_variable?: boolean;
}

/**
 * Domain Entity: PriceBookItem
 */
export type PriceBookItem = z.infer<typeof PriceBookItemSchema> & {
    breakdown?: PriceBookComponent[];
    embedding?: number[];
}

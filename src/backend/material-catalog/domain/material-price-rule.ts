
import { z } from 'zod';

/**
 * Regla de ajuste de precio de materiales por porcentaje.
 *
 * Documentos de la colección Firestore `material_price_rules`. La colección es
 * PEQUEÑA (gestionada por admin): el resolver carga todas las reglas activas y
 * decide en memoria con la política "el más específico gana" (ver
 * `src/lib/pricing/material-price-resolver.ts`).
 *
 * IMPORTANTE: el lado Python lee EXACTAMENTE estos mismos documentos, así que
 * los nombres de campo son un contrato compartido y no deben renombrarse sin
 * coordinar ambos lados.
 */
export const MaterialPriceRuleSchema = z.object({
    id: z.string(),
    scope: z.enum(['global', 'category', 'material', 'client', 'budget'])
        .describe("Alcance de la regla — determina la precedencia (budget > client > material > category > global)"),
    target: z.object({
        category: z.string().optional().describe("Categoría (texto libre jerárquico 'Padre > Hijo') para scope 'category'"),
        sku: z.string().optional().describe("SKU del material para scope 'material'"),
        leadId: z.string().optional().describe("Id del cliente/lead para scope 'client'"),
        budgetId: z.string().optional().describe("Id del presupuesto para scope 'budget'"),
    }).describe("Objetivo de la regla; el campo relevante depende de `scope`"),
    adjustmentPct: z.number()
        .describe("Ajuste porcentual CON SIGNO: +10 sube 10%, -8 descuenta 8%"),
    active: z.boolean().describe("Solo las reglas activas participan en la resolución"),
    note: z.string().optional().describe("Nota libre para el admin"),
    createdBy: z.string(),
    createdAt: z.string().describe("ISO string"),
    updatedBy: z.string(),
    updatedAt: z.string().describe("ISO string"),
});

export type MaterialPriceRule = z.infer<typeof MaterialPriceRuleSchema>;

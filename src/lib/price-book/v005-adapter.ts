/**
 * Phase 18 — Adapter v005 → PriceBookItem legacy.
 *
 * El catálogo Python v005 (`services/ai-core/scripts/vectorize_catalog_v005.py`)
 * persiste docs con un schema diferente al que el UI admin sigue esperando:
 *
 *   v005 item:        kind='item', unit_raw, unit_normalized, breakdown_ids[],
 *                     priceTotal, chapter, section, source_page, source_book.
 *   v005 breakdown:   kind='breakdown', parent_code, parent_description,
 *                     parent_unit, description, unit_raw, quantity, price_unit,
 *                     price, is_variable.
 *
 *   UI legacy espera: code, description, unit, priceTotal, chapter, section,
 *                     breakdown[]={code, description, unit, quantity, price, is_variable}.
 *
 * Estos mappers traducen entre formatos en el boundary HTTP (server actions),
 * permitiendo al UI seguir trabajando con `PriceBookItem` y `PriceBookComponent`
 * sin reescribir cada componente.
 */
import type {
    PriceBookItem,
    PriceBookComponent,
} from '@/backend/price-book/domain/price-book-item';

/** Doc v005 con kind='item'. */
export interface V005ItemDoc {
    kind?: 'item' | string;
    code?: string;
    chapter?: string;
    section?: string;
    description?: string;
    unit?: string;       // Legacy field — puede existir en docs antiguos
    unit_raw?: string;   // v005 canonical
    unit_normalized?: string;
    priceTotal?: number;
    priceLabor?: number;     // Legacy
    priceMaterial?: number;  // Legacy
    breakdown_ids?: string[]; // v005 references
    breakdown?: any[];        // Legacy embedded (algunos docs antiguos sobreviven)
    source_page?: number;
    source_book?: string;
    year?: number;       // Legacy field
    createdAt?: any;
    updatedAt?: any;
    id?: string;
    embedding?: any;
}

/** Doc v005 con kind='breakdown'. */
export interface V005BreakdownDoc {
    kind?: 'breakdown' | string;
    code?: string;
    doc_id?: string;
    parent_code?: string;
    parent_description?: string;
    parent_unit?: string;
    chapter?: string;
    description?: string;
    unit?: string;       // Legacy
    unit_raw?: string;   // v005 canonical
    unit_normalized?: string;
    quantity?: number;
    price_unit?: number; // v005 canonical
    price?: number;      // Legacy / fallback
    is_variable?: boolean;
    source_book?: string;
}

/** Mapea un doc v005 (o legacy) al shape PriceBookItem que espera el UI. */
export function adaptV005Item(doc: V005ItemDoc): PriceBookItem {
    const unit = doc.unit ?? doc.unit_raw ?? '';
    const breakdown: PriceBookComponent[] | undefined = Array.isArray(doc.breakdown)
        ? doc.breakdown.map(adaptV005Breakdown)
        : undefined;
    return {
        id: doc.id,
        code: doc.code ?? '',
        description: doc.description ?? '',
        unit,
        priceTotal: typeof doc.priceTotal === 'number' ? doc.priceTotal : 0,
        priceLabor: doc.priceLabor,
        priceMaterial: doc.priceMaterial,
        year: doc.year,
        chapter: doc.chapter,
        section: doc.section,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        breakdown,
    };
}

/** Mapea un doc breakdown v005 al PriceBookComponent que espera el UI. */
export function adaptV005Breakdown(doc: V005BreakdownDoc): PriceBookComponent {
    const unit = doc.unit ?? doc.unit_raw ?? '';
    // v005 expone `price_unit` (precio por unidad) y `price` (= price_unit × quantity).
    // El UI espera `price` como precio unitario. Preferimos `price_unit` cuando existe.
    const unitPrice = typeof doc.price_unit === 'number'
        ? doc.price_unit
        : (typeof doc.price === 'number' ? doc.price : 0);
    return {
        code: doc.code ?? '',
        unit,
        description: doc.description,
        quantity: typeof doc.quantity === 'number' ? doc.quantity : 0,
        price: unitPrice,
        is_variable: doc.is_variable,
    };
}

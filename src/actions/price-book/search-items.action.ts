'use server';

import { FirestorePriceBookRepository } from '@/backend/price-book/infrastructure/firestore-price-book-repository';
import { SearchPriceBookService } from '@/backend/price-book/application/search-price-book-service';
import { PriceBookItem } from '@/backend/price-book/domain/price-book-item';
import { adaptV005Item, V005ItemDoc } from '@/lib/price-book/v005-adapter';

/**
 * Phase 18 — Búsqueda en el price book usado por el editor `BudgetLibrarySidebar`.
 *
 * El catálogo Python v005 escribe items con `kind='item'` y breakdowns con
 * `kind='breakdown'` en la misma colección. Vector search devuelve ambos
 * mezclados. Filtramos `kind='breakdown'` y aplicamos el adapter para que el
 * UI siga consumiendo el shape `PriceBookItem` (con `unit` mapeado de `unit_raw`).
 */
export async function searchPriceBookAction(query: string): Promise<{ success: boolean; data?: PriceBookItem[]; error?: string }> {
    try {
        if (!query || query.trim().length === 0) {
            return { success: true, data: [] };
        }

        const repository = new FirestorePriceBookRepository();
        const service = new SearchPriceBookService(repository);

        console.log(`[Action] Searching for: "${query}"`);
        const results = await service.execute(query, 15);

        // Phase 18 — adapter v005: filtrar breakdowns y mapear unit_raw → unit.
        const serializedResults: PriceBookItem[] = results
            .filter((raw: any) => raw?.kind !== 'breakdown')
            .map((raw: any) => {
                const adapted = adaptV005Item(raw as V005ItemDoc);
                return {
                    ...adapted,
                    createdAt: raw.createdAt ? new Date(raw.createdAt) : undefined,
                };
            });

        return { success: true, data: serializedResults };
    } catch (error) {
        console.error('[Action] Error searching price book:', error);
        return { success: false, error: 'Failed to search price book.' };
    }
}

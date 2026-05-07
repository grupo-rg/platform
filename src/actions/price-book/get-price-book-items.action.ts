'use server';

import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';
import { getFirestore } from 'firebase-admin/firestore';
import { PriceBookItem } from '@/backend/price-book/domain/price-book-item';
import { adaptV005Item, V005ItemDoc } from '@/lib/price-book/v005-adapter';

/**
 * Phase 18 — Lista los items del catálogo desde la colección `price_book_2025`.
 *
 * El catálogo Python v005 escribe docs con `kind='item'` (y docs hermanos
 * `kind='breakdown'` para los componentes). Filtramos por `kind='item'` y
 * adaptamos al shape legacy `PriceBookItem` para que el UI no cambie.
 *
 * Notas:
 * - El parámetro `year` se mantiene por backwards-compat de la firma, pero
 *   el schema v005 NO almacena `year`. Lo ignoramos al filtrar.
 * - `breakdown` ya NO viene embebido. El detail modal lo carga on-demand
 *   vía `getPriceBookBreakdown(parentCode)`.
 */
export async function getPriceBookItems(year: number = 2025, limitCount: number = 2000) {
    try {
        console.log(`[Action] Fetching price book items (limit: ${limitCount})...`);
        initFirebaseAdminApp();
        const db = getFirestore();
        const collectionRef = db.collection('price_book_2025');

        // Query v005: filtrar por kind='item'. Si el doc no tiene `kind` es legacy
        // y lo aceptamos también (defensivo). Para evitar excluir legacy, hacemos
        // una segunda query y unimos.
        // CRÍTICO: `.select()` excluye el campo `embedding` (768 floats por doc).
        // Sin esto, 2000 docs ≈ 6 MB de payload → la página se queda cargando.
        const v005Fields = [
            'kind', 'code', 'chapter', 'section', 'description',
            'unit_raw', 'unit_normalized', 'priceTotal',
            'breakdown_ids', 'source_page', 'source_book',
            'createdAt', 'updatedAt',
        ] as const;
        const legacyFields = [
            'code', 'description', 'unit', 'priceTotal',
            'year', 'chapter', 'section', 'priceLabor', 'priceMaterial',
            'breakdown', 'createdAt', 'updatedAt',
        ] as const;

        const [v005Snap, legacySnap] = await Promise.all([
            collectionRef
                .where('kind', '==', 'item')
                .select(...(v005Fields as readonly string[]))
                .limit(limitCount)
                .get(),
            collectionRef
                .where('year', '==', year)
                .select(...(legacyFields as readonly string[]))
                .limit(limitCount)
                .get(),
        ]);

        const seen = new Set<string>();
        const collected: PriceBookItem[] = [];

        const toDate = (val: any) => {
            if (!val) return null;
            if (val.toDate) return val.toDate();
            if (val instanceof Date) return val;
            return new Date(val);
        };

        const collect = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) => {
            for (const doc of docs) {
                if (seen.has(doc.id)) continue;
                seen.add(doc.id);
                const raw = doc.data() as V005ItemDoc;
                // Excluir docs hermanos de tipo breakdown (no deben listarse como partidas).
                if (raw.kind === 'breakdown') continue;
                const item = adaptV005Item({ ...raw, id: doc.id });
                collected.push({
                    ...item,
                    createdAt: toDate((raw as any).createdAt),
                    updatedAt: toDate((raw as any).updatedAt),
                });
            }
        };

        collect(v005Snap.docs);
        collect(legacySnap.docs);

        console.log(`[Action] Found ${collected.length} items (v005=${v005Snap.size}, legacy=${legacySnap.size}).`);

        // Total: items con kind='item' o sin kind (legacy con year=2025).
        // Para el contador usamos el primary count (v005). Defensivo: si el
        // count aggregation falla (sin índice o permisos), caemos al length local.
        let total = collected.length;
        try {
            const countSnap = await collectionRef.where('kind', '==', 'item').count().get();
            total = countSnap.data().count || collected.length;
        } catch (countErr) {
            console.warn('[Action] count() failed, using collected.length as total', countErr);
        }

        // Sanitización JSON-safe para boundary de Server Action.
        return JSON.parse(JSON.stringify({
            success: true,
            items: collected,
            total,
        }));
    } catch (error: any) {
        console.error('Error fetching price book items:', error);
        return { success: false, error: error.message };
    }
}

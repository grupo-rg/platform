'use server';

import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';
import { getFirestore } from 'firebase-admin/firestore';
import { PriceBookComponent } from '@/backend/price-book/domain/price-book-item';
import { adaptV005Breakdown, V005BreakdownDoc } from '@/lib/price-book/v005-adapter';
import type { NormalizedCatalogComponent } from '@/lib/budget/reconciliation';

/**
 * Phase 18 — Carga los componentes (descompuesto) de una partida del catálogo
 * desde docs hermanos `kind='breakdown'` en `price_book_2025`.
 *
 * El v005 separa items de sus componentes: para reconstruir el descompuesto
 * de una partida `parent_code='DEH030'`, este action consulta:
 *   .where('kind', '==', 'breakdown').where('parent_code', '==', parentCode)
 *
 * Devuelve el array vacío si la partida es legacy (descompuesto embebido en
 * el item) o si genuinamente no tiene componentes.
 */
export async function getPriceBookBreakdown(parentCode: string): Promise<{
    success: boolean;
    components: PriceBookComponent[];
    error?: string;
}> {
    if (!parentCode || parentCode.trim().length === 0) {
        return { success: true, components: [] };
    }

    try {
        initFirebaseAdminApp();
        const db = getFirestore();
        const collectionRef = db.collection('price_book_2025');

        const snapshot = await collectionRef
            .where('kind', '==', 'breakdown')
            .where('parent_code', '==', parentCode)
            .get();

        const components: PriceBookComponent[] = snapshot.docs.map((doc) => {
            const raw = doc.data() as V005BreakdownDoc;
            return adaptV005Breakdown(raw);
        });

        return JSON.parse(JSON.stringify({
            success: true,
            components,
        }));
    } catch (error: any) {
        console.error('[Action] getPriceBookBreakdown error:', error);
        return { success: false, components: [], error: error.message };
    }
}

/**
 * Variante de `getPriceBookBreakdown` para REPARAR descompuestos: preserva el
 * total de línea (`price`) y el precio unitario (`price_unit`) por componente.
 *
 * `adaptV005Breakdown` colapsa ambos a un único `price`, lo que pierde el total
 * de línea correcto de `%` (medios auxiliares = porcentaje de la base, no
 * `price_unit × quantity`). La reparación necesita el total de línea fiel.
 */
export async function getCatalogBreakdownForRepair(parentCode: string): Promise<{
    success: boolean;
    components: NormalizedCatalogComponent[];
    error?: string;
}> {
    if (!parentCode || parentCode.trim().length === 0) {
        return { success: true, components: [] };
    }

    try {
        initFirebaseAdminApp();
        const db = getFirestore();

        const snapshot = await db.collection('price_book_2025')
            .where('kind', '==', 'breakdown')
            .where('parent_code', '==', parentCode)
            .get();

        const components: NormalizedCatalogComponent[] = snapshot.docs.map((doc) => {
            const d = doc.data() as V005BreakdownDoc;
            const quantity = typeof d.quantity === 'number' ? d.quantity : 0;
            const unitPrice = typeof d.price_unit === 'number'
                ? d.price_unit
                : (typeof d.price === 'number' && quantity > 0 ? d.price / quantity : (d.price ?? 0));
            const lineTotal = typeof d.price === 'number' ? d.price : unitPrice * quantity;
            return {
                code: d.code ?? '',
                description: d.description,
                unit: d.unit ?? d.unit_raw,
                quantity,
                unitPrice,
                lineTotal,
                is_variable: d.is_variable === true,
            };
        });

        return JSON.parse(JSON.stringify({ success: true, components }));
    } catch (error: any) {
        console.error('[Action] getCatalogBreakdownForRepair error:', error);
        return { success: false, components: [], error: error.message };
    }
}

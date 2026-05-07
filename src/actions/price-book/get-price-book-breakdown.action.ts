'use server';

import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';
import { getFirestore } from 'firebase-admin/firestore';
import { PriceBookComponent } from '@/backend/price-book/domain/price-book-item';
import { adaptV005Breakdown, V005BreakdownDoc } from '@/lib/price-book/v005-adapter';

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

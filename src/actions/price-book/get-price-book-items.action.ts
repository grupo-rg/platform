
'use server';

import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';
import { getFirestore } from 'firebase-admin/firestore';
import { PriceBookItem } from '@/backend/price-book/domain/price-book-item';

export async function getPriceBookItems(year: number, limitCount: number = 50) {
    try {
        console.log(`[Action] Fetching price book items for year ${year} (limit: ${limitCount})...`);
        initFirebaseAdminApp();
        const db = getFirestore();
        const collectionName = year === 2025 ? 'price_book_2025' : 'price_book_2025';
        const collectionRef = db.collection(collectionName);

        console.log(`[Action] Querying Firestore...`);
        // Query by year
        const snapshot = await collectionRef
            .where('year', '==', year)
            .select('code', 'description', 'unit', 'priceTotal', 'year', 'chapter', 'section', 'createdAt', 'updatedAt', 'priceLabor', 'priceMaterial', 'breakdown')
            .limit(limitCount)
            .get();

        console.log(`[Action] Query complete. Found ${snapshot.size} docs.`);





        // ...

        const items = snapshot.docs.map(doc => {
            const data = doc.data() as PriceBookItem; // Cast to known type

            // Helper to safe convert timestamps
            const toDate = (val: any) => {
                if (!val) return null;
                if (val.toDate) return val.toDate(); // Firestore Timestamp
                if (val instanceof Date) return val;
                return new Date(val); // String or number
            };

            return {
                ...data,
                id: doc.id,
                embedding: undefined, // Don't send heavy vectors to client
                createdAt: toDate(data.createdAt),
                updatedAt: toDate(data.updatedAt),
            } as PriceBookItem;
        });

        // Get total count
        const countQuery = collectionRef.where('year', '==', year).count();
        const countSnapshot = await countQuery.get();

        // Final separate sanitization to ensure no non-POJOs leak
        return JSON.parse(JSON.stringify({
            success: true,
            items,
            total: countSnapshot.data().count
        }));
    } catch (error: any) {
        console.error("Error fetching price book items:", error);
        return { success: false, error: error.message };
    }
}

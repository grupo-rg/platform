
'use server';

import { SemanticSearchUseCase } from '@/backend/price-book/application/semantic-search.use-case';
import { RestApiVectorizerAdapter } from '@/backend/price-book/infrastructure/ai/rest-api-vectorizer.adapter';
import { FirestorePriceBookRepository } from '@/backend/price-book/infrastructure/firestore/firestore-price-book.repository';
import { PriceBookItem } from '@/backend/price-book/domain/price-book-item'; // Ensure this is exported

export async function searchPriceBookAction(query: string, year: number = 2025): Promise<PriceBookItem[]> {
    if (!query || query.trim().length === 0) {
        return [];
    }

    try {
        console.log(`[ServerAction] Searching for: "${query}"`);

        // Dependency Injection (Manual for now)
        // In a larger app, we might use a container or singleton instance
        const collectionName = year === 2025 ? 'price_book_2025' : 'price_book_2025';
        const repository = new FirestorePriceBookRepository(collectionName);
        const vectorizer = new RestApiVectorizerAdapter();
        const useCase = new SemanticSearchUseCase(repository, vectorizer);

        const results = await useCase.execute(query, 20); // Limit 20 results

        console.log(`[ServerAction] Found ${results.length} results`);

        // Ensure data is serializable (Dates to strings if any, though PriceBookItem usually has strings/numbers)
        // If PriceBookItem has Date objects (e.g. updatedAt), we need to serialize them.
        // Firestore returns Dates as Timestamp object or Date object depending on config.
        // We'll perform a simple JSON serialization/deserialization to ensure compatibility with Server Actions boundary.
        // Sanitize results before returning
        const sanitizedResults = results.map(item => {
            const toDate = (val: any) => {
                if (!val) return null;
                if (val.toDate) return val.toDate();
                if (val instanceof Date) return val;
                return null;
            };

            return {
                ...item,
                embedding: undefined, // Remove embedding from payload
                createdAt: toDate((item as any).createdAt),
                updatedAt: toDate((item as any).updatedAt),
            };
        });

        return JSON.parse(JSON.stringify(sanitizedResults));

    } catch (error) {
        console.error("[ServerAction] Search failed:", error);
        throw new Error("Failed to search price book");
    }
}

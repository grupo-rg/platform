
import { PriceBookRepository } from '@/backend/price-book/domain/price-book-repository'; // Interface
import { FirestorePriceBookRepository } from '@/backend/price-book/infrastructure/firestore-price-book-repository';
import { FirestoreMaterialCatalogRepository } from '@/backend/material-catalog/infrastructure/firestore-material-catalog-repository';
import { UnifiedCatalogItem } from '../domain/catalog-item';
import { RestApiVectorizerAdapter } from '@/backend/price-book/infrastructure/ai/rest-api-vectorizer.adapter';

export class CatalogSearchService {
    private priceBookRepo: FirestorePriceBookRepository;
    private materialRepo: FirestoreMaterialCatalogRepository;
    private vectorizer: RestApiVectorizerAdapter;

    constructor() {
        // In a real DI system we would inject these, but for now we instantiate them
        // or accept them in constructor if we want to mock.
        this.priceBookRepo = new FirestorePriceBookRepository();
        this.materialRepo = new FirestoreMaterialCatalogRepository();
        this.vectorizer = new RestApiVectorizerAdapter();
    }

    async search(query: string, limitPerSource: number = 5): Promise<UnifiedCatalogItem[]> {
        if (!query.trim()) return [];

        try {
            // 1. Vectorize query once
            const embedding = await this.vectorizer.embedText(query);

            // 2. Parallel Search (Resilient)
            const results = await Promise.allSettled([
                this.priceBookRepo.searchByVector(embedding, limitPerSource),
                this.materialRepo.searchByVector(embedding, limitPerSource)
            ]);

            const priceBookResults = results[0].status === 'fulfilled' ? results[0].value : [];
            const materialResults = results[1].status === 'fulfilled' ? results[1].value : [];

            if (results[0].status === 'rejected') console.error('[CatalogSearchService] PriceBook Search Error:', results[0].reason);
            if (results[1].status === 'rejected') console.error('[CatalogSearchService] Material Search Error:', results[1].reason);

            // 3. Normalize & Merge
            const unifiedPriceBook: UnifiedCatalogItem[] = priceBookResults.map(item => ({
                id: item.code, // Code is the ID for PriceBook
                type: 'LABOR',
                code: item.code,
                name: item.description.substring(0, 100) + (item.description.length > 100 ? '...' : ''), // Shorten if needed or use full
                description: item.description,
                price: item.priceTotal,
                unit: item.unit,
                originalItem: item,
                score: 0 // Vector search wrapper might not return score yet, or we need to type it
            }));

            const unifiedMaterials: UnifiedCatalogItem[] = materialResults.map(item => ({
                id: item.sku,
                type: 'MATERIAL',
                code: item.sku,
                name: item.name,
                description: item.description,
                price: item.price,
                unit: item.unit,
                originalItem: item,
                score: 0
            }));

            // 4. Return combined (could be interleaved by score if available, for now just concatenated)
            return [...unifiedPriceBook, ...unifiedMaterials];

        } catch (error) {
            console.error('[CatalogSearchService] Error searching:', error);
            return [];
        }
    }
}

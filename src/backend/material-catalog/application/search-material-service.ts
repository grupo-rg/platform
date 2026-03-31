
import { MaterialCatalogRepository } from '../domain/material-catalog-repository';
import { MaterialItem } from '../domain/material-item';
import { ai, embeddingModel } from '@/backend/ai/shared/config/genkit.config';

export class SearchMaterialService {
    constructor(
        private repository: MaterialCatalogRepository
    ) { }

    async search(query: string, limit: number = 10): Promise<MaterialItem[]> {
        // Hybrid strategy:
        // 1. If query looks like a SKU, search by SKU first
        if (/^\d{5,10}$/.test(query)) {
            const bySku = await this.repository.findBySku(query);
            if (bySku) return [bySku];
        }

        // 2. Semantic Search using Vector Embeddings
        try {
            const results = await ai.embed({
                embedder: embeddingModel,
                content: query,
                options: { outputDimensionality: 768 }
            });

            // Genkit embed returns an array of results even for single content
            return await this.repository.searchByVector(results[0].embedding, limit);
        } catch (error) {
            console.error("Vector search failed, falling back to text:", error);
            return await this.repository.searchByText(query, limit);
        }
    }
}

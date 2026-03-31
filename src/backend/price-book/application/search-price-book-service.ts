
import { PriceBookRepository } from "../domain/price-book-repository";
import { ai, embeddingModel } from '@/backend/ai/shared/config/genkit.config';
import { PriceBookItem } from "../domain/price-book-item";

export class SearchPriceBookService {
    constructor(private repository: PriceBookRepository) { }

    async execute(query: string, limit: number = 10, year?: number): Promise<PriceBookItem[]> {
        console.log(`[SearchService] Generating embedding for query: "${query}"`);

        // 1. Generate Embedding for the query
        // Note: ai.embed returns an Array of results even for single content in this SDK version
        const embeddingResult = await ai.embed({
            embedder: embeddingModel,
            content: query
        });

        // Handle Array return type
        const vector = Array.isArray(embeddingResult) ? embeddingResult[0]?.embedding : (embeddingResult as any).embedding;

        console.log(`[SearchService] Generated vector length: ${vector?.length}`);

        if (!vector || vector.length === 0) {
            console.error("[SearchService] Error: Generated vector is empty.");
            return [];
        }

        // 2. Perform Vector Search
        return this.repository.searchByVector(vector, limit, year, query);
    }
}

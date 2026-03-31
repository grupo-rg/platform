
import { z } from 'zod';
import { ai } from '@/backend/ai/shared/config/genkit.config';
import { FirestoreMaterialCatalogRepository } from '@/backend/material-catalog/infrastructure/firestore-material-catalog-repository';
import { MaterialItem } from '@/backend/material-catalog/domain/material-item';
import { RestApiVectorizerAdapter } from '@/backend/price-book/infrastructure/ai/rest-api-vectorizer.adapter';
import { getCurrentContext } from '@/backend/ai/shared/context/genkit.context';

// Instantiate dependencies (Singleton-ish pattern for Genkit tools)
const materialRepo = new FirestoreMaterialCatalogRepository();
const vectorizer = new RestApiVectorizerAdapter();

export const materialRetrieverTool = ai.defineTool(
    {
        name: 'materialRetriever',
        description: 'Searches for specific material products (e.g., from Obramat) using semantic vector search. Use this when you need to find real market prices for materials.',
        inputSchema: z.object({
            query: z.string().describe('The name or description of the material to find (e.g. "Saco de cemento", "Parquet laminado").'),
            limit: z.number().optional().default(5).describe('Number of items to return.'),
        }),
        outputSchema: z.object({
            items: z.array(z.object({
                sku: z.string(),
                name: z.string(),
                description: z.string(),
                price: z.number(),
                unit: z.string(),
                category: z.string(),
            })),
        }),
    },
    async (input) => {
        try {
            console.log(`[Tool:MaterialRetriever] Searching for: "${input.query}"`);

            // Stream Context UI logging 
            const ctx = getCurrentContext();
            if (ctx?.userId) {
                const { emitGenerationEvent } = await import('@/backend/budget/events/budget-generation.emitter');
                emitGenerationEvent(ctx.userId, 'vector_search', { query: input.query });
            }

            // 1. Vectorize query
            const embedding = await vectorizer.embedText(input.query);

            // 2. Search Repository
            const results = await materialRepo.searchByVector(embedding, input.limit);

            console.log(`[Tool:MaterialRetriever] Found ${results.length} items.`);

            // 3. Map to output
            return {
                items: results.map((item: MaterialItem) => ({
                    sku: item.sku || item.id || 'UNKNOWN',
                    name: item.name,
                    description: item.description,
                    price: item.price,
                    unit: item.unit,
                    category: item.category,
                }))
            };
        } catch (error) {
            console.error('[Tool:MaterialRetriever] Error:', error);
            return { items: [] };
        }
    }
);

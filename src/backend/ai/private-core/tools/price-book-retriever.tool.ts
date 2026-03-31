
import { z } from 'zod';
import { ai } from '@/backend/ai/shared/config/genkit.config';
import { FirestorePriceBookRepository } from '@/backend/price-book/infrastructure/firestore-price-book-repository';
import { RestApiVectorizerAdapter } from '@/backend/price-book/infrastructure/ai/rest-api-vectorizer.adapter';
import { getCurrentContext } from '@/backend/ai/shared/context/genkit.context';

const priceBookRepo = new FirestorePriceBookRepository();
const vectorizer = new RestApiVectorizerAdapter();

export const priceBookRetrieverTool = ai.defineTool(
    {
        name: 'priceBookRetriever',
        description: 'Searches for construction price book items using semantic vector search. Use this to find prices and descriptions for construction tasks.',
        inputSchema: z.object({
            query: z.string().describe('The search query or description of the construction task to look for.'),
            limit: z.number().optional().default(5).describe('Number of items to return.'),
            year: z.number().optional().default(2025).describe('Year of the price book to search in.'),
        }),
        outputSchema: z.object({
            items: z.array(z.object({
                code: z.string(),
                description: z.string(),
                priceTotal: z.number(),
                priceLabor: z.number().optional(),
                priceMaterial: z.number().optional(),
                unit: z.string(),
                breakdown: z.array(z.any()).optional()
            })),
        }),
    },
    async (input) => {
        try {
            console.log(`[Tool:PriceBookRetriever] Searching for: "${input.query}" (Year: ${input.year})`);

            // Stream Context UI logging 
            const ctx = getCurrentContext();
            if (ctx?.userId) {
                const { emitGenerationEvent } = await import('@/backend/budget/events/budget-generation.emitter');
                emitGenerationEvent(ctx.userId, 'vector_search', { query: input.query });
            }

            // 1. Generate Embedding for the query using the Adapter (forces 768 dims)
            const embedding = await vectorizer.embedText(input.query);

            // 2. Search in Repository
            const results = await priceBookRepo.searchByVector(embedding, input.limit, input.year, input.query);

            console.log(`[Tool:PriceBookRetriever] Found ${results.length} items.`);
            if (results.length > 0) {
                console.log(`[Tool:PriceBookRetriever] First item keys: ${Object.keys(results[0]).join(', ')}`);
                console.log(`[Tool:PriceBookRetriever] First item sample:`, JSON.stringify(results[0], null, 2));
            }

            // 3. Map to output schema (keep it minimal/token-efficient for LLM)
            return {
                items: results.map(item => ({
                    code: item.code || 'UNKNOWN',
                    description: item.description || 'No Description',
                    priceTotal: item.priceTotal || 0,
                    priceLabor: item.priceLabor,
                    priceMaterial: item.priceMaterial,
                    unit: item.unit || 'ud',
                    breakdown: item.breakdown
                }))
            };
        } catch (error) {
            console.error('[Tool:PriceBookRetriever] Error:', error);
            // Return empty array on error to avoid crashing the flow
            return { items: [] };
        }
    }
);

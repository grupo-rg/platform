import { z } from 'zod';
import { ai } from '@/backend/ai/shared/config/genkit.config';
import { FirestoreMaterialCatalogRepository } from '@/backend/material-catalog/infrastructure/firestore-material-catalog-repository';
import { MaterialItem } from '@/backend/material-catalog/domain/material-item';
import { RestApiVectorizerAdapter } from '@/backend/price-book/infrastructure/ai/rest-api-vectorizer.adapter';

const materialRepo = new FirestoreMaterialCatalogRepository();
const vectorizer = new RestApiVectorizerAdapter();

// Allowed chapters for the Public Demo Agent
const ALLOWED_CATEGORIES = [
    'Albanileria',
    'Revestimientos',
    'Banos',
    'Cocinas',
    'Carpinteria Interior',
    'Pintura'
];

export const demoMaterialRetrieverTool = ai.defineTool(
    {
        name: 'demoMaterialRetriever',
        description: 'Searches for specific material products using semantic vector search. ONLY returns items allowed in the DEMO (bathrooms, kitchens, superficial reforms). DO NOT USE for structural, new build, or complex systems.',
        inputSchema: z.object({
            query: z.string().describe('The name or description of the material to find.'),
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
            error: z.string().optional()
        }),
    },
    async (input) => {
        try {
            console.log(`[Tool:DemoMaterialRetriever] Searching for: "${input.query}"`);

            // 1. Vectorize query
            const embedding = await vectorizer.embedText(input.query);

            // 2. Search Repository (pull more to allow for post-filtering if needed)
            const results = await materialRepo.searchByVector(embedding, input.limit * 3);

            // 3. Post-Filter: Strictly Enforce Demo Scope Categories
            const filteredResults = results.filter((item) => {
                const normalizedCategory = item.category?.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                return ALLOWED_CATEGORIES.some(allowed =>
                    normalizedCategory?.toLowerCase().includes(allowed.toLowerCase())
                );
            });

            const topResults = filteredResults.slice(0, input.limit);

            console.log(`[Tool:DemoMaterialRetriever] Found ${results.length} raw items, filtered to ${topResults.length} allowed items.`);

            if (topResults.length === 0) {
                return {
                    items: [],
                    error: "Item not available in Demo format. Scope is restricted to superficial renovations, kitchens, and bathrooms. Please inform the user that this item cannot be budgeted in the demo."
                };
            }

            // 4. Map to output
            return {
                items: topResults.map((item: MaterialItem) => ({
                    sku: item.sku || item.id || 'UNKNOWN',
                    name: item.name,
                    description: item.description,
                    price: item.price,
                    unit: item.unit,
                    category: item.category,
                }))
            };
        } catch (error) {
            console.error('[Tool:DemoMaterialRetriever] Error:', error);
            return { items: [], error: "Internal search error." };
        }
    }
);

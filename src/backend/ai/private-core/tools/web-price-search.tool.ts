import { ai } from '@/backend/ai/shared/config/genkit.config';
import { z } from 'zod';

export const webPriceSearchTool = ai.defineTool(
    {
        name: 'webPriceSearchTool',
        description: 'Searches (or estimates) the market price for a construction item in Spain when not found in the official Price Book.',
        inputSchema: z.object({
            query: z.string(),
        }),
        outputSchema: z.object({
            description: z.string(),
            price: z.number(),
            unit: z.string(),
            source: z.string(),
            confidence: z.number()
        }),
    },
    async (input) => {
        // Since we don't have a live SERP API configured in this environment,
        // we use the LLM's extensive internal knowledge to estimate the current market price in Spain.
        // This acts as a semantic fallback.

        const prompt = `
            You are an expert Construction Cost Estimator for Spain (2025-2026).
            The user is asking for the price of: "${input.query}".
            This item was NOT found in the database, so you must estimate it based on market knowledge.
            
            Return a JSON object with:
            - description: A technical description of the item.
            - price: The estimated Material Execution Price (PEM) per unit in EUR.
            - unit: The standard unit (m2, u, m, etc).
            - source: Cite "Estimación de Mercado (IA)" or a known database if applicable.
            - confidence: 0.0 to 1.0.

            Example:
            Input: "Ventana PVC"
            Output: { "description": "Ventana PVC oscilobatiente 1x1m doble acristalamiento", "price": 350.00, "unit": "u", "source": "Estimación Mercado", "confidence": 0.9 }
        `;

        const result = await ai.generate({
            model: 'googleai/gemini-2.0-flash-001', // Explicit stable version
            prompt: prompt,
            config: { temperature: 0.1 },
            output: {
                format: 'json',
                schema: z.object({
                    description: z.string(),
                    price: z.number(),
                    unit: z.string(),
                    source: z.string(),
                    confidence: z.number()
                })
            }
        });

        if (!result.output) {
            throw new Error("Failed to estimate price");
        }

        return result.output;
    }
);

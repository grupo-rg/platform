
import { ai } from '@/backend/ai/core/config/genkit.config';
import { z } from 'genkit';

const TriageOutputSchema = z.object({
    tool: z.enum(['budgetSearchAgent', 'estimationAgent', 'validationAgent', 'askUser']),
    reasoning: z.string(),
    parameters: z.object({
        query: z.string(),
        generic_query: z.string().optional(),
        intent: z.enum(['PARTIDA', 'MATERIAL', 'BOTH']).optional(),
        context: z.string().optional(),
    }),
});

export const triageAgent = ai.defineFlow(
    {
        name: 'triageAgent',
        inputSchema: z.object({
            userRequest: z.string(),
        }),
        outputSchema: TriageOutputSchema,
    },
    async (input) => {
        const prompt = `
        You are the Lead Budget Architect for Grupo RG, a construction company based in Mallorca.
        Your goal is to decide which specialist agent to use for the following request.
        
        Request: "${input.userRequest}"
        
        Specialists:
        - budgetSearchAgent: For MOST construction tasks, including specific materials and brands (e.g., "Keraben tiles", "PVC windows", "Rockwool insulation"). It searches our internal Price Book AND Material Catalogs. Use this even if a brand is mentioned.
        - estimationAgent: ONLY for extremely custom, artistic, or artisanal items where no standard price exists (e.g., "Hand-painted mural", "Antique goldleaf restoration", "Custom sculpture"). Do NOT use for branded construction materials.
        - askUser: Use this ONLY if the request is extremely ambiguous (e.g., "Change it" with no context).
        - validationAgent: (Not used for retrieval)
        
        Output valid JSON.
        `;

        const { safeGenerate } = await import('@/backend/ai/core/utils/safe-generation');
        const result = await safeGenerate({
            model: 'googleai/gemini-2.0-flash-001',
            prompt: prompt,
            output: {
                format: 'json',
                schema: TriageOutputSchema
            }
        });

        // Robust Type Casting
        const output = result.output as unknown as z.infer<typeof TriageOutputSchema>;

        if (!output) {
            // Fallback
            return {
                tool: 'askUser',
                reasoning: 'AI generation failed to produce valid output.',
                parameters: { query: input.userRequest }
            } as z.infer<typeof TriageOutputSchema>;
        }

        return output;
    }
);

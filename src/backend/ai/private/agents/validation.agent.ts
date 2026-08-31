import { ai } from '@/backend/ai/core/config/genkit.config';
import { z } from 'genkit';

export const validationAgent = ai.defineFlow(
    {
        name: 'validationAgent',
        inputSchema: z.object({
            items: z.array(z.string()).describe('List of item descriptions in the budget'),
            specs: z.any().optional(), // Project specs
        }),
        outputSchema: z.object({
            isValid: z.boolean(),
            issues: z.array(z.object({
                severity: z.enum(['low', 'medium', 'high']),
                message: z.string(),
                suggestion: z.string().optional(),
            })),
            overallScore: z.number().describe('0-100 score of technical coherence'),
        }),
    },
    async (input) => {
        const prompt = `
        You are a Senior Construction Technical Architect.
        Review the following list of budget items for a renovation project:
        
        ${input.items.map((item, i) => `${i + 1}. ${item}`).join('\n')}
        
        Check for:
        1. Missing dependencies (e.g., "Install tiles" but no "Adhesive" or "Grout" listed).
        2. Logical inconsistencies (e.g., "Demolish wall" and "Paint wall" on the same wall?).
        3. Missing essential preparatory steps (e.g., "Paint" without "Primer" or "Surface prep").
        
        Output valid JSON with issues found. If perfect, issue list is empty.
        `;

        const result = await ai.generate({
            model: 'vertexai/gemini-2.5-flash',
            prompt: prompt,
            output: {
                format: 'json',
                schema: z.object({
                    isValid: z.boolean(),
                    issues: z.array(z.object({
                        severity: z.enum(['low', 'medium', 'high']),
                        message: z.string(),
                        suggestion: z.string().optional(),
                    })),
                    overallScore: z.number(),
                })
            }
        });

        if (!result.output) {
            throw new Error("Validation failed to generate report");
        }

        return result.output;
    }
);

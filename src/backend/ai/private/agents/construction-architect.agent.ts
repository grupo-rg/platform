
import { ai } from '@/backend/ai/core/config/genkit.config';
import { resolveModel } from '@/backend/ai/core/config/model-registry';
import { z } from 'genkit';

// Input Schema: Project Description + Specs
const ConstructionArchitectInputSchema = z.object({
    projectDescription: z.string().describe("High-level description of the construction project"),
    totalArea: z.number().optional().describe("Total area of the project in m2"),
});

// Output Schema: List of Chapters
const ConstructionArchitectOutputSchema = z.object({
    chapters: z.array(z.object({
        name: z.string().describe("Name of the construction chapter (e.g., Demolition, Foundation)"),
        description: z.string().describe("What this chapter includes for this specific project"),
        estimatedComplexity: z.enum(['LOW', 'MEDIUM', 'HIGH']).describe("Complexity of this chapter"),
        approxQuantity: z.number().describe("Approximated quantity for this chapter (e.g. m2 of walls, number of doors)"),
        unit: z.string().describe("Unit of measurement for the chapter (m2, m3, ud, ml)"),
    })).describe("List of construction chapters derived from the project description"),
});

export const constructionArchitectAgent = ai.defineFlow(
    {
        name: 'constructionArchitectAgent',
        inputSchema: ConstructionArchitectInputSchema,
        outputSchema: ConstructionArchitectOutputSchema,
    },
    async (input) => {
        const { projectDescription, totalArea } = input;

        console.log(`[ConstructionArchitect] Analyzing project: "${projectDescription}" (Area: ${totalArea} m2)`);

        const prompt = `
            You are a Senior Architect and Construction Manager.
            Your task is to structure a construction project into standard chapters (Capítulos).
            
            Project: "${projectDescription}"
            Total Area: ${totalArea || 'Unknown'} m2
            
            Rules:
            1. Use standard Spanish construction chapters.
            2. Only include relevant chapters.
            3. ESTIMATE QUANTITIES: detailed estimation based on the Total Area.
               - For Flooring/Painting: usually matches Total Area (minus walls) or wall surface (Area x 3).
               - For Demolition: estimate m2 or m3.
               - For Kitchen/Bath: use 'ud' (units) if it's a renovation of a room, or m2 if flooring.
            
            Return a JSON object with a 'chapters' array, including 'approxQuantity' and 'unit'.
        `;

        const { safeGenerate } = await import('@/backend/ai/core/utils/safe-generation');
        const result = await safeGenerate({
            model: (await resolveModel('architect')).prefixed,
            prompt: prompt,
            output: {
                format: 'json',
                schema: ConstructionArchitectOutputSchema
            }
        });

        const output = result.output as unknown as z.infer<typeof ConstructionArchitectOutputSchema>;

        if (!output) {
            throw new Error("Architect failed to generate chapters");
        }

        console.log(`[ConstructionArchitect] Identified ${output.chapters.length} chapters.`);
        return output;
    }
);

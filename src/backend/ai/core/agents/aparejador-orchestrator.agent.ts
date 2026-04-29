import { ai } from '@/backend/ai/core/config/genkit.config';
import { z } from 'genkit';
import { ProjectSpecs } from '@/backend/budget/domain/project-specs';

// ─── Schemas ────────────────────────────────────────────────────────────────

export const AparejadorOrchestratorInputSchema = z.object({
    userId: z.string().optional(),
    userMessage: z.string().describe("The natural language request or description of the project."),
    specs: z.custom<ProjectSpecs>().optional().describe("Basic specs gathered by Conserje if coming from Public flow."),
    history: z.array(
        z.object({
            role: z.enum(['user', 'model', 'system']),
            content: z.array(z.any())
        })
    ).optional(),
});

const ConstructionPhaseSchema = z.object({
    category: z.string().describe("E.g., 'Demoliciones', 'Albañilería', 'Fontanería'"),
    description: z.string().describe("Explanation of what needs to be done in this phase"),
    estimatedItems: z.array(z.object({
        task: z.string().describe("Specific construction task description (e.g., 'Colocación de azulejo cerámico 30x60 cm en baño')"),
        estimatedQuantity: z.number().describe("Estimated quantity based on project area/scope. Use realistic measurements."),
        unit: z.string().describe("Unit of measurement: m2, ml, ud, m3, kg, h, pa, etc.")
    })).describe("List of specific tasks with estimated quantities")
});

const AparejadorOutputSchema = z.object({
    projectScale: z.enum(['Obra Mayor', 'Obra Menor']),
    phases: z.array(ConstructionPhaseSchema),
    reasoning: z.string().describe("The surveyor's thought process behind the generated structure."),
    needsArchitect: z.boolean().describe("True if structural or legal implications require a certified architect (e.g., Obra Mayor)")
});

// ─── Aparejador Orchestrator Flow ────────────────────────────────────────────

export const aparejadorOrchestratorAgent = ai.defineFlow(
    {
        name: 'aparejadorOrchestratorAgent',
        inputSchema: AparejadorOrchestratorInputSchema,
        outputSchema: AparejadorOutputSchema,
    },
    async (input) => {
        console.log(`[AparejadorOrchestrator] Analyzing NLP request to define project structure.`);

        const totalArea = input.specs?.totalArea || 0;
        const propertyType = input.specs?.propertyType || 'unknown';
        const interventionType = input.specs?.interventionType || 'unknown';

        const { companyConfigService } = await import('@/backend/platform/application/company-config-service');
        const company = await companyConfigService.get();

        const prompt = `
        You are the Master Orchestrator (Aparejador / Quantity Surveyor) for ${company.name} Construction.
        A user has requested a budget via Natural Language (NLP).
        
        Your job is NOT to fetch prices yet. Your job is to structure the project into logical construction Phases (Capítulos)
        AND to estimate realistic QUANTITIES for each task based on the project dimensions.
        
        User's Request: "${input.userMessage}"
        
        Provided Specs:
        - Property Type: ${propertyType}
        - Intervention Type: ${interventionType}
        - Total Area: ${totalArea} m²
        ${JSON.stringify(input.specs || {}, null, 2)}
        
        Task:
        1. Classify the Project Scale:
           - "Obra Mayor": Involves structural changes (walls, beams), building extensions, changing the use of the property, or structural facades/roofs.
           - "Obra Menor": Interior renovations, painting, flooring, bathroom/kitchen updates WITHOUT moving structural walls.
        
        2. Define the Construction Phases (Capítulos):
           - If "Obra Mayor", MUST include "Seguridad y Salud", "Gestión de Residuos", and usually "Demoliciones" and "Estructura".
           - Always use standard Spanish construction terminology (e.g., "Albañilería", "Revestimientos", "Instalaciones de Fontanería", "Carpintería Interior").
        
        3. For each phase, list specific tasks with ESTIMATED QUANTITIES:
           - Be specific: instead of "tiles", write "Colocación de azulejo cerámico 30x60 cm en baño".
           - Use the total area (${totalArea} m²) to derive realistic quantities:
             * Demoliciones: typically covers 60-80% of total area
             * Solados: typically equals total area for flooring
             * Alicatados (wall tiling): calculate from room perimeters × height (aprox 2.5m), typically bathrooms 10-15 m² per bathroom, kitchen 8-12 m²
             * Pintura: typically 2.5-3x the floor area (walls + ceiling)
             * Falso techo: typically 80-100% of total area
             * Fontanería/Electricidad: use "ud" (units) for points, "ml" for tubing runs
             * Carpintería: count doors/windows as "ud"
           - If total area is 0 or unknown, estimate conservatively based on the property type.
           - Units should be: m2, ml, ud, m3, kg, h, pa (partida alzada)
        
        Return ONLY valid JSON matching the output schema.
        `;

        const { safeGenerate } = await import('@/backend/ai/core/utils/safe-generation');

        const result = await safeGenerate({
            model: 'googleai/gemini-2.0-flash-001',
            prompt: prompt,
            output: {
                format: 'json',
                schema: AparejadorOutputSchema
            }
        });

        // Safe cast: safeGenerate returns unknown output, cast via unknown first
        return result.output as unknown as z.infer<typeof AparejadorOutputSchema>;
    }
);

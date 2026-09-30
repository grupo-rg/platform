import { z } from 'genkit';
import { ai, geminiFlash } from '@/backend/ai/core/config/genkit.config';
import { BudgetRequirement } from '@/backend/budget/domain/budget-requirements';
import { materialRetrieverTool } from '@/backend/ai/core/tools/material-retriever.tool';

// Define the input schema for the flow
const ClientRequirementsInput = z.object({
    userMessage: z.string(),
    history: z.array(z.object({
        role: z.enum(['user', 'model']),
        content: z.array(z.object({ text: z.string() }))
    })).optional(),
    currentRequirements: z.custom<Partial<BudgetRequirement>>().optional(),
});

// Define the output schema
const ClientRequirementsOutput = z.object({
    response: z.string(),
    updatedRequirements: z.custom<Partial<BudgetRequirement>>(),
    nextQuestion: z.string().nullable().optional(),
    isComplete: z.boolean(),
});

export const clientRequirementsFlow = ai.defineFlow(
    {
        name: 'clientRequirementsFlow',
        inputSchema: ClientRequirementsInput,
        outputSchema: ClientRequirementsOutput,
    },
    async (input) => {
        const { userMessage, history = [], currentRequirements = {} } = input;

        // Define Zod schemas for the LLM to understand the structure
        const ProjectSpecsSchema = z.object({
            propertyType: z.enum(['flat', 'house', 'office']).optional().describe("Type of property: 'flat' (Piso), 'house' (Casa), 'office' (Oficina)"),
            interventionType: z.enum(['total', 'partial', 'new_build']).optional().describe("Scope of work: 'total' (Integral), 'partial' (Parcial), 'new_build' (Obra Nueva)"),
            totalArea: z.number().optional().describe("Total area in square meters"),
            qualityLevel: z.enum(['basic', 'medium', 'premium', 'luxury']).optional().describe("General quality level requested"),
            demolition: z.boolean().optional(),
            elevator: z.boolean().optional(),
            parking: z.boolean().optional(),
            description: z.string().optional(),
        });

        const DetectedNeedSchema = z.object({
            category: z.string().describe("Category of the need (e.g., 'Flooring', 'Painting')"),
            description: z.string().describe("Detail of the need"),
            estimatedQuantity: z.number().optional(),
            unit: z.string().optional()
        });

        const BudgetRequirementSchema = z.object({
            specs: ProjectSpecsSchema.optional().describe("Technical specifications of the project"),
            targetBudget: z.string().optional().describe("User's budget constraint if mentioned"),
            urgency: z.string().optional().describe("When they want to start"),
            detectedNeeds: z.array(DetectedNeedSchema).optional().describe("List of specific needs identified")
        });

        // 1. Analysis Step: Extract requirements and determine next steps
        const analysisPrompt = `
      You are "Conserje", an expert Quantity Surveyor (Aparejador) and Architect for PriceCloud.
      Your goal is to gather PRECISE technical requirements for a renovation budget.
      
      Current Requirements State: ${JSON.stringify(currentRequirements, null, 2)}
      
      User's latest message: "${userMessage}"
      Conversation History: ${JSON.stringify(history)}
      
      BEHAVIOR GUIDELINES:
      - **BE PROACTIVE & FAST**: Do NOT repeat or echo back what the user just said. Just update your internal state and ask the NEXT question immediately.
      - **Tone**: Professional, direct, and efficient.
      - **Multi-intent**: Accept multiple details at once.
      - **Tools**: Use materialRetriever if asked for prices.
      
      Task:
      1. Analyze the user's message and history.
      2. Extract new inputs mapping to the schema.
      3. CRITICAL: MAPPING RULES:
         - "Piso" -> propertyType: 'flat'
         - "Casa/Chalet" -> propertyType: 'house'
         - "Reforma integral" -> interventionType: 'total'
         - "Reforma parcial" -> interventionType: 'partial'
         - "Calidad media" -> qualityLevel: 'medium'
      4. Place technical details (area, type, scope, quality) INSIDE the 'specs' object.
      5. Generate a response asking the next missing question.
      
      CRITICAL OUTPUT INSTRUCTIONS:
      - Return ONLY valid JSON matching the schema.
      - Ensure 'isComplete' is true ONLY if you have: Type, Scope, Area, and Quality.
      - 'response' must be under 40 words.
    `;

        const extractionSchema = z.object({
            updatedRequirements: BudgetRequirementSchema.optional().default({}),
            response: z.string(),
            nextQuestion: z.string().nullable().optional(),
            missingFields: z.array(z.string()).optional().default([]),
            isComplete: z.boolean().describe("Set to true if Type, Scope, Area, and Quality are all gathered."),
        });

        const llmResponse = await ai.generate({
            model: geminiFlash,
            prompt: analysisPrompt,
            tools: [materialRetrieverTool],
            output: { schema: extractionSchema },
            config: {
                temperature: 0.3,
                maxOutputTokens: 8192
            },
        });

        const result = llmResponse.output;

        if (!result) {
            console.error("LLM returned null or invalid JSON");
            throw new Error("Failed to generate analysis - Model returned empty");
        }

        // Deep merge logic for specs
        const newReqs = result.updatedRequirements || {};
        const oldReqs = currentRequirements || {};

        const mergedRequirements = {
            ...oldReqs,
            ...newReqs,
            specs: {
                ...(oldReqs.specs || {}),
                ...(newReqs.specs || {})
            },
            detectedNeeds: [
                ...(oldReqs.detectedNeeds || []),
                ...(newReqs.detectedNeeds || [])
            ]
        };

        return {
            response: result.response,
            updatedRequirements: mergedRequirements,
            nextQuestion: result.nextQuestion,
            isComplete: result.isComplete || false
        };
    }
);

import { z } from 'genkit';
import { ai, gemini25Flash } from '@/backend/ai/shared/config/genkit.config';
import { generateWithRetry } from '@/backend/ai/shared/utils/ai-retry';
import { BudgetRequirement } from '@/backend/budget/domain/budget-requirements';
import { materialRetrieverTool } from '@/backend/ai/private-core/tools/material-retriever.tool';

// Define the input schema for the flow
const ClientRequirementsInput = z.object({
    userMessage: z.string(),
    history: z.array(z.object({
        role: z.enum(['user', 'model']),
        content: z.array(z.object({ text: z.string() }))
    })).optional(),
    currentRequirements: z.custom<Partial<BudgetRequirement>>().optional(),
    attachments: z.array(z.string()).optional(),
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
        const { userMessage, history = [], currentRequirements = {}, attachments = [] } = input;

        // Define Zod schemas for the LLM to understand the structure
        const RoomSpecsSchema = z.object({
            area: z.number().describe("Area of the room in square meters"),
            height: z.number().optional().describe("Height of the room"),
            perimeter: z.number().optional().describe("Perimeter of the room"),
        });

        const BathroomSpecsSchema = z.object({
            area: z.number().describe("Area of the bathroom"),
            hasShower: z.boolean().optional().describe("Whether it will have a shower (plato de ducha)"),
            hasBathtub: z.boolean().optional().describe("Whether it will have a bathtub (bañera)"),
            quality: z.enum(['basic', 'medium', 'premium']).describe("Quality level of the bathroom"),
        });

        const KitchenSpecsSchema = z.object({
            area: z.number().describe("Area of the kitchen"),
            island: z.boolean().optional().describe("Whether it has an island"),
            quality: z.enum(['basic', 'medium', 'premium']).describe("Quality level of the kitchen"),
        });

        const ProjectSpecsSchema = z.object({
            propertyType: z.enum(['flat', 'house', 'office']).optional().describe("Type of property: 'flat' (Piso), 'house' (Casa/Chalet/Unifamiliar), 'office' (Oficina)"),
            interventionType: z.enum(['total', 'partial', 'new_build']).optional().describe("Scope of work: 'total' (Integral), 'partial' (Parcial), 'new_build' (Obra Nueva)"),
            totalArea: z.number().optional().describe("Total area in square meters"),
            qualityLevel: z.enum(['basic', 'medium', 'premium', 'luxury']).optional().describe("General quality level requested"),
            terrainType: z.enum(['flat', 'sloped', 'rocky']).optional().describe("VITAL PARA OBRA NUEVA: Si el usuario quiere construir una casa nueva, pregúntale discretamente si el solar es llano ('flat'), inclinado ('sloped') o si hay roca ('rocky')."),
            machineryAccess: z.enum(['good', 'poor', 'restricted']).optional().describe("Accesibilidad para maquinaria pesada al solar."),
            rooms: z.array(RoomSpecsSchema).optional().describe("List of standard rooms/bedrooms"),
            bathrooms: z.array(BathroomSpecsSchema).optional().describe("List of bathrooms"),
            kitchens: z.array(KitchenSpecsSchema).optional().describe("List of kitchens"),
            demolition: z.boolean().optional().describe("Whether demolition is needed"),
            elevator: z.boolean().optional().describe("Does the building have an elevator?"),
            parking: z.boolean().optional().describe("Does it include parking work?"),
            description: z.string().optional().describe("General description of the project spec if not broken down into rooms")
        });

        const DetectedNeedSchema = z.object({
            category: z.string().describe("Category of the need (e.g., 'Flooring', 'Painting')"),
            description: z.string().describe("Detail of the need"),
            requestedMaterial: z.string().optional().describe("Material exacto o acabado solicitado explícitamente por el usuario (ej: 'piedra mallorquina', 'suelo laminado'). ¡CRÍTICO! Si el usuario no menciona explícitamente materiales, déjalo vacío."),
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
      You are an expert Data Extractor for a Construction Budget system.
      Tu único objetivo es extraer los requerimientos técnicos descritos por el usuario en el chat y guardarlos en el esquema JSON, sin hacer tú de Arquitecto.
      
      Current Requirements State: ${JSON.stringify(currentRequirements, null, 2)}
      
      User's latest message: "${userMessage}"
      Attachments (PDF/Images): ${attachments.length > 0 ? JSON.stringify(attachments) : 'None'}
      Conversation History: ${JSON.stringify(history)}
      
      BEHAVIOR GUIDELINES:
      - **SILENT EXTRACTION**: Tú NO eres el Arquitecto. Tú SOLO extraes entidades y pides clarificaciones críticas.
      - **EXTRACCIÓN EXHAUSTIVA DETALLADA**: DEBES leer cada adjetivo del usuario (ej. "acabados de lujo", "aislamientos gruesos", "terreno de roca viva", "acceso complicado") y convertir CADA UNO en un objeto separado dentro de \`detectedNeeds\`. ¡NO TE DEJES NINGÚN DETALLE!
      - **MANDATO DE OBRA NUEVA**: Si detectas que es una "Obra Nueva" (\`new_build\`), es **CRÍTICO Y OBLIGATORIO** conocer el \`terrainType\` y \`machineryAccess\`. Si el usuario no lo ha dicho todo, DEBES poner \`isComplete: false\` y hacer la pregunta. 
      - **NO HAGAS OTRAS PREGUNTAS**: Para reformas parciales, asume valores estándar y pon \`isComplete: true\`.
      
      Task:
      1. Analyze the user's message and history.
      2. Extract new inputs mapping to the schema.
      3. CRITICAL: MAPPING RULES:
         - "Obra nueva", "Construir vivienda", "terreno" -> interventionType: 'new_build', category: 'ESTRUCTURA_OBRA_MAYOR'.
         - "Reforma integral" -> interventionType: 'total'
         - Extrae las áreas en m2 siempre que existan.
      4. REGLA DE DETECTED NEEDS: Cualquier material específico explícito, acabado (ej. "lujo"), complicación del terreno ("roca") o aislamiento, DEBE registrarse como un objeto independiente en \`detectedNeeds\` con su \`category\` apropiada, \`description\` detallada, y el \`requestedMaterial\` extraído exactamente.
      5. Si es Obra Mayor, SIEMPRE añade un \`detectedNeed\` con category "ESTRUCTURA_OBRA_MAYOR" describiendo el reto principal.
      
      CRITICAL OUTPUT INSTRUCTIONS:
      - Output a single flat JSON object meeting the exact schema structure.
      - DEBES incluir OBLIGATORIAMENTE la clave "response" en la raíz del JSON con tu respuesta conversacional (menos de 40 palabras).
      - **REGLA DE BLOQUEO (\`isComplete\`)**: Esta clave ES OBLIGATORIA SIEMPRE. Si es \`interventionType: new_build\` Y falta \`terrainType\` o \`machineryAccess\` o \`totalArea\`, ENTONCES \`isComplete\` DEBE SER \`false\` y debes formular la \`nextQuestion\`. De lo contrario, \`isComplete: true\`. ¡Incluso si una herramienta (Tool) falla, NUNCA olvides omitir la clave \`isComplete\`!
    `;

        const extractionSchema = z.object({
            response: z.string().describe("Mensaje conversacional directo para el usuario (menos de 40 palabras). OBLIGATORIO."),
            updatedRequirements: BudgetRequirementSchema.optional().default({}).describe("Información técnica extraída del usuario."),
            nextQuestion: z.string().nullable().optional(),
            missingFields: z.array(z.string()).optional().default([]),
            isComplete: z.boolean().describe("true si tienes info ESTRICTA suficiente, false si necesitas preguntar métricas críticas."),
        });

        const llmResponse = await generateWithRetry({
            model: gemini25Flash,
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

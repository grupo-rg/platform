import { z } from 'genkit';
import { ai } from '@/backend/ai/shared/config/genkit.config';

// Extracted Schema
export const SubtaskExtractionSchema = ai.defineSchema(
    'SubtaskExtractionSchema',
    z.object({
        subtasks: z.array(z.object({
            searchQuery: z.string().describe("Specific search query for price book"),
            quantity: z.number().describe("Estimated quantity"),
            unit: z.string().describe("m2, u, m, etc."),
            reasoning: z.string().optional()
        })).describe("List of construction tasks found in the request"),
    })
);

/**
 * Centralized Prompt Registry for the entire multi-agent system.
 * This pattern replaces runtime filesystem lookups (.prompt files) with scalable, 
 * statically verifiable code structures, preventing "not found" serverless errors.
 */
export const Prompts = {
    SubtaskExtraction: {
        system: `You are an expert Construction Cost Estimator and Technical Architect in Spain.
Your goal is to break down a User's renovation request into specific, searchable breakdown items (subtasks) that can be found in a Spanish Price Book (Preoc, Guadalajara, IVE).

**Core Instructions:**
1.  **Analyze** the request to understand the full scope (implicit and explicit).
2.  **Break Down** the work into granular construction tasks (Demolitions, Masonry, Installations, Finishes).
3.  **Search Query**: Create a distinct, technical Spanish search query for each task (e.g., use "Solera" instead of "Suelo de cemento").
4.  **Quantify**: Estimate quantities based on the dimensions provided or standard architectural ratios.
    *   *Ratio Example*: For a 100m2 flat, Painting is approx 2.5x floor area (walls + ceiling) = 250m2.
    *   *Ratio Example*: Skirting is approx Perimeter = sqrt(Area)*4.
5.  **Output**: Return a JSON list of subtasks.

**Handling "Reforma Integral" (Full Renovation):**
If the user asks for a "Reforma Integral" or "Obra Nueva" efficiently, do NOT list every single screw. Instead, group by major chapters:
*   Demoliciones completas
*   Tabiquería
*   Instalación Fontanería (puntos)
*   Instalación Electricidad (puntos)
*   Alicatados y Solados
*   Carpintería (Puertas/Ventanas)
*   Pintura`,
        fewShotHistory: [
            {
                role: 'user' as const,
                content: [{ text: 'Request: "Cambiar el suelo de la cocina de 10m2"' }]
            },
            {
                role: 'model' as const,
                content: [{
                    text: JSON.stringify({
                        subtasks: [
                            { searchQuery: "Demolición pavimento cerámico con compresor", quantity: 10, unit: "m2", reasoning: "Same area as floor to remove." },
                            { searchQuery: "Carga manual de escombros y transporte a contenedor", quantity: 1, unit: "m3", reasoning: "Approx 0.1m thickness * 10m2 = 1m3 debris." },
                            { searchQuery: "Solera de nivelación pasta niveladora", quantity: 10, unit: "m2", reasoning: "Preparation for new floor." },
                            { searchQuery: "Suministro y colocación pavimento gres porcelánico", quantity: 10, unit: "m2", reasoning: "Net area." },
                            { searchQuery: "Rodapié gres porcelánico", quantity: 13, unit: "m", reasoning: "Perimeter: sqrt(10)*4 ≈ 12.6m. Round up." }
                        ]
                    })
                }]
            },
            {
                role: 'user' as const,
                content: [{ text: 'Request: "Instalar 5 ventanas de PVC blanco oscilobatientes de 1.20x1.20"' }]
            },
            {
                role: 'model' as const,
                content: [{
                    text: JSON.stringify({
                        subtasks: [
                            { searchQuery: "Ventana PVC blanco oscilobatiente 120x120 con persiana", quantity: 5, unit: "ud", reasoning: "Explicit user request." },
                            { searchQuery: "Recibido de cerco de ventana/puerta exterior", quantity: 24, unit: "m", reasoning: "Perimeter of frames: (1.2+1.2)*2 = 4.8m * 5 windows = 24m." },
                            { searchQuery: "Sellado perimetral carpintería exterior silicona neutra", quantity: 24, unit: "m", reasoning: "Same as frame perimeter." }
                        ]
                    })
                }]
            },
        ],
        buildUserMessage: (userRequest: string) => `Request: "${userRequest}"`
    }
};

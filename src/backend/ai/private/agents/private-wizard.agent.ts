import { ai, gemini25Flash } from '@/backend/ai/core/config/genkit.config';
import { z } from 'zod';
import { processMeasurementDocumentTool } from '../tools/process-measurement-document.tool';
import { generateRenovationRenderTool } from '../tools/generate-renovation-render.tool';

export const PrivateWizardAgentInputSchema = z.object({
    userId: z.string(),
    userMessage: z.string(),
    documentBase64: z.string().optional().describe('Uploaded Measurement Document PDF'),
    imagesBase64: z.array(z.string()).optional().describe("Array of base64 encoded images uploaded by the user"),
    history: z.array(
        z.object({
            role: z.enum(['user', 'model', 'system']),
            content: z.array(z.any())
        })
    ).optional(),
});

export const PrivateWizardOutputSchema = z.object({
    reply: z.string().optional(),
    updatedRequirements: z.object({
        projectScale: z.enum(['minor', 'major', 'unknown']).optional().describe("'major' = structural/extension/change-of-use. 'minor' = interior reform without touching structure."),
        phaseChecklist: z.record(z.enum(['pending', 'addressed', 'not_applicable'])).optional().describe("Track each construction chapter. Keys are chapter names like 'Demoliciones', 'Fontanería'. Values: 'pending' | 'addressed' | 'not_applicable'."),
        activeBatchJobId: z.string().optional(),
        completedBudgetId: z.string().optional(),
        completedBudgetTotal: z.number().optional(),
        completedBudgetItems: z.number().optional(),
        isReadyForGeneration: z.boolean().optional().describe("Set to true ONLY when you have enough information to generate a full budget: scale is classified, all mandatory phases are addressed or marked N/A, and user has confirmed the scope.")
    }).passthrough().optional()
});

export const privateWizardAgent = ai.defineFlow(
    {
        name: 'privateWizardAgent',
        inputSchema: PrivateWizardAgentInputSchema,
    },
    async (input) => {
        console.log(`[PrivateWizardAgent] Processing message from user: ${input.userId}`);

        const { companyConfigService } = await import('@/backend/platform/application/company-config-service');
        const company = await companyConfigService.get();

        const systemPrompt = `
Eres el Asistente Privado de ${company.name} Construction. Actúas como un APAREJADOR (Arquitecto Técnico) experto en presupuestación de obras en España.

Tu OBJETIVO es reunir la información MÍNIMA NECESARIA para presupuestar, con eficiencia y respetando el tiempo del usuario. NO sigues un guion fijo: te adaptas a lo que el usuario YA ha dicho y solo preguntas lo que falta. (Esta lógica es idéntica a la de buildSystemPrompt — mantener ambas en sync.)

═══════════════════════════════════════════
🧠 PASO 0 — EXTRAE ANTES DE PREGUNTAR (siempre lo primero)
═══════════════════════════════════════════
Antes de formular NINGUNA pregunta, lee el mensaje inicial y TODO el historial y extrae lo que el usuario YA dijo: tipo de inmueble, superficie, alcance, capítulos, materiales, patologías y —clave— qué elementos se SUSTITUYEN por completo vs cuáles se reparan/mantienen. Rellena el 'phaseChecklist' marcando 'addressed' todo lo que ya esté claro; solo lo que falte queda 'pending'.

═══════════════════════════════════════════
✅ REGLA DE ORO — NO PREGUNTES LO YA RESPONDIDO
═══════════════════════════════════════════
- NUNCA preguntes algo respondido explícita o implícitamente.
- Si el usuario dice "renovación/sustitución COMPLETA de X" (fontanería, electricidad, alicatado…), el alcance de X está RESUELTO: NO preguntes por su estado actual — es irrelevante, se retira y se instala nuevo igual. El estado actual solo importa para decidir entre reparar y sustituir, y aquí ya está decidido.
- Ante cada posible pregunta, pregúntate: "¿la respuesta cambia las partidas o cantidades del presupuesto?". Si no, no la hagas.

═══════════════════════════════════════════
🎯 QUÉ SÍ PREGUNTAR (solo si falta Y cambia el presupuesto)
═══════════════════════════════════════════
Superficie (si no se dio) · tipo de inmueble (afecta escala/licencias) · GAMA de materiales (económica/media/alta — cambia mucho el precio) · cantidades o acabados ambiguos · patologías que añaden capítulos (humedades, grietas) · si se mueven tabiques / se toca estructura (obra menor vs mayor). Planta y ascensor SOLO en obras con retirada/subida de material relevante; para un baño pequeño no lo fuerces.

═══════════════════════════════════════════
🗣️ CÓMO PREGUNTAR — DINÁMICO, NO INTERROGATORIO
═══════════════════════════════════════════
- UNA pregunta por turno SOLO para ambigüedades reales que cambian el presupuesto.
- Para huecos menores o supuestos razonables, CONFIRMA EN LOTE en vez de preguntar uno a uno: "Asumo [X, Y, Z]. ¿Correcto o ajusto algo?".
- Si el mensaje inicial ya es un briefing completo (alcance + capítulos + materiales), NO alargues: haz un resumen de confirmación y, con el OK, marca 'isReadyForGeneration: true'.
- Si el inmueble es antiguo y el usuario NO mencionó una instalación relevante, PUEDES sugerirla como recomendación (no interrogatorio) — y NUNCA si ya dijo que se renueva.

═══════════════════════════════════════════
🚨 GAPS DE ALTO RIESGO EN REFORMA INTEGRAL (zona húmeda / electricidad)
═══════════════════════════════════════════
En reformas INTEGRALES o renovaciones COMPLETAS (baño, cocina o vivienda entera) hay partidas que el oficio da por hechas y que los clientes casi nunca nombran, pero cuya omisión infravalora el presupuesto ~30-40% y genera reclamaciones seguras:
- 🚿 IMPERMEABILIZACIÓN de la zona de ducha / suelo húmedo del baño (antes de solar y alicatar).
- ⚡ ELECTRICIDAD básica de la estancia: al menos punto de luz y punto para extractor/ventilación (en cocina, además tomas para electrodomésticos).
Antes de marcar 'isReadyForGeneration: true' en una reforma integral, VERIFICA que ambos gaps están cubiertos en 'phaseChecklist'/'detectedNeeds'. Si NO se han tratado y NO se deducen ya de lo que el usuario dijo, SEÑÁLALOS EN LOTE como recomendación y confirma inclusión/exclusión en un solo turno — ej.: "Para una reforma integral de baño asumo que incluimos impermeabilización de la ducha y un punto de luz + extractor. ¿Los incluyo o los dejamos fuera?" — NO como interrogatorio pregunta-a-pregunta.
RESPETA la regla anti-redundancia: si el usuario ya dijo "renovación completa de electricidad" o "rehacer la ducha con impermeabilización", NO vuelvas a preguntar — márcalo 'addressed' y añádelo a 'detectedNeeds'. Si el usuario decide EXCLUIRLOS conscientemente, márcalos 'not_applicable' y déjalo escrito de forma EXPLÍCITA en el 'finalBrief' como exclusión deliberada (no como olvido).
Esto NO aplica a intervenciones parciales/puntuales (cambiar un sanitario, repintar, sustituir grifería): ahí NO fuerces estos capítulos.

═══════════════════════════════════════════
📊 CLASIFICACIÓN DE ESCALA
═══════════════════════════════════════════
Clasifica 'updatedRequirements.projectScale': 'major' (estructura, ampliación, cambio de uso, fachada, cubierta) o 'minor' (reforma interior sin tocar estructura). Informa breve de la clasificación y sus implicaciones (licencia menor vs proyecto), sin volverlo pesado.

═══════════════════════════════════════════
📋 CAPÍTULOS (phaseChecklist)
═══════════════════════════════════════════
Mantén el 'phaseChecklist' con los capítulos aplicables: 'addressed' con info suficiente, 'not_applicable' si no aplica, 'pending' si falta detalle material.

**CUANDO ESTÁS LISTO**: cuando todos los capítulos relevantes estén 'addressed' o 'not_applicable' y el usuario confirme (recuérdale antes un 10-15% de contingencias y que el admin asignará cliente tras generar), establece 'isReadyForGeneration: true'.

Al marcar 'isReadyForGeneration: true' es **OBLIGATORIO** que también incluyas:
- **finalBrief**: un resumen técnico consolidado (4-8 frases) con TODOS los detalles específicos del proyecto: tipo de inmueble, superficie, escala, patologías, y la lista explícita de trabajos a presupuestar con sus materiales/instalaciones concretas. Este brief se envía al motor de búsqueda de precios (RAG), así que cuanto más específico seas en materiales, unidades y cantidades, mejores precios obtendremos. Ejemplo:
  "Reforma de cocina de 12 m² en vivienda de 1998 (4ª planta sin ascensor), escala minor. Trabajos: demolición de alicatado existente, alisado de paredes, nueva instalación de tuberías de cobre, cableado eléctrico para electrodomésticos de alta potencia, suelo cerámico 60x60, pintura plástica. Patologías: humedades visibles. Sin redistribución de tabiques. No se incluye mobiliario de cocina."
- **detectedNeeds**: array con una entrada por cada tarea concreta que el cliente ha pedido, con la forma \`{"category": "Capítulo", "description": "Descripción física", "requestedMaterial": "material específico si lo hay"}\`. Si el cliente no mencionó material, omite requestedMaterial.

═══════════════════════════════════════════
📋 REGLAS DE CONVERSACIÓN Y HERRAMIENTAS
═══════════════════════════════════════════
1. Haz SOLO UNA PREGUNTA por turno.
2. Usa emojis técnicos con moderación (🏗️ 🔧 ⚡ 🚿 🪟).
3. **SI EL USUARIO ADJUNTA UN PDF DE MEDICIONES:** Eres un Supervisor. DEBES utilizar la herramienta 'processMeasurementDocument'. El flujo de extracción preserva INTACTAS las descripciones originales. Si la herramienta responde 'PROCESSING_BACKGROUND', dile al usuario que tardará unos minutos.
4. Tono: profesional, técnico pero accesible.

═══════════════════════════════════════════
⚙️ FORMATO DE RESPUESTA OBLIGATORIO
═══════════════════════════════════════════
Siempre debes contestar con un mensaje de texto normal para el usuario, y AL FINAL DE TU MENSAJE añadir OBLIGATORIAMENTE un bloque de código JSON con las variables actualizadas.
Ejemplo (fase intermedia, aún recogiendo datos):

[Tu respuesta de texto aquí para el usuario]

\`\`\`json
{
  "specs": {
    "propertyType": "Vivienda",
    "interventionType": "Reforma Integral",
    "totalArea": "90"
  },
  "targetBudget": "15000",
  "urgency": "Alta",
  "projectScale": "major",
  "phaseChecklist": {
    "Demoliciones": "addressed",
    "Fontaneria": "pending"
  },
  "isReadyForGeneration": false
}
\`\`\`

Ejemplo (LISTO — siempre incluye finalBrief y detectedNeeds):

[Tu respuesta de confirmación para el usuario]

\`\`\`json
{
  "specs": {
    "propertyType": "Vivienda",
    "interventionType": "Reforma Parcial",
    "totalArea": "12"
  },
  "projectScale": "minor",
  "phaseChecklist": {
    "Demoliciones": "addressed",
    "Albañilería": "addressed",
    "Fontanería": "addressed",
    "Electricidad": "addressed",
    "Pintura": "addressed",
    "Mobiliario de Cocina": "not_applicable"
  },
  "finalBrief": "Reforma de cocina de 12 m² en vivienda de 1998 (4ª planta sin ascensor), escala minor. Trabajos: demolición de alicatado existente, alisado de paredes, nueva instalación de tuberías de cobre, cableado eléctrico para electrodomésticos de alta potencia, suelo cerámico 60x60, pintura plástica. Patologías: humedades visibles. Sin redistribución de tabiques. No se incluye mobiliario de cocina.",
  "detectedNeeds": [
    { "category": "DEMOLICIONES", "description": "Demolición de alicatado existente en 12 m² de cocina" },
    { "category": "REVOCOS Y ENLUCIDOS", "description": "Alisado de paredes tras demolición" },
    { "category": "FONTANERIA Y GAS", "description": "Nueva instalación de tuberías", "requestedMaterial": "cobre" },
    { "category": "ELECTRICIDAD Y TELECOMUNICACIONES", "description": "Cableado eléctrico para electrodomésticos de alta potencia" },
    { "category": "SOLADOS Y ALICATADOS", "description": "Suministro e instalación de suelo cerámico 60x60 en 12 m²" },
    { "category": "PINTURA Y REVESTIMIENTOS", "description": "Pintura plástica en paredes de cocina" }
  ],
  "isReadyForGeneration": true
}
\`\`\`
        `;

        let cleanHistory = input.history ? [...input.history] : [];

        // Gemini strictly requires the conversation history to start with a 'user' message.
        // If the chat history starts with a bot greeting ('model'), we remove it from the context we send to the API.
        while (cleanHistory.length > 0 && cleanHistory[0].role !== 'user') {
            cleanHistory.shift();
        }

        const messages: any[] = cleanHistory;

        let finalContextMessage = input.userMessage;
        let activeBatchJobId: string | undefined = undefined;
        let completedBudgetId: string | undefined = undefined;
        let completedBudgetTotal: number | undefined = undefined;
        let completedBudgetItems: number | undefined = undefined;

        // If there's a document context not handled purely by tools but as direct attachment
        if (input.documentBase64) {
            console.log(`[PrivateWizardAgent] Processing attached document programmatically...`);
            finalContextMessage += "\n\n[Sistema: Analizando el documento PDF adjunto...]";

            try {
                const docResult = await processMeasurementDocumentTool({
                    base64Data: input.documentBase64,
                    mimeType: 'application/pdf',
                    fileName: 'mediciones.pdf',
                    leadId: input.userId
                });

                finalContextMessage += `\n[Resultado Herramienta Mediciones]:\n${JSON.stringify(docResult, null, 2)}\n\n(Instrucción: Informa al usuario sobre este resultado. Si el estado es PROCESSING_BACKGROUND, dile que se está procesando y pronto verá los resultados.)`;

                if (docResult.status === 'PROCESSING_BACKGROUND' && docResult.jobId) {
                    activeBatchJobId = docResult.jobId;
                } else if (docResult.status === 'COMPLETED' && docResult.data) {
                    completedBudgetId = docResult.data.id;
                    completedBudgetTotal = docResult.data.total;
                    completedBudgetItems = docResult.data.itemCount;
                }
            } catch (e: any) {
                console.error("[PrivateWizardAgent] Error running measurement tool:", e);
                finalContextMessage += `\n[Error Herramienta Mediciones]: Ocurrió un error leyendo el documento: ${e.message}`;
            }
        }

        // Add the current user message
        const userContent: any[] = [{ text: finalContextMessage }];

        // Add images if present
        if (input.imagesBase64 && input.imagesBase64.length > 0) {
            input.imagesBase64.forEach(imgData => {
                const mimeType = imgData.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
                userContent.push({
                    media: {
                        url: `data:${mimeType};base64,${imgData}`,
                        contentType: mimeType
                    }
                });
            });
        }

        messages.push({ role: 'user', content: userContent });

        let response;
        try {
            response = await ai.generate({
                model: gemini25Flash,
                system: systemPrompt,
                messages: messages,
                tools: [processMeasurementDocumentTool, generateRenovationRenderTool],
                config: { temperature: 0.2 }
            });
        } catch (error: any) {
            console.error(`[PrivateWizardAgent] Generation Error:`, error);
            throw error;
        }

        try {
            const rawText = response.text || "";
            let jsonUpdate = {};

            // Try to extract JSON block from text
            const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/);
            if (jsonMatch && jsonMatch[1]) {
                try {
                    jsonUpdate = JSON.parse(jsonMatch[1]);
                } catch (e) {
                    console.warn("[PrivateWizardAgent] Failed to parse JSON block from agent", e);
                }
            } else if (response.output) {
                // Fallback if genkit somehow returns structured output anyway
                jsonUpdate = response.output as any;
            }

            // Remove the JSON block from the reply the user sees
            const replyCleaned = rawText.replace(/```json\s*([\s\S]*?)\s*```/g, '').trim();

            return {
                reply: replyCleaned,
                updatedRequirements: {
                    ...jsonUpdate,
                    ...(activeBatchJobId ? { activeBatchJobId } : {}),
                    ...(completedBudgetId ? { completedBudgetId, completedBudgetTotal, completedBudgetItems } : {})
                }
            };
        } catch (error) {
            console.error(`[PrivateWizardAgent] Error:`, error);
            return {
                reply: "Lo siento, ha ocurrido un error al procesar tu solicitud en el servidor privado. Por favor, intenta un poco más tarde."
            };
        }
    }
);

/**
 * Variante en streaming del asistente. Emite chunks de texto a medida que
 * el modelo los genera y, al final, un evento `done` con las variables
 * actualizadas (el bloque JSON del prompt se filtra y no se propaga al UI).
 *
 * No usa `ai.defineFlow` porque Genkit no serializa async generators como
 * salida de flow. Se expone como función pura consumida por el endpoint SSE.
 */
export type PrivateWizardStreamEvent =
    | { kind: 'chunk'; text: string }
    | { kind: 'done'; reply: string; updatedRequirements: Record<string, any> }
    | { kind: 'error'; message: string };

export async function* streamPrivateWizardAgent(
    input: import('zod').infer<typeof PrivateWizardAgentInputSchema>
): AsyncGenerator<PrivateWizardStreamEvent> {
    const { companyConfigService } = await import('@/backend/platform/application/company-config-service');
    const company = await companyConfigService.get();

    const systemPrompt = buildSystemPrompt(company.name);

    let cleanHistory = input.history ? [...input.history] : [];
    while (cleanHistory.length > 0 && cleanHistory[0].role !== 'user') cleanHistory.shift();

    const messages: any[] = cleanHistory;
    let finalContextMessage = input.userMessage;
    let activeBatchJobId: string | undefined;
    let completedBudgetId: string | undefined;
    let completedBudgetTotal: number | undefined;
    let completedBudgetItems: number | undefined;

    if (input.documentBase64) {
        try {
            const docResult = await processMeasurementDocumentTool({
                base64Data: input.documentBase64,
                mimeType: 'application/pdf',
                fileName: 'mediciones.pdf',
                leadId: input.userId,
            });
            finalContextMessage += `\n[Resultado Herramienta Mediciones]:\n${JSON.stringify(docResult, null, 2)}\n\n(Instrucción: Informa al usuario sobre este resultado.)`;
            if (docResult.status === 'PROCESSING_BACKGROUND' && docResult.jobId) {
                activeBatchJobId = docResult.jobId;
            } else if (docResult.status === 'COMPLETED' && docResult.data) {
                completedBudgetId = docResult.data.id;
                completedBudgetTotal = docResult.data.total;
                completedBudgetItems = docResult.data.itemCount;
            }
        } catch (e: any) {
            finalContextMessage += `\n[Error Herramienta Mediciones]: ${e.message}`;
        }
    }

    const userContent: any[] = [{ text: finalContextMessage }];
    if (input.imagesBase64 && input.imagesBase64.length > 0) {
        for (const imgData of input.imagesBase64) {
            const mimeType = imgData.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
            userContent.push({
                media: {
                    url: `data:${mimeType};base64,${imgData}`,
                    contentType: mimeType,
                },
            });
        }
    }
    messages.push({ role: 'user', content: userContent });

    // Genkit streaming
    let fullText = '';
    let emittedPrefixLen = 0; // cuánto texto hemos emitido ya al cliente
    let jsonStarted = false;

    try {
        const { stream, response } = ai.generateStream({
            model: gemini25Flash,
            system: systemPrompt,
            messages,
            tools: [processMeasurementDocumentTool, generateRenovationRenderTool],
            config: { temperature: 0.2 },
        });

        for await (const chunk of stream) {
            const piece: string | undefined = (chunk as any).text;
            if (!piece) continue;
            fullText += piece;

            // Si todavía no hemos visto el bloque json, emitir la diferencia.
            // Cuando aparezca el marcador, dejamos de emitir al cliente y
            // seguimos acumulando para parsear al final.
            if (!jsonStarted) {
                const markerIdx = fullText.indexOf('```json');
                if (markerIdx >= 0) {
                    jsonStarted = true;
                    // Emitir solo lo previo al marcador que aún no se haya enviado
                    const toEmit = fullText.substring(emittedPrefixLen, markerIdx);
                    if (toEmit) yield { kind: 'chunk', text: toEmit };
                    emittedPrefixLen = markerIdx;
                } else {
                    // Emitir lo nuevo evitando cortar justo antes de un marcador parcial
                    const safeUpTo = fullText.length - 7; // '```json'.length
                    if (safeUpTo > emittedPrefixLen) {
                        yield { kind: 'chunk', text: fullText.substring(emittedPrefixLen, safeUpTo) };
                        emittedPrefixLen = safeUpTo;
                    }
                }
            }
        }

        // esperar respuesta final para poder acceder a tool calls / output
        const finalResponse = await response;
        if (!fullText) fullText = finalResponse.text || '';

        // Parsear JSON
        let jsonUpdate: Record<string, any> = {};
        const jsonMatch = fullText.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
            try {
                jsonUpdate = JSON.parse(jsonMatch[1]);
            } catch {
                // ignorar
            }
        }

        const replyCleaned = fullText.replace(/```json\s*([\s\S]*?)\s*```/g, '').trim();

        // Si por el buffer safeUpTo quedó un trozo sin emitir (y no había json), emitirlo ahora.
        if (!jsonStarted && emittedPrefixLen < replyCleaned.length) {
            yield { kind: 'chunk', text: replyCleaned.substring(emittedPrefixLen) };
        }

        yield {
            kind: 'done',
            reply: replyCleaned,
            updatedRequirements: {
                ...jsonUpdate,
                ...(activeBatchJobId ? { activeBatchJobId } : {}),
                ...(completedBudgetId ? { completedBudgetId, completedBudgetTotal, completedBudgetItems } : {}),
            },
        };
    } catch (error: any) {
        console.error('[PrivateWizardAgent:stream] Error:', error);
        yield {
            kind: 'error',
            message: error?.message || 'Error inesperado procesando el mensaje.',
        };
    }
}

function buildSystemPrompt(companyName: string): string {
    return `
Eres el Asistente Privado de ${companyName} Construction. Actúas como un APAREJADOR (Arquitecto Técnico) experto en presupuestación de obras en España.

Tu OBJETIVO es reunir la información MÍNIMA NECESARIA para presupuestar, con eficiencia y respetando el tiempo del usuario. NO sigues un guion fijo: te adaptas a lo que el usuario YA ha dicho y solo preguntas lo que falta.

═══════════════════════════════════════════
🧠 PASO 0 — EXTRAE ANTES DE PREGUNTAR (siempre lo primero)
═══════════════════════════════════════════
Antes de formular NINGUNA pregunta, lee el mensaje inicial y TODO el historial y extrae lo que el usuario YA dijo: tipo de inmueble, superficie, alcance, capítulos, materiales, patologías y —clave— qué elementos se SUSTITUYEN por completo vs cuáles se reparan/mantienen. Rellena el 'phaseChecklist' marcando 'addressed' todo lo que ya esté claro; solo lo que falte queda 'pending'.

═══════════════════════════════════════════
✅ REGLA DE ORO — NO PREGUNTES LO YA RESPONDIDO
═══════════════════════════════════════════
- NUNCA preguntes algo respondido explícita o implícitamente.
- Si el usuario dice "renovación/sustitución COMPLETA de X" (fontanería, electricidad, alicatado…), el alcance de X está RESUELTO: NO preguntes por su estado actual — es irrelevante, se retira y se instala nuevo igual. El estado actual solo importa para decidir entre reparar y sustituir, y aquí ya está decidido.
- Ante cada posible pregunta, pregúntate: "¿la respuesta cambia las partidas o cantidades del presupuesto?". Si no, no la hagas.

═══════════════════════════════════════════
🎯 QUÉ SÍ PREGUNTAR (solo si falta Y cambia el presupuesto)
═══════════════════════════════════════════
Superficie (si no se dio) · tipo de inmueble (afecta escala/licencias) · GAMA de materiales (económica/media/alta — cambia mucho el precio) · cantidades o acabados ambiguos · patologías que añaden capítulos (humedades, grietas) · si se mueven tabiques / se toca estructura (obra menor vs mayor). Planta y ascensor SOLO en obras con retirada/subida de material relevante; para un baño pequeño no lo fuerces.

═══════════════════════════════════════════
🗣️ CÓMO PREGUNTAR — DINÁMICO, NO INTERROGATORIO
═══════════════════════════════════════════
- UNA pregunta por turno SOLO para ambigüedades reales que cambian el presupuesto.
- Para huecos menores o supuestos razonables, CONFIRMA EN LOTE en vez de preguntar uno a uno: "Asumo [X, Y, Z]. ¿Correcto o ajusto algo?".
- Si el mensaje inicial ya es un briefing completo (alcance + capítulos + materiales), NO alargues: haz un resumen de confirmación y, con el OK, marca 'isReadyForGeneration: true'.
- Si el inmueble es antiguo y el usuario NO mencionó una instalación relevante, PUEDES sugerirla como recomendación (no interrogatorio) — y NUNCA si ya dijo que se renueva.

═══════════════════════════════════════════
🚨 GAPS DE ALTO RIESGO EN REFORMA INTEGRAL (zona húmeda / electricidad)
═══════════════════════════════════════════
En reformas INTEGRALES o renovaciones COMPLETAS (baño, cocina o vivienda entera) hay partidas que el oficio da por hechas y que los clientes casi nunca nombran, pero cuya omisión infravalora el presupuesto ~30-40% y genera reclamaciones seguras:
- 🚿 IMPERMEABILIZACIÓN de la zona de ducha / suelo húmedo del baño (antes de solar y alicatar).
- ⚡ ELECTRICIDAD básica de la estancia: al menos punto de luz y punto para extractor/ventilación (en cocina, además tomas para electrodomésticos).
Antes de marcar 'isReadyForGeneration: true' en una reforma integral, VERIFICA que ambos gaps están cubiertos en 'phaseChecklist'/'detectedNeeds'. Si NO se han tratado y NO se deducen ya de lo que el usuario dijo, SEÑÁLALOS EN LOTE como recomendación y confirma inclusión/exclusión en un solo turno — ej.: "Para una reforma integral de baño asumo que incluimos impermeabilización de la ducha y un punto de luz + extractor. ¿Los incluyo o los dejamos fuera?" — NO como interrogatorio pregunta-a-pregunta.
RESPETA la regla anti-redundancia: si el usuario ya dijo "renovación completa de electricidad" o "rehacer la ducha con impermeabilización", NO vuelvas a preguntar — márcalo 'addressed' y añádelo a 'detectedNeeds'. Si el usuario decide EXCLUIRLOS conscientemente, márcalos 'not_applicable' y déjalo escrito de forma EXPLÍCITA en el 'finalBrief' como exclusión deliberada (no como olvido).
Esto NO aplica a intervenciones parciales/puntuales (cambiar un sanitario, repintar, sustituir grifería): ahí NO fuerces estos capítulos.

═══════════════════════════════════════════
📊 CLASIFICACIÓN DE ESCALA
═══════════════════════════════════════════
Clasifica 'updatedRequirements.projectScale': 'major' (estructura, ampliación, cambio de uso, fachada, cubierta) o 'minor' (reforma interior sin tocar estructura). Informa breve de la clasificación y sus implicaciones (licencia menor vs proyecto), sin volverlo pesado.

═══════════════════════════════════════════
📋 CAPÍTULOS (phaseChecklist)
═══════════════════════════════════════════
Mantén el 'phaseChecklist' con los capítulos aplicables: 'addressed' con info suficiente, 'not_applicable' si no aplica, 'pending' si falta detalle material.

**CUANDO ESTÁS LISTO**: cuando todos los capítulos relevantes estén 'addressed' o 'not_applicable' y el usuario confirme (recuérdale antes un 10-15% de contingencias y que el admin asignará cliente tras generar), establece 'isReadyForGeneration: true'.

Al marcar 'isReadyForGeneration: true' es **OBLIGATORIO** que también incluyas:
- **finalBrief**: resumen técnico consolidado (4-8 frases) con TODOS los detalles específicos a presupuestar (materiales, instalaciones concretas, cantidades, patologías). Se envía al motor RAG de búsqueda de precios — cuanto más específico, mejores precios.
- **detectedNeeds**: array con cada tarea pedida explícitamente, con forma \`{ "category": "CAPÍTULO", "description": "...", "requestedMaterial": "..." }\`.

═══════════════════════════════════════════
📋 REGLAS
═══════════════════════════════════════════
1. UNA sola pregunta por turno.
2. Si el usuario adjunta un PDF de mediciones, usa la herramienta 'processMeasurementDocument'.
3. Tono técnico accesible.

═══════════════════════════════════════════
⚙️ FORMATO DE RESPUESTA
═══════════════════════════════════════════
Responde con texto natural para el usuario y, AL FINAL, añade un bloque de código JSON con las variables actualizadas.

Ejemplo (intermedio):

[Tu respuesta]

\`\`\`json
{
  "specs": { "propertyType": "Vivienda", "totalArea": "90" },
  "projectScale": "major",
  "phaseChecklist": { "Demoliciones": "addressed" },
  "isReadyForGeneration": false
}
\`\`\`

Ejemplo (LISTO — siempre con finalBrief y detectedNeeds):

[Tu respuesta de confirmación]

\`\`\`json
{
  "specs": { "propertyType": "Vivienda", "interventionType": "Reforma Parcial", "totalArea": "12" },
  "projectScale": "minor",
  "phaseChecklist": {
    "Demoliciones": "addressed",
    "Albañilería": "addressed",
    "Fontanería": "addressed",
    "Electricidad": "addressed",
    "Pintura": "addressed"
  },
  "finalBrief": "Reforma de cocina de 12 m² en vivienda de 1998 (4ª planta sin ascensor), escala minor. Trabajos: demolición de alicatado existente, alisado de paredes, nueva instalación de tuberías de cobre, cableado eléctrico para electrodomésticos de alta potencia, suelo cerámico 60x60, pintura plástica. Patologías: humedades visibles.",
  "detectedNeeds": [
    { "category": "DEMOLICIONES", "description": "Demolición de alicatado existente en 12 m²" },
    { "category": "FONTANERIA Y GAS", "description": "Nueva instalación de tuberías", "requestedMaterial": "cobre" },
    { "category": "ELECTRICIDAD Y TELECOMUNICACIONES", "description": "Cableado para electrodomésticos de alta potencia" },
    { "category": "SOLADOS Y ALICATADOS", "description": "Suministro e instalación de suelo cerámico 60x60 en 12 m²" },
    { "category": "PINTURA Y REVESTIMIENTOS", "description": "Pintura plástica en paredes de cocina" }
  ],
  "isReadyForGeneration": true
}
\`\`\`
    `;
}

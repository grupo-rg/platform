import { gemini25Flash } from '../../shared/config/genkit.config';
import { generateWithRetry } from '../../shared/utils/ai-retry';
import { PriceBookItem } from '../../../../backend/price-book/domain/price-book-item';
import { DecomposedTask } from './architect.agent';

export interface JudgeDecision {
    selectedId: string | null;
    quantity: number;
    note?: string;
    internal_reasoning?: string;
    needsUnitAdjustment?: boolean;
}

/**
 * The Judge Agent reviews the RAG candidates and makes a strict selection.
 */
export class JudgeAgent {
    private readonly model = gemini25Flash;

    async evaluateAndSelect(task: DecomposedTask, candidates: PriceBookItem[]): Promise<{ decision: JudgeDecision, usage?: any }> {
        if (candidates.length === 0) {
            return { decision: { selectedId: null, quantity: task.estimatedParametricQuantity, note: 'No candidates found.' } };
        }

        const candidatesJson = JSON.stringify(candidates.map(c => ({
            id: c.code,
            description: c.description,
            unit: c.unit,
            chapter: c.chapter,
            price: c.priceTotal,
            isVariable: c.breakdown?.some(b => b.is_variable) ? true : false
        })), null, 2);

        const prompt = `
Eres el "Juez Consolidador" de un sistema de presupuestos.
Tarea Original del Cliente: "${task.task}" (Capítulo: ${task.chapter})
Cantidad Paramétrica Estimada: ${task.estimatedParametricQuantity} ${task.estimatedParametricUnit}
Material Específico Pedido por el Cliente: ${task.userSpecificMaterial ? `"${task.userSpecificMaterial}"` : "Ninguno"}

Candidatos Extraídos de la Base de Datos (Vector Search):
${candidatesJson}

Instrucciones:
1. Analiza cuál de los candidatos se ajusta mejor a la tarea original.
2. REGLA CRÍTICA - MANEJO DE "is_variable: true":
   - Observa los metadatos del candidato seleccionado. Si tiene "is_variable": true, significa que la partida es solo de mano de obra/agarre, y el material principal varía.
   - Si "is_variable" es true Y existe un "Material Específico Pedido por el Cliente", DEBES redactar una "note" que diga: "Material a vincular: [Inserta el material pedido]".
   - Si el cliente solicitó explícitamente "Lujo", "Premium" o "Alta calidad", OBLIGATORIAMENTE anótalo en el campo "note" para que el sistema sepa que debe buscar ese acabado después.
   - Si "is_variable" es true Y NO existe material específico, pon en la "note": "Material pendiente de definir por el cliente".
   - Si el candidato NO tiene "is_variable: true", el campo "note" debe quedar estrictamente en null.
3. BAJO NINGUNA CIRCUNSTANCIA INVENTES UN CÓDIGO (id). Usa SOLO uno de los 'id' presentes en la lista de candidatos.
4. ADAPTACIÓN DE CANTIDADES Y ECONOMÍA DE ESCALA (CRÍTICO): El Arquitecto estimó ${task.estimatedParametricQuantity} ${task.estimatedParametricUnit}. 
DEBES analizar detalladamente la propiedad "unit" del candidato seleccionado en la base de datos (ej. "u", "m2", "ml", "PA").
- TOLERANCIA DE UNIDADES: Si hay una discrepancia de unidades (ej. la tarea pide 'ml' y el catálogo dice 'u', o pide 'u' y el catálogo dice '%'), y el candidato es semánticamente el correcto, ¡NO LO RECHACES! Selecciónalo y pon "needsUnitAdjustment": true. El sistema se encargará de hacer la conversión matemática después.
- Si el candidato se mide por unidad global ("u" refiriéndose a toda la vivienda o partida alzada completa), la "quantity" final debe ser 1.
- FILTRO DE ESCALA Y RENDIMIENTO: Si la cantidad paramétrica es grande (ej. demolición de toda la vivienda, pintar 300m2) RECHAZA candidatos diseñados para "pequeñas reparaciones" o "remates" cuando haya alternativas industriales. PRIORIZA candidatos que reflejen una unidad macro. Si la "unit" del candidato es coherente o escalable, usa o ajusta la "quantity" matemática.
5. REGLA DE FLEXIBILIDAD (GENÉRICO VS ESPECÍFICO): Si la 'Tarea Original' pide un conjunto genérico (ej. "Aparatos sanitarios", "Mobiliario de cocina", "Instalación de fontanería") y el candidato es un elemento específico de ese conjunto (ej. "Inodoro", "Mueble bajo", "Punto de agua"), DEBES ACEPTARLO como partida representativa y ajustar la 'quantity'. NO LO RECHACES amparándote en que no cubre todo el conjunto.
6. EXCEPCIÓN DE REQUERIMIENTO EXPLÍCITO: Si la variable isExplicitlyRequested de la tarea es VERDADERA (${task.isExplicitlyRequested}) y no hay buenos candidatos en el RAG, TIENES PROHIBIDO devolver selectedId: null. En su lugar, debes inventar/devolver un selectedId: "GENERIC-EXPLICIT" para forzar al sistema a incluir esta partida a determinar precio, demostrándole al usuario que lo escuchamos.
   - Si no es explícita (${task.isExplicitlyRequested}) y ninguno aplica mínimamente, selectedId debe ser null.

Devuelve SOLO un bloque JSON con este formato exacto:
\`\`\`json
{
  "internal_reasoning": "Justifica en 1 línea por qué seleccionas este candidato, validando que la unidad métrica y la técnica coincidan.",
  "selectedId": "código_del_candidato_elegido_o_null_o_GENERIC-EXPLICIT",
  "quantity": cantidad_matemáticamente_adaptada,
  "note": "Nota explicativa para anexar el material específico (solo si is_variable es true) o null",
  "needsUnitAdjustment": true_o_false
}
\`\`\`
`;
        try {
            const result = await generateWithRetry({
                model: this.model,
                prompt: prompt,
                config: {
                    temperature: 0.0,
                }
            });

            let decision = this.extractStrictSelection(result.text, task.estimatedParametricQuantity);

            // Algorithmic Protection: Overrule hallucinating Judge
            if (decision.selectedId === null && task.isExplicitlyRequested) {
                decision.selectedId = 'GENERIC-EXPLICIT';
                decision.note = decision.note || 'AI rejected but overridden due to User Explicit Request';
            }

            return { decision, usage: result.usage };
        } catch (error) {
            console.error("Judge Agent Error:", error);
            // Default to highest ranked candidate if LLM fails (fallback mechanism)
            let selectedId = candidates[0]?.code || null;
            if (task.isExplicitlyRequested && !selectedId) selectedId = 'GENERIC-EXPLICIT';

            return { decision: { selectedId: selectedId, quantity: task.estimatedParametricQuantity, note: 'AI selection failed, fallback' } };
        }
    }

    /**
     * TDD Strategy: Tests that the Judge Agent enforces strict JSON outputs based on retrieved candidates.
     * It must return a selected ID, quantity, and optional note, without hallucinating structures.
     */
    extractStrictSelection(aiResponse: string, fallbackQuantity: number): JudgeDecision {
        try {
            const cleanJson = aiResponse.replace(/```json\n|\n```|```/g, '').trim();
            const parsed = JSON.parse(cleanJson);

            if (typeof parsed.selectedId !== 'string' && parsed.selectedId !== null) {
                return { selectedId: null, quantity: 0, note: 'Failed strict schema validation on selectedId' };
            }

            // If the LLM correctly decided to reject all candidates because of scale mismatch
            if (parsed.selectedId === null) {
                return { selectedId: null, quantity: 0, note: parsed.note || 'AI Rejected: No suitable candidate found' };
            }

            // If it selected an ID but failed math extraction
            if (typeof parsed.quantity !== 'number' || parsed.quantity <= 0) {
                return { selectedId: parsed.selectedId, quantity: fallbackQuantity, note: 'Fallback parametric quantity applied' };
            }

            return {
                selectedId: parsed.selectedId,
                quantity: parsed.quantity,
                note: parsed.note,
                internal_reasoning: parsed.internal_reasoning,
                needsUnitAdjustment: parsed.needsUnitAdjustment || false
            };
        } catch (e) {
            return { selectedId: null, quantity: 1, note: 'Failed to parse JSON', needsUnitAdjustment: false };
        }
    }
}

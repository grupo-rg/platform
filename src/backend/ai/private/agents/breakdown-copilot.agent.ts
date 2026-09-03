/**
 * WS-D — "Aparejador Copilot": edición de descompuesto en lenguaje natural.
 *
 * Recibe el descompuesto actual de una partida + una instrucción en español
 * ("suma un 10% a la mano de obra", "cambia el cemento por X") y devuelve el
 * descompuesto MODIFICADO en el mismo esquema de componentes.
 *
 * AI-FIRST / registry: el id del modelo se resuelve con `resolveModel('chat')`
 * (NUNCA hardcode). No hard-fail: el flow lanza si el modelo no devuelve output;
 * la server action que lo invoca captura el error y lo degrada a no-fatal.
 */
import { ai } from '@/backend/ai/core/config/genkit.config';
import { resolveModel } from '@/backend/ai/core/config/model-registry';
import { z } from 'genkit';

/** Componente de descompuesto tal como llega del editor (tolerante a alias/strings). */
export const BreakdownComponentInputSchema = z.object({
    code: z.string().nullable().optional(),
    concept: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    price: z.coerce.number().nullable().optional(),
    yield: z.coerce.number().nullable().optional(),
    quantity: z.coerce.number().nullable().optional(),
    total: z.coerce.number().nullable().optional(),
    is_variable: z.boolean().nullable().optional(),
});

/** Componente de salida del LLM — esquema estricto que espejea BudgetBreakdownComponent. */
const OutputComponentSchema = z.object({
    code: z.string().nullable().optional().describe('Código del recurso (mo.., mt.., mq.., % o partida). Conservar el original salvo sustitución explícita.'),
    concept: z.string().describe('Descripción del componente en español'),
    type: z.enum(['LABOR', 'MATERIAL', 'MACHINERY', 'OTHER']),
    unit: z.string().nullable().optional().describe('Unidad del recurso (h, m2, ud, %, ...). Conservar la original salvo cambio explícito.'),
    price: z.number().describe('Precio unitario del recurso en la MISMA escala que la entrada'),
    yield: z.number().describe('Rendimiento / cantidad del recurso por unidad de partida'),
    is_variable: z.boolean().optional(),
});

export const BreakdownCopilotOutputSchema = z.object({
    components: z.array(OutputComponentSchema).describe('Descompuesto completo modificado (conservar los componentes NO afectados por la instrucción)'),
    needs_human_review: z.boolean().describe('true si la instrucción es ambigua, arriesgada, o no se pudo aplicar con seguridad'),
    confidence: z.enum(['high', 'medium', 'low']).describe('Confianza en que el cambio refleja fielmente la instrucción'),
    summary: z.string().describe('Explicación breve (1-2 frases, español) de los cambios aplicados'),
});

export type BreakdownCopilotOutput = z.infer<typeof BreakdownCopilotOutputSchema>;

export const editBreakdownWithNlFlow = ai.defineFlow(
    {
        name: 'editBreakdownWithNlFlow',
        inputSchema: z.object({
            code: z.string().optional(),
            description: z.string().optional(),
            unit: z.string().optional(),
            unitPrice: z.coerce.number().optional(),
            breakdown: z.array(BreakdownComponentInputSchema),
            instruction: z.string(),
        }),
        outputSchema: BreakdownCopilotOutputSchema,
    },
    async (input) => {
        const model = await resolveModel('chat');

        // Normalizamos la entrada a un shape mínimo y estable para el prompt.
        const currentBreakdown = input.breakdown.map((c, i) => ({
            index: i,
            code: c.code ?? null,
            concept: c.concept ?? c.description ?? '',
            type: c.type ?? null,
            unit: c.unit ?? 'ud',
            price: Number(c.price ?? 0),
            yield: Number(c.yield ?? c.quantity ?? 1),
            is_variable: c.is_variable ?? false,
        }));

        const currentSum = currentBreakdown.reduce((acc, c) => {
            const t = c.unit === '%' ? c.price * (c.yield / 100) : c.price * c.yield;
            return acc + t;
        }, 0);

        const prompt = `Eres un aparejador (quantity surveyor) experto en descompuestos de construcción españoles (base COAATMCA).
Tu tarea es MODIFICAR el descompuesto de una partida siguiendo UNA instrucción en lenguaje natural, y devolver el descompuesto COMPLETO resultante.

PARTIDA:
- Código: ${input.code || 'S/C'}
- Descripción: ${input.description || 'N/D'}
- Unidad: ${input.unit || 'ud'}
- Precio unitario actual: ${Number(input.unitPrice ?? 0).toFixed(4)}
- Suma actual del descompuesto: ${currentSum.toFixed(4)}

DESCOMPUESTO ACTUAL (JSON, precios en la escala interna del editor):
${JSON.stringify(currentBreakdown, null, 0)}

INSTRUCCIÓN DEL USUARIO:
"${input.instruction}"

REGLAS ESTRICTAS:
1. Aplica SOLO lo que pide la instrucción. Conserva intactos TODOS los componentes que la instrucción no menciona (mismo code, concept, unit, price, yield).
2. Devuelve el descompuesto COMPLETO (los componentes conservados + los modificados/añadidos/eliminados), NUNCA solo el delta.
3. Mantén los PRECIOS en la MISMA escala numérica que la entrada. No conviertas divisas ni apliques márgenes.
4. "Sumar/quitar X% a la mano de obra" = escalar el 'yield' (o 'price') de los componentes tipo LABOR (código que empieza por 'mo'). "a los materiales" = tipo MATERIAL ('mt'). "a la maquinaria" = MACHINERY ('mq').
5. Para "cambiar/sustituir el recurso Y por Z": ajusta concept/code/price del componente afectado; si no conoces un precio real, mantén el precio previo y marca needs_human_review=true.
6. Clasifica 'type' por prefijo de código cuando exista: mo→LABOR, mt→MATERIAL, mq→MACHINERY, ci/%→OTHER.
7. No inventes componentes que la instrucción no pide. No elimines componentes salvo que la instrucción lo indique.
8. Si la instrucción es ambigua, contradictoria, o implica datos de precio que no puedes conocer con certeza, aplícala de la forma más conservadora posible y pon needs_human_review=true y confidence 'low'.
9. 'summary' debe describir en 1-2 frases QUÉ cambiaste (español).

Devuelve JSON válido conforme al esquema.`;

        const result = await ai.generate({
            model: model.prefixed,
            prompt,
            output: { format: 'json', schema: BreakdownCopilotOutputSchema },
            config: { temperature: model.params?.temperature ?? 0.2 },
        });

        if (!result.output) {
            throw new Error('El modelo no devolvió un descompuesto válido.');
        }
        return result.output;
    },
);

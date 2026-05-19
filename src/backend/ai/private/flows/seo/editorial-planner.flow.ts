import { ai, gemini25Flash } from '@/backend/ai/core/config/genkit.config';
import { z } from 'zod';

/**
 * EditorialPlannerAgent — toma:
 *
 *   1. La lista de servicios NO cubiertos por el blog ("gaps").
 *   2. Las keyword ideas que vienen de Google Trends.
 *   3. La cadencia y duración del plan (cuántas semanas, posts/semana).
 *
 * Y devuelve un BATCH de `ContentBriefDraft[]` listos para ser persistidos
 * como `ContentBrief`s y revisados por el admin. NO genera contenido full
 * del post — solo el plan. La generación full es un paso posterior por
 * cada brief aprobado.
 *
 * Por qué un agente separado: revisar 10 briefs es ~5 min de admin;
 * revisar 10 posts de 900 palabras son 2-3h. Brief = punto de aprobación
 * óptimo entre control humano y autonomía agentic.
 */

export const ContentBriefDraftSchema = z.object({
    title: z.string().describe('Titular tentativo del post (60-80 caracteres)'),
    angle: z.string().describe('1-frase: el ángulo único que diferencia este post de los típicos'),
    primaryKeyword: z.string(),
    secondaryKeywords: z.array(z.string()).min(2).max(8),
    intent: z.enum(['informational', 'transactional', 'navigational', 'commercial']),
    /** ISO date — el agente sugiere fecha respetando la cadencia que se le pidió. */
    proposedPublishAt: z.string().describe('Fecha ISO 8601 sugerida de publicación.'),
    rationale: z.string().describe('Por qué este post: hueco de cobertura, tendencia de búsqueda, etc.'),
    relatedServicePath: z.string().optional().describe('Si el post enlaza a un servicio concreto, su path (ej. "piscinas/mantenimiento-reparacion").'),
});

export type ContentBriefDraft = z.infer<typeof ContentBriefDraftSchema>;

export const EditorialPlanInputSchema = z.object({
    locale: z.enum(['es', 'en', 'ca', 'de', 'nl']).default('es'),
    /** Cuántas semanas planificar hacia delante. */
    weeks: z.number().min(1).max(12).default(4),
    /** Posts por semana objetivo (cadencia). */
    postsPerWeek: z.number().min(1).max(7).default(2),
    /** Fecha de arranque del plan; por defecto: lunes de la semana próxima. */
    startFromISO: z.string().optional(),
    /** Gaps detectados por `analyzeContentGaps` (paths sin cobertura). */
    contentGaps: z.array(z.object({
        path: z.string(),
        categoryId: z.string(),
        subserviceId: z.string(),
        seedKeywords: z.array(z.string()),
    })),
    /** Keyword ideas del provider de trends. */
    keywordIdeas: z.array(z.object({
        keyword: z.string(),
        trendScore: z.number().optional(),
        relatedQueries: z.array(z.string()),
    })),
    /** Nombre comercial de la empresa (para anclar tono y referencias). */
    companyName: z.string(),
    /** Zona geográfica objetivo para SEO local. */
    targetRegion: z.string().default('Mallorca, Islas Baleares'),
});

export const EditorialPlanOutputSchema = z.object({
    briefs: z.array(ContentBriefDraftSchema),
    summary: z.string().describe('Resumen 2-3 frases de la estrategia del plan'),
});

export const editorialPlannerFlow = ai.defineFlow(
    {
        name: 'editorialPlannerFlow',
        inputSchema: EditorialPlanInputSchema,
        outputSchema: EditorialPlanOutputSchema,
    },
    async (input) => {
        const totalPosts = input.weeks * input.postsPerWeek;

        const startDate = input.startFromISO
            ? new Date(input.startFromISO)
            : nextMonday(new Date());

        const system = `Eres el responsable editorial SEO de ${input.companyName}, una empresa de construcción y reformas en ${input.targetRegion}.

Tu objetivo: diseñar un calendario editorial de blog que:
 1. Cubra primero los huecos del catálogo de servicios (un servicio sin un post explicativo es una venta perdida).
 2. Aproveche las keywords con tendencia al alza para captar tráfico orgánico fresco.
 3. Mezcle intent: ~60% informational (educar, posicionar marca, captar top-of-funnel), ~30% commercial (comparativas, "cómo elegir", "vale la pena…"), ~10% transactional (precios orientativos, "presupuesto reforma").

Reglas:
- No repitas keyword principal entre briefs del mismo plan.
- Distribuye fechas respetando la cadencia (${input.postsPerWeek}/semana, ${input.weeks} semanas).
- Para cada brief, indica claramente el servicio del catálogo al que enlaza (relatedServicePath) si aplica.
- El "angle" debe ser concreto y diferenciador, no genérico (ej. evita "Todo lo que necesitas saber sobre…"; prefiere "Cuánto sube el presupuesto de tu reforma cuando aparece humedad estructural").
- Devuelve fechas en hora 10:00 (mañana laboral, mejor para shares).
- Devuelve EXACTAMENTE ${totalPosts} briefs (no más, no menos).`;

        const gapsBlock = input.contentGaps.length > 0
            ? `\nServicios SIN cobertura en el blog (priorizar):\n${input.contentGaps.map(g => `  - ${g.path} (keywords semilla: ${g.seedKeywords.join(', ')})`).join('\n')}`
            : '\nTodos los servicios del catálogo ya tienen al menos un post (planifica refrescos / temas adyacentes).';

        const keywordsBlock = input.keywordIdeas.length > 0
            ? `\nKeyword ideas (Google Trends, ${input.locale.toUpperCase()}):\n${input.keywordIdeas.slice(0, 30).map(k => {
                const score = k.trendScore != null ? ` [score:${k.trendScore}]` : '';
                const related = k.relatedQueries.length > 0 ? ` (rel: ${k.relatedQueries.slice(0, 3).join(', ')})` : '';
                return `  - ${k.keyword}${score}${related}`;
            }).join('\n')}`
            : '\nNo hay keyword ideas externas — usa tu conocimiento del sector + los gaps.';

        const userPrompt = `Diseña el plan editorial para las próximas ${input.weeks} semanas a partir del ${startDate.toISOString().slice(0, 10)}.
${gapsBlock}
${keywordsBlock}

Devuelve JSON con \`briefs\` (lista de exactamente ${totalPosts}) y \`summary\` (2-3 frases describiendo la estrategia).`;

        const { output } = await ai.generate({
            model: gemini25Flash,
            system,
            prompt: userPrompt,
            output: { schema: EditorialPlanOutputSchema },
            config: { temperature: 0.4 },
        });

        if (!output) {
            throw new Error('El modelo no devolvió un plan estructurado.');
        }
        return output;
    },
);

function nextMonday(from: Date): Date {
    const d = new Date(from);
    const day = d.getDay(); // 0=Dom, 1=Lun, ..., 6=Sáb
    const daysUntilMonday = (8 - day) % 7 || 7;
    d.setDate(d.getDate() + daysUntilMonday);
    d.setHours(10, 0, 0, 0);
    return d;
}

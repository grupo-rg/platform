import { ai, gemini25Flash } from '@/backend/ai/core/config/genkit.config';
import { z } from 'zod';
import { slugify } from '@/backend/marketing/domain/blog-post';

export const GenerateBlogPostInputSchema = z.object({
    keywords: z.array(z.string()).min(1),
    targetLocale: z.enum(['es', 'en', 'ca', 'de', 'nl']).default('es'),
    tone: z.enum(['profesional', 'conversacional', 'técnico', 'inspirador']).optional(),
    competitorUrls: z.array(z.string()).optional(),
    /** Palabras aproximadas objetivo. */
    targetWordCount: z.number().min(400).max(3000).default(900),
});

export const GenerateBlogPostOutputSchema = z.object({
    title: z.string(),
    slug: z.string(),
    metaTitle: z.string(),
    metaDescription: z.string(),
    keywords: z.array(z.string()),
    tags: z.array(z.string()),
    contentMarkdown: z.string(),
    seoScore: z.number().min(0).max(100).optional(),
});

export const generateBlogPostFlow = ai.defineFlow(
    {
        name: 'generateBlogPostFlow',
        inputSchema: GenerateBlogPostInputSchema,
        outputSchema: GenerateBlogPostOutputSchema,
    },
    async (input) => {
        const { companyConfigService } = await import('@/backend/platform/application/company-config-service');
        const company = await companyConfigService.get();

        const system = `Eres redactor SEO senior especializado en construcción y reformas.
Escribes para ${company.name} (${company.web || 'sitio web de la empresa'}).
Tu objetivo: generar artículos de blog optimizados para SEO local (Mallorca, Islas Baleares) que posicionen en Google y conviertan lectores en leads.

Reglas:
- Escribe en el idioma objetivo indicado.
- Usa H2/H3 de forma jerárquica (Markdown: ##, ###).
- Integra las keywords de forma natural (no keyword stuffing).
- Incluye una sección "Preguntas frecuentes" al final con 3-4 Q&A pertinentes.
- Añade CTAs contextuales al final hacia /budget-request.
- Evita promesas imposibles, precios concretos y datos legales sin respaldo.
- Devuelve **solo** JSON válido según el esquema pedido.`;

        const competitorsBlock = input.competitorUrls?.length
            ? `\n\nReferencias de la competencia (para diferenciarse, no copiar):\n${input.competitorUrls.map(u => `- ${u}`).join('\n')}`
            : '';

        const userPrompt = `Genera un artículo de blog optimizado en SEO para las keywords: ${input.keywords.join(', ')}.

Idioma objetivo: ${input.targetLocale}
Tono: ${input.tone || 'profesional'}
Extensión aproximada: ${input.targetWordCount} palabras.${competitorsBlock}

Devuelve un JSON con estos campos:
- title: titular para H1 (máx 70 caracteres, debe incluir la keyword principal)
- slug: slug URL en minúsculas sin acentos
- metaTitle: título SEO (máx 60 caracteres)
- metaDescription: descripción SEO (140-160 caracteres)
- keywords: array de 5-8 keywords (incluyendo long-tail)
- tags: array de 3-5 tags de categorización
- contentMarkdown: contenido completo en Markdown, con H2/H3, listas, FAQ, y CTA final
- seoScore: estimación 0-100 de fortaleza SEO del artículo`;

        const { output } = await ai.generate({
            model: gemini25Flash,
            system,
            prompt: userPrompt,
            output: { schema: GenerateBlogPostOutputSchema },
            config: { temperature: 0.5 },
        });

        if (!output) {
            throw new Error('El modelo no devolvió un artículo estructurado.');
        }

        // Saneamos slug por si el modelo devuelve algo raro
        const cleanSlug = slugify(output.slug || output.title);
        return { ...output, slug: cleanSlug };
    }
);

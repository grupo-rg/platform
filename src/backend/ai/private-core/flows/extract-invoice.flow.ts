import { z, Part } from 'genkit';
import { ai, gemini25Flash } from '@/backend/ai/shared/config/genkit.config';

// --- Schemas ---

const InvoiceFileInput = z.object({
    file: z.object({
        base64: z.string(),
        mimeType: z.string(), // 'application/pdf' | 'image/jpeg' | 'image/png'
    }),
    // Optional: budget chapters for auto-categorization
    budgetChapters: z.array(z.string()).optional(),
});

const ExtractedInvoiceLine = z.object({
    description: z.string(),
    quantity: z.number(),
    unitPrice: z.number(),
    total: z.number(),
    suggestedChapter: z.string().optional(),
});

const ExtractedInvoiceOutput = z.object({
    provider: z.object({
        name: z.string(),
        cif: z.string().optional(),
        address: z.string().optional(),
    }),
    invoiceNumber: z.string().optional(),
    invoiceDate: z.string().optional(), // ISO date string
    lines: z.array(ExtractedInvoiceLine),
    subtotal: z.number(),
    taxRate: z.number(),       // e.g. 0.21
    taxAmount: z.number(),
    total: z.number(),
    confidence: z.number(),   // 0-1
});

export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceOutput>;

// --- Flow ---

/**
 * AI-powered invoice extraction flow.
 * Receives a PDF or image of an invoice and extracts structured data
 * using Gemini 2.5 Flash multimodal capabilities.
 */
export const extractInvoiceFlow = ai.defineFlow(
    {
        name: 'extractInvoiceFlow',
        inputSchema: InvoiceFileInput,
        outputSchema: ExtractedInvoiceOutput,
    },
    async (input) => {
        const { file, budgetChapters } = input;

        const chapterContext = budgetChapters && budgetChapters.length > 0
            ? `\n\nCAPÍTULOS DEL PRESUPUESTO DISPONIBLES para categorización:\n${budgetChapters.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nPara cada línea de factura, sugiere a qué capítulo del presupuesto corresponde en el campo "suggestedChapter". Si no hay coincidencia clara, déjalo vacío.`
            : '';

        const prompt = `Eres un experto contable especializado en el sector de la construcción en España.
Analiza la factura adjunta y extrae TODOS los datos de forma precisa.

INSTRUCCIONES:
1. Extrae el nombre del proveedor, CIF/NIF y dirección si están visibles.
2. Extrae el número de factura y la fecha.
3. Extrae CADA línea de detalle con: descripción, cantidad, precio unitario y total.
4. Calcula (o extrae) subtotal, tipo de IVA (como decimal, ej: 0.21), importe del IVA y total.
5. Asigna un nivel de confianza (0-1) basado en la claridad del documento.
${chapterContext}

FORMATO DE RESPUESTA: Responde ÚNICAMENTE con un objeto JSON válido con esta estructura exacta:
{
  "provider": { "name": "...", "cif": "...", "address": "..." },
  "invoiceNumber": "...",
  "invoiceDate": "YYYY-MM-DD",
  "lines": [
    { "description": "...", "quantity": 1, "unitPrice": 100.00, "total": 100.00, "suggestedChapter": "..." }
  ],
  "subtotal": 100.00,
  "taxRate": 0.21,
  "taxAmount": 21.00,
  "total": 121.00,
  "confidence": 0.95
}

IMPORTANTE:
- Los precios deben ser números decimales (sin símbolo €).
- La fecha debe estar en formato ISO (YYYY-MM-DD).
- Si algún dato no es visible o legible, usa null/0 y reduce la confianza.
- NO inventes datos. Solo extrae lo que ves en el documento.`;

        const parts: Part[] = [
            { text: prompt },
            {
                media: {
                    url: `data:${file.mimeType};base64,${file.base64}`,
                    contentType: file.mimeType,
                },
            },
        ];

        const result = await ai.generate({
            model: gemini25Flash,
            prompt: parts,
            config: {
                temperature: 0.1, // Low temperature for precision
            },
            output: {
                schema: ExtractedInvoiceOutput,
            },
        });

        const output = result.output;
        if (!output) {
            throw new Error('AI failed to extract invoice data. Empty response.');
        }

        return output;
    }
);


import { z } from 'zod';
import { ai, gemini25Flash } from '@/backend/ai/core/config/genkit.config';
import { PriceBookItem } from '../domain/price-book-item';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

// Zod Schema for Structured Extraction
const ExtractionSchema = z.object({
    chapter: z.string().optional().describe("Current Chapter context (e.g. 'FOUNDATIONS')"),
    section: z.string().optional().describe("Current Section context (e.g. 'Concrete')"),
    items: z.array(z.object({
        code: z.string().describe("The unique code of the item (e.g., XSL010m)"),
        description: z.string(),
        unit: z.string().describe("Unit of measure (e.g., m2, u, h)"),
        priceTotal: z.number(),
        breakdown: z.array(z.object({
            code: z.string().describe("Resource code (e.g., mt49sla280)"),
            quantity: z.number(),
            unit: z.string().optional(),
            price: z.number().optional(),
            description: z.string().optional()
        })).optional().describe("List of decomposition/breakdown items (materials, labor) if present")
    }))
});

export class LLMPriceBookParser {

    private createPrompt(text: string, currentChapter: string, currentSection: string): string {
        return `
        Role: Expert Quantity Surveyor and Data Extraction AI.
        Task: Extract construction price-book items from the provided text.
        
        CRITICAL INSTRUCTIONS:
        1.  **Extract ALL items:** Capture every single item that has a code and price. Do not skip any.
        2.  **Breakdowns (Descompuestos):** specific items have a list of sub-resources (materials, labor) below them. You MUST extract these into the 'breakdown' array.
            - Breakdown lines often look like: "Code  Quantity  Unit  Description  Price".
        3.  **Context:** Maintain the hierarchy. The breakdown belongs to the main item immediately above it.
        4.  **Precision:** Ensure prices are extracted exactly as numbers.
        
        Current Chapter Context (from previous page): "${currentChapter}"
        Current Section Context (from previous page): "${currentSection}"
        
        If you see a NEW Chapter or Section header, update the context values in your output.
        If no items are found, return empty list.

        TEXT TO ANALYZE:
        ${text}
        `;
    }

    /**
     * Parses a PDF file using Gemini 2.5 Flash to extract structured data.
     * Uses "Vision/Multimodal" capabilities by passing PDF pages directly to the model.
     */
    async parsePdf(
        fileUrl: string,
        year: number,
        onProgress?: (percent: number) => Promise<void>,
        onLog?: (msg: string) => Promise<void>,
        onMeta?: (meta: any) => Promise<void>,
        options?: { startPage?: number; maxPages?: number }
    ): Promise<PriceBookItem[]> {
        const log = async (msg: string) => { console.log(msg); if (onLog) await onLog(msg); };

        await log(`[LLMParser] Downloading PDF...`);
        let buffer: Buffer;

        if (fileUrl.startsWith('http')) {
            const response = await fetch(fileUrl);
            const arrayBuffer = await response.arrayBuffer();
            buffer = Buffer.from(arrayBuffer);
        } else {
            const fs = await import('fs/promises');
            buffer = await fs.readFile(fileUrl);
        }

        await log(`[LLMParser] Splitting PDF into pages (Vision Strategy)...`);

        // Use pdf-lib to split pages
        // @ts-ignore
        const { PDFDocument } = await import('pdf-lib');
        const srcDoc = await PDFDocument.load(buffer);
        const totalPages = srcDoc.getPageCount();

        await log(`[LLMParser] Found ${totalPages} pages.`);

        const allItems: PriceBookItem[] = [];
        let currentChapter = "";
        let currentSection = "";

        // Determine range
        const start = (options?.startPage || 1) - 1; // 0-indexed
        const max = options?.maxPages || totalPages;
        const end = Math.min(start + max, totalPages);

        await log(`[LLMParser] Processing pages ${start + 1} to ${end}...`);

        // Iterate pages
        for (let i = start; i < end; i++) {

            // Create a new document for this single page
            const doc = await PDFDocument.create();
            const [copiedPage] = await doc.copyPages(srcDoc, [i]);
            doc.addPage(copiedPage);
            const pageBytes = await doc.save();
            const base64Pdf = Buffer.from(pageBytes).toString('base64');
            const dataUri = `data:application/pdf;base64,${base64Pdf}`;

            // Generate Structured Data using Vision
            try {
                const promptText = `
                Analyze this PDF page VISUALLY. It is a Construction Price Book.
                Extract the Price Book items.
                
                CRITICAL FOR BREAKDOWNS:
                - Look for indented rows or rows with codes like 'mt...' or 'mo...' that appear under a main item.
                - These are the 'breakdown' (descompuestos).
                - Use the visual layout (columns, indentation) to determine hierarchy.
                
                Current Chapter Context (from previous page): "${currentChapter}"
                Current Section Context (from previous page): "${currentSection}"
                
                If you see a NEW Chapter or Section header (large bold text), update the context.
                `;

                const result = await ai.generate({
                    model: 'vertexai/gemini-2.5-flash',
                    prompt: [
                        { text: promptText },
                        { media: { url: dataUri, contentType: 'application/pdf' } }
                    ],
                    output: { schema: ExtractionSchema },
                });

                if (result.output) {
                    const extracted = result.output;

                    // Update Context
                    if (extracted.chapter) currentChapter = extracted.chapter;
                    if (extracted.section) currentSection = extracted.section;

                    // Map to Domain Entity
                    const parsedItems: PriceBookItem[] = extracted.items.map(raw => ({
                        code: raw.code,
                        description: raw.description,
                        unit: raw.unit,
                        priceTotal: raw.priceTotal, // Schema name match
                        priceLabor: 0,
                        priceMaterial: 0,
                        year: year,
                        createdAt: new Date(),
                        chapter: currentChapter,
                        section: currentSection,
                        breakdown: raw.breakdown // Pass through the breakdown
                    } as any));

                    allItems.push(...parsedItems);
                    await log(`[Page ${i + 1}/${totalPages}] Extracted ${parsedItems.length} items.`);

                    if (onMeta) {
                        await onMeta({
                            pageNumber: i + 1,
                            totalPages: totalPages,
                            currentChapter,
                            currentSection
                        });
                    }
                }

            } catch (err: any) {
                console.error(`Error parsing page ${i + 1}:`, err);
                const errorMessage = err instanceof Error ? err.message : String(err);
                await log(`[Page ${i + 1}] Error: ${errorMessage}`);
            }

            if (onProgress) await onProgress(Math.round(((i + 1) / totalPages) * 100));
        }

        return allItems;
    }
}

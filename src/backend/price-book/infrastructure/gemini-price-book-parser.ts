
import { PriceBookItem } from '../domain/price-book-item';
import { ai } from '@/genkit/index';
import { resolveModel } from '@/backend/ai/core/config/model-registry';
import { z } from 'zod';
import { PriceBookItemSchema } from '../domain/price-book-item';
import { PDFDocument } from 'pdf-lib';

export class GeminiPriceBookParser {
    // Conservative chunking to avoid timeouts on Vercel/Node
    private readonly CHUNK_SIZE = 5;
    private readonly OVERLAP = 2;

    async parsePdf(fileUrl: string, year: number, onProgress?: (percent: number) => Promise<void>): Promise<PriceBookItem[]> {
        console.log(`Downloading PDF for year ${year}...`);

        // 1. Fetch PDF Buffer
        let buffer: ArrayBuffer;
        if (fileUrl.startsWith('http')) {
            const response = await fetch(fileUrl);
            buffer = await response.arrayBuffer();
        } else {
            // Local file (for testing/CLI)
            const fs = await import('fs/promises');
            const nodeBuffer = await fs.readFile(fileUrl);
            buffer = nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength) as ArrayBuffer;
        }

        // 2. Load PDF with pdf-lib
        const srcDoc = await PDFDocument.load(buffer);
        const totalPages = srcDoc.getPageCount();
        console.log(`PDF loaded. Total pages: ${totalPages}`);

        const allItems: PriceBookItem[] = [];
        let processedPages = 0;

        // 3. Chunking Loop
        // We go from 0 to totalPages
        let startIndex = 0;
        let chunkIndex = 0;

        while (startIndex < totalPages) {
            chunkIndex++;
            let endIndex = Math.min(startIndex + this.CHUNK_SIZE, totalPages);

            console.log(`Processing Chunk ${chunkIndex}: Pages ${startIndex + 1} to ${endIndex}`);

            // Create sub-document
            const subDoc = await PDFDocument.create();
            const pageIndices: number[] = [];
            for (let i = startIndex; i < endIndex; i++) {
                pageIndices.push(i);
            }

            if (pageIndices.length === 0) break;

            const copiedPages = await subDoc.copyPages(srcDoc, pageIndices);
            copiedPages.forEach((page) => subDoc.addPage(page));

            const pdfBase64 = await subDoc.saveAsBase64();

            // Extract from this chunk
            try {
                const chunkItems = await this.extractFromChunk(pdfBase64);
                console.log(`  > Chunk ${chunkIndex} extracted ${chunkItems.length} items.`);
                allItems.push(...(chunkItems as PriceBookItem[]));
            } catch (e) {
                console.error(`  > Error processing chunk ${chunkIndex}:`, e);
            }

            // Update Progress (Max 90%)
            processedPages = endIndex;
            if (onProgress) {
                const percent = Math.round((processedPages / totalPages) * 90);
                await onProgress(percent);
            }

            if (endIndex === totalPages) break;

            // Move start forward by (SIZE - OVERLAP)
            // Example: Start 0, Size 5, Overlap 2. End 5. Next Start = 5 - 2 = 3.
            startIndex = endIndex - this.OVERLAP;
        }

        // 4. Deduplication
        const uniqueItems = this.deduplicate(allItems);
        console.log(`Finished parsing. Raw: ${allItems.length}, Unique: ${uniqueItems.length}`);

        return uniqueItems.map(item => ({
            ...item,
            year,
            code: item.code || 'UNKNOWN',
            searchKeywords: item.description ? item.description.toLowerCase().split(' ') : [],
            createdAt: new Date(),
        }));
    }

    private async extractFromChunk(pdfBase64: string): Promise<Partial<PriceBookItem>[]> {
        const extractionPrompt = `
          You are an expert Data Engineer. 
          Analyze the attached PDF section (Construction Price Book).
          Extract the construction items (Partidas) into a JSON list.
          
          VISUAL LAYOUT GUIDE:
          - Each item starts with a MAIN HEADER LINE containing:
            [Code] [Unit] [Description] ........................... [Total Price]
          - Example from document: "990320647 u Suministro... 113,74"
          - The price (113,74) is usually at the FAR RIGHT of the description line.
          - Below the header there are breakdown lines (Materials, Labor) - You can check them, but PRIORITY is the header price.

          DATA EXTRACTION RULES:
          1. **code**: The unique ID (e.g., 990320647).
          2. **description**: The full text description.
          3. **unit**: Unit (u, m2, ml).
          4. **priceTotal**: The value at the right. CONVERT "113,74" -> 113.74 (Float).
          5. **priceLabor** / **priceMaterial**: Attempt to extract from breakdown lines if clear, otherwise 0.

          Output ONLY valid JSON matching this schema: 
          Array<{ code: string, description: string, unit: string, priceLabor: number, priceMaterial: number, priceTotal: number }>
        `;

        const { output } = await ai.generate({
            // model-registry role 'extraction' (spec §5.1, site #19); falls back
            // to the code default (gemini-2.5-flash) on any registry error.
            model: (await resolveModel('extraction')).prefixed,
            config: {
                temperature: 0.1,
            },
            prompt: [
                { text: extractionPrompt },
                { media: { url: `data:application/pdf;base64,${pdfBase64}` } }
            ],
            // Relaxed schema for intermediate step; strict dates/IDs added later
            output: { schema: z.array(PriceBookItemSchema.omit({ year: true, id: true, createdAt: true, searchKeywords: true }).partial()) },
        });

        return output || [];
    }

    private deduplicate(items: Partial<PriceBookItem>[]): any[] {
        const map = new Map<string, any>();

        for (const item of items) {
            if (!item.code) continue;
            const code = item.code.trim();

            if (!map.has(code)) {
                map.set(code, item);
            } else {
                // If existing description is shorter, replace it with new one (assuming restart of chunk might cut off start)
                // Actually, let's trust LATER occurrences less for start of description? 
                // No, just keep the longest description found.
                const existing = map.get(code);
                if ((item.description?.length || 0) > (existing.description?.length || 0)) {
                    map.set(code, item);
                }
            }
        }
        return Array.from(map.values());
    }
}

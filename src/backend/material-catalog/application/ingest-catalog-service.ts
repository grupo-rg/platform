
import { MaterialCatalogRepository } from '../domain/material-catalog-repository';
import { MaterialItem, MaterialItemSchema } from '../domain/material-item';
import { ai, gemini25Flash, embeddingModel } from '@/backend/ai/shared/config/genkit.config';
import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { IngestionStatus, IngestionLog } from '../domain/ingestion-status';

export class IngestMaterialCatalogService {
    constructor(
        private repository: MaterialCatalogRepository
    ) { }

    /**
     * Ingests a PDF catalog using parallel processing for speed.
     * @param pdfUrl URL or Base64 of the PDF
     * @param options Configuration options
     * @param jobId Optional Job ID for progress tracking
     */
    async execute(pdfBase64: string, options: { year: number, source: string, concurrency: number }, jobId?: string) {
        console.time('Ingestion Total Time');

        // Initialize job status first to create the document
        if (jobId) {
            await this.updateStatus(jobId, { status: 'pending', createdAt: Date.now(), logs: [] });
        }

        await this.log(jobId, 'Iniciando proceso de ingesta...', 'info');

        try {
            // 1. Load PDF
            await this.log(jobId, 'Cargando documento PDF...', 'info');
            const pdfDoc = await PDFDocument.load(pdfBase64);
            const pageCount = pdfDoc.getPageCount();

            await this.updateStatus(jobId, {
                totalPages: pageCount,
                status: 'processing',
                currentActivity: `Analizando ${pageCount} páginas con concurrencia ${options.concurrency}`
            });

            console.log(`Starting ingestion of ${pageCount} pages with concurrency ${options.concurrency}...`);
            await this.log(jobId, `PDF cargado: ${pageCount} páginas encontradas.`, 'success');

            // 2. Process pages in batches (Parallel Processing)
            const batchSize = options.concurrency || 5;
            let totalItems = 0;
            let processedPages = 0;
            let totalExtractionTokens = 0;
            let totalEmbeddingTokens = 0;

            // RESILIENCE: Circuit Breaker - Track consecutive errors
            let consecutiveErrors = 0;
            const MAX_CONSECUTIVE_ERRORS = 3;

            for (let i = 0; i < pageCount; i += batchSize) {
                const batchPromises = [];
                const end = Math.min(i + batchSize, pageCount);

                const msg = `Procesando lote de páginas ${i + 1} a ${end}...`;
                console.log(msg);
                await this.log(jobId, msg, 'info');
                await this.updateStatus(jobId, { currentActivity: msg });

                // RESILIENCE: Resumable Ingestion - Skip already processed pages
                for (let j = i; j < end; j++) {
                    const pageNum = j + 1;
                    const alreadyProcessed = await this.repository.findByPage(pageNum, options.year);
                    if (alreadyProcessed.length > 0) {
                        console.log(`[Resumable] Página ${pageNum} ya procesada, saltando...`);
                        processedPages++;
                        continue;
                    }
                    batchPromises.push(
                        this.processPage(pdfDoc, j, options)
                            .catch(error => {
                                // Log but don't fail the entire batch
                                console.error(`[Ingest] Page ${j + 1} failed after all retries. Skipping...`, error);
                                return { items: [], usage: { totalTokens: 0 } };
                            })
                    );
                }

                // Wait for this batch of pages to finish (with graceful failures)
                const results = await Promise.all(batchPromises);

                // Flatten results and collect usage
                const batchItems = results.flatMap(r => r.items);
                const extractionTokens = results.reduce((sum, r) => sum + (r.usage?.totalTokens || 0), 0);
                totalExtractionTokens += extractionTokens;

                processedPages += (end - i);

                if (batchItems.length > 0) {
                    await this.log(jobId, `Extranídos ${batchItems.length} productos de este lote. Generando vectores...`, 'info');

                    try {
                        // 3. Generate Embeddings (Batch)
                        const { items: enrichedItems, tokens: embeddingTokens } = await this.enrichWithEmbeddings(batchItems);
                        totalEmbeddingTokens += embeddingTokens;

                        // 4. Save to DB (Batch)
                        await this.repository.saveBatch(enrichedItems);

                        totalItems += enrichedItems.length;
                        await this.log(jobId, `Lote guardado correctamente. (+${enrichedItems.length} items)`, 'success');

                        // RESILIENCE: Reset error counter on success
                        consecutiveErrors = 0;

                    } catch (error: any) {
                        consecutiveErrors++;
                        const isNetworkError = error.message?.includes('fetch failed') || error.message?.includes('ECONNRESET') || error.message?.includes('ETIMEDOUT');

                        await this.log(jobId, `Error en lote: ${error.message}`, 'error');

                        // RESILIENCE: Circuit Breaker - Fail fast on consecutive errors
                        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                            const msg = `Proceso detenido: ${consecutiveErrors} errores consecutivos detectados. Posible problema de red.`;
                            await this.log(jobId, msg, 'error');
                            await this.updateStatus(jobId, { status: 'failed', error: msg });
                            throw new Error(msg);
                        }

                        // If not network error, still throw to stop the batch
                        if (!isNetworkError) {
                            throw error;
                        }

                        // Log and continue for isolated network errors (< threshold)
                        await this.log(jobId, `Error de red detectado (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}). Continuando...`, 'warning');
                    }
                } else {
                    await this.log(jobId, `No se encontraron productos en este lote.`, 'warning');
                }

                await this.updateStatus(jobId, {
                    processedPages,
                    totalItems,
                    usage: {
                        extractionTokens: totalExtractionTokens,
                        embeddingTokens: totalEmbeddingTokens,
                        totalTokens: totalExtractionTokens + totalEmbeddingTokens
                    }
                });
            }

            console.timeEnd('Ingestion Total Time');
            await this.log(jobId, `Proceso finalizado. Total productos: ${totalItems}. Tokens: ${totalExtractionTokens + totalEmbeddingTokens}`, 'success');
            await this.updateStatus(jobId, { status: 'completed', currentActivity: 'Completado' });

            return { success: true, totalItems };

        } catch (error: any) {
            console.error(error);
            await this.log(jobId, `Error crítico: ${error.message}`, 'error');
            await this.updateStatus(jobId, { status: 'failed', error: error.message });
            throw error;
        }
    }

    private async processPage(pdfDoc: PDFDocument, pageIndex: number, options: { year: number, source: string }): Promise<{ items: MaterialItem[], usage?: any }> {
        try {
            // Extract single page
            const subPdf = await PDFDocument.create();
            const [copiedPage] = await subPdf.copyPages(pdfDoc, [pageIndex]);
            subPdf.addPage(copiedPage);
            const subPdfBase64 = await subPdf.saveAsBase64();

            // Genkit Call with Retry Logic for resilience
            const extractionPrompt = `
                Analiza esta página del catálogo de Obramat (${options.year}).
                Extrae TODOS los productos visibles como una lista JSON.
                Para cada producto:
                - sku: Referencia numérica (ej: 104562). IMPORTANTE.
                - name: Nombre del producto.
                - description: Descripción completa incluyendo medidas, características, etc.
                - price: Precio unitario (número).
                - unit: Unidad de venta (m2, ud, ml, saco, etc).
                - category: Categoría inferida por el título de la sección (ej: "Construcción > Cementos").
            `;

            let attempts = 3;
            let lastError: any;
            while (attempts > 0) {
                try {
                    const { output, usage } = await ai.generate({
                        model: gemini25Flash,
                        prompt: [
                            { text: extractionPrompt },
                            { media: { url: `data:application/pdf;base64,${subPdfBase64}` } }
                        ],
                        output: { schema: z.object({ items: z.array(MaterialItemSchema.omit({ id: true, embedding: true, metadata: true, createdAt: true, updatedAt: true })) }) }
                    });

                    if (!output || !output.items) return { items: [], usage };

                    // Map to Domain Entity
                    const items = output.items.map(item => ({
                        ...item,
                        sku: item.sku,
                        year: options.year,
                        metadata: {
                            page: pageIndex + 1,
                            catalogSource: options.source,
                            year: options.year,
                            usage: { tokens: usage?.totalTokens }
                        },
                        createdAt: new Date(),
                        updatedAt: new Date()
                    }));

                    return { items, usage };
                } catch (error: any) {
                    lastError = error;
                    attempts--;

                    // Detect error type for better handling
                    const errorMessage = error.message || '';
                    const isNetworkError = errorMessage.includes('fetch failed') ||
                        errorMessage.includes('ECONNRESET') ||
                        errorMessage.includes('ETIMEDOUT');
                    const isRateLimit = errorMessage.includes('429') || errorMessage.includes('quota');

                    if (attempts > 0) {
                        // Exponential backoff: 2s, 5s, 10s
                        const baseDelay = 2000;
                        const backoffMultiplier = (3 - attempts); // 1, 2, 3
                        const delay = baseDelay * Math.pow(2, backoffMultiplier - 1); // 2s, 4s, 8s

                        const errorType = isRateLimit ? 'rate limit' : isNetworkError ? 'network' : 'unknown';
                        console.warn(`[Ingest] Retry page ${pageIndex + 1} (attempt ${4 - attempts}/3) due to ${errorType} error. Waiting ${delay / 1000}s...`);
                        console.warn(`[Ingest] Error details:`, error);

                        await new Promise(resolve => setTimeout(resolve, delay));
                    } else {
                        console.error(`[Ingest] Page ${pageIndex + 1} failed after 3 attempts:`, error);
                    }
                }
            }

            throw lastError;

        } catch (error: any) {
            console.error(`Error processing page ${pageIndex + 1} after retries:`, error);
            return { items: [] };
        }
    }

    private async enrichWithEmbeddings(items: MaterialItem[]): Promise<{ items: MaterialItem[], tokens: number }> {
        if (items.length === 0) return { items: [], tokens: 0 };

        const textsToEmbed = items.map(item =>
            `${item.category} : ${item.name} - ${item.description} (${item.unit})`
        );

        try {
            // Atomic Vectorization: Each item text corresponds to exactly one embedding.
            const results = await ai.embedMany({
                embedder: embeddingModel,
                content: textsToEmbed,
                options: { outputDimensionality: 768 }
            });

            // Genkit embedMany doesn't always expose usage in a standard way across all providers,
            // but we can approximate or check metadata if available.
            // For now, we'll assume ~1 token per 4 chars for estimation if missing, 
            // but we'll check if results have some metadata.
            const tokens = results.reduce((sum, r: any) => sum + (r.metadata?.usage?.totalTokens || 0), 0);

            const enrichedItems = items.map((item, index) => ({
                ...item,
                embedding: results[index].embedding
            }));

            return { items: enrichedItems, tokens };
        } catch (error) {
            console.error("Error generating embeddings:", error);
            // RESILIENCE: Pre-save Validation - Fail explicitly instead of saving corrupted data
            throw new Error(`Failed to generate embeddings: ${error}`);
        }
    }

    // --- Progress Tracking Helper ---
    private async updateStatus(jobId: string | undefined, data: Partial<IngestionStatus>) {
        if (!jobId) return;
        try {
            await getFirestore().collection('ingestion_jobs').doc(jobId).set({
                ...data,
                updatedAt: Date.now()
            }, { merge: true });
        } catch (e) {
            console.error("Failed to update status", e);
        }
    }

    private async log(jobId: string | undefined, message: string, level: IngestionLog['level']) {
        if (!jobId) return;
        try {
            const logEntry: IngestionLog = {
                timestamp: Date.now(),
                message,
                level
            };
            await getFirestore().collection('ingestion_jobs').doc(jobId).update({
                logs: FieldValue.arrayUnion(logEntry)
            });
        } catch (e) {
            console.error("Failed to write log", e);
        }
    }
}

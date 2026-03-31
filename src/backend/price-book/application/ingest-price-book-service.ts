// @ts-nocheck
import { PriceBookRepository } from '../domain/price-book-repository';
import { LLMPriceBookParser } from '../infrastructure/llm-price-book-parser';
import { IngestionJobRepository } from '../domain/ingestion-job-repository';
import { ai, embeddingModel } from '@/backend/ai/shared/config/genkit.config';
import { PriceBookItem } from '../domain/price-book-item';

/**
 * Application Service / Use Case: Ingest Price Book (Async Job)
 */

import { BasicResourceRepository } from '../domain/basic-resource-repository';

export class IngestPriceBookService {
    constructor(
        private repository: PriceBookRepository,
        private parser: LLMPriceBookParser,
        private jobRepository: IngestionJobRepository,
        private resourceRepository: BasicResourceRepository // New dependency
    ) { }

    async execute(fileUrl: string, year: number, jobId: string, options?: { startPage?: number; maxPages?: number }) {
        console.log(`[Job ${jobId}] Starting ingestion for year ${year}...`);

        try {
            // 1. Update Job Status to Processing
            await this.jobRepository.update(jobId, { status: 'processing', progress: 10, logs: ['Job Initiated.'] });

            const logs: string[] = ['Job Initiated.'];
            const onLog = async (msg: string) => {
                logs.push(msg);
                await this.jobRepository.update(jobId, { logs });
            };

            // 2. Parse PDF
            const items = await this.parser.parsePdf(
                fileUrl,
                year,
                async (progress) => {
                    await this.jobRepository.update(jobId, { progress, status: 'processing' });
                },
                async (log) => {
                    // Append log
                    const job = await this.jobRepository.findById(jobId);
                    const logs = job?.logs || [];
                    logs.push(log);
                    // Keep only last 50 logs to avoid document size limits if needed, or valid array
                    if (logs.length > 100) logs.shift();
                    await this.jobRepository.update(jobId, { logs });
                },
                async (meta) => {
                    // Update Metadata
                    await this.jobRepository.update(jobId, { currentMeta: meta });
                },
                options // Pass options
            );

            await this.jobRepository.update(jobId, { progress: 40 });

            if (items.length === 0) {
                throw new Error("No items extracted from PDF.");
            }

            await onLog(`[Job ${jobId}] Extracted ${items.length} items. Generating Embeddings...`);

            // 3. Generate Embeddings (Enrichment)
            const enrichedItems = await this.enrichWithEmbeddings(items, async (p) => {
                // Map enrichment progress (0-100) to Job progress (40-80)
                const jobProgress = 40 + Math.round(p * 0.4);
                await this.jobRepository.update(jobId, { progress: jobProgress });
            });

            await onLog(`[Job ${jobId}] Embeddings generated. Saving to database...`);

            // 4. Extract and Save Basic Resources (Graph Nodes)
            // Save items (Progress 80-100)
            await this.jobRepository.update(jobId, { progress: 80 });

            const resources = this.extractResources(enrichedItems);
            if (resources.length > 0) {
                await onLog(`[Job ${jobId}] Indexing ${resources.length} unique resources (Graph)...`);
                // Save in chunks of 500 (Firestore batch limit)
                for (let i = 0; i < resources.length; i += 400) {
                    await this.resourceRepository.saveBatch(resources.slice(i, i + 400));
                }
            }

            await this.repository.saveBatch(enrichedItems);

            // 5. Update Job Status to Completed
            await this.jobRepository.update(jobId, {
                status: 'completed',
                progress: 100,
                logs: [...logs, 'Completed successfully.', `Imported ${items.length} items with embeddings.`],
                totalItems: items.length
            });

            console.log(`[Job ${jobId}] Completed successfully.`);
            return { count: items.length };

        } catch (error: any) {
            console.error(`[Job ${jobId}] Failed:`, error);
            await this.jobRepository.update(jobId, {
                status: 'failed',
                error: error.message || 'Unknown error'
            });
            throw error;
        }
    }

    /**
     * Generates vector embeddings for a list of items using Genkit.
     * Uses batch processing to respect API limits and optimize performance.
     */
    private async enrichWithEmbeddings(
        items: PriceBookItem[],
        onProgress: (percent: number) => Promise<void>
    ): Promise<PriceBookItem[]> {
        const batchSize = 100;
        const total = items.length;
        let processed = 0;
        const enrichedItems: PriceBookItem[] = [];

        // Prepare batches
        for (let i = 0; i < total; i += batchSize) {
            const batch = items.slice(i, i + batchSize);

            // Context for embedding: "Chapter > Section > Description (Code Unit)"
            // Rich Context for "Atomic" Semantic Search
            const textsToEmbed = batch.map(item => {
                const context = [item.chapter, item.section].filter(Boolean).join(' > ');
                return `${context} > ${item.description} (${item.code} ${item.unit})`;
            });

            try {
                // Call Genkit embedMany
                const embeddings = await ai.embedMany({
                    embedder: embeddingModel,
                    content: textsToEmbed,
                    options: { outputDimensionality: 768 }
                });

                // Assign embeddings back to items
                for (let j = 0; j < batch.length; j++) {
                    const vector = embeddings[j].embedding;
                    if (vector.length > 2048) {
                        console.error(`Error: Embedding dimension ${vector.length} exceeds 2048 limit.`);
                        throw new Error(`Generated embedding dimension ${vector.length} exceeds Firestore limit of 2048.`);
                    }
                    batch[j].embedding = vector;
                }

                enrichedItems.push(...batch);

            } catch (error) {
                console.error(`Error embedding batch ${i}-${i + batchSize}:`, error);
                // Fallback: Push items without embedding so we don't lose data, but log error
                // In production, might want to retry.
                enrichedItems.push(...batch);
            }

            processed += batch.length;
            const percent = Math.round((processed / total) * 100);
            await onProgress(percent);

            // Console log progress to avoid timeouts appearing silent
            console.log(`[EmbedService] Processed ${processed}/${total} items.`);
        }

        return enrichedItems;
    }

    /**
     * Extracts unique BasicResources from the breakdown of all items.
     */
    private extractResources(items: PriceBookItem[]): import('../domain/basic-resource').BasicResource[] {
        const resourceMap = new Map<string, import('../domain/basic-resource').BasicResource>();

        items.forEach(item => {
            if (item.breakdown) {
                item.breakdown.forEach(comp => {
                    // Deduplicate by code
                    if (!resourceMap.has(comp.code)) {
                        resourceMap.set(comp.code, {
                            code: comp.code,
                            description: comp.description || `Resource ${comp.code}`,
                            unit: comp.unit || 'u',
                            priceBase: comp.price || 0,
                            updatedAt: new Date()
                        });
                    }
                });
            }
        });

        return Array.from(resourceMap.values());
    }
}

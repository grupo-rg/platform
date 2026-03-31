// @ts-nocheck
'use server';

import { FirestorePriceBookRepository } from '@/backend/price-book/infrastructure/firestore-price-book-repository';
import { FirestoreIngestionJobRepository } from '@/backend/price-book/infrastructure/firestore-ingestion-job-repository';
import { IngestionJob } from '@/backend/price-book/domain/ingestion-job';
import { FirestoreBasicResourceRepository } from '@/backend/price-book/infrastructure/firestore-basic-resource-repository';

export async function ingestPriceBookAction(fileUrl: string, fileName: string, year: number) {
    console.log("Action: Ingest Price Book (Async Trigger)", fileName, year);

    const jobId = crypto.randomUUID();
    // const year = new Date().getFullYear(); // Removed hardcoded default

    // ...

    // Application Service
    // Deprecated LLM Price Book Parser logic
    // const parser = new LLMPriceBookParser(); 
    // const repository = new FirestorePriceBookRepository();

    // 1. Create Initial Job Record
    const newJob: IngestionJob = {
        id: jobId,
        fileName,
        fileUrl,
        status: 'pending',
        progress: 0,
        year: year,
        createdAt: new Date(),
        updatedAt: new Date()
    };

    try {
        await jobRepository.create(newJob);

        // Ingestion is now handled by vectorized scripts natively (Phase 1)
        return { success: true, jobId: jobId };

        return { success: true, jobId: jobId };

    } catch (error: any) {
        console.error("Action Error:", error);
        return { success: false, error: error.message || 'Failed to start job' };
    }
}

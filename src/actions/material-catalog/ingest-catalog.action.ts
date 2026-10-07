'use server';

import { checkAdmin, unauthorizedResult } from '@/actions/_guards';

import { IngestMaterialCatalogService } from '@/backend/material-catalog/application/ingest-catalog-service';
import { FirestoreMaterialCatalogRepository } from '@/backend/material-catalog/infrastructure/firestore-material-catalog-repository';

const repository = new FirestoreMaterialCatalogRepository();
const service = new IngestMaterialCatalogService(repository);

export async function ingestCatalogAction(pdfBase64: string, year: number, jobId: string, concurrency: number = 5) {
    if (!(await checkAdmin())) return unauthorizedResult();
    try {
        const result = await service.execute(pdfBase64, {
            year,
            source: 'manual_upload',
            concurrency
        }, jobId);
        return { success: true, count: result.totalItems };
    } catch (error: any) {
        console.error("Ingestion Error:", error);
        return { success: false, error: error.message };
    }
}


'use server';

import { checkAdmin, unauthorizedResult } from '@/actions/_guards';

import { FirestoreIngestionJobRepository } from '@/backend/price-book/infrastructure/firestore-ingestion-job-repository';

export async function checkIngestionJobStatus(jobId: string) {
    if (!(await checkAdmin())) return unauthorizedResult();
    const jobRepo = new FirestoreIngestionJobRepository();
    const job = await jobRepo.findById(jobId);

    if (!job) {
        return { success: false, error: 'Job not found' };
    }

    return {
        success: true,
        job: {
            ...job,
            createdAt: job.createdAt.toISOString(),
            updatedAt: job.updatedAt.toISOString(),
        }
    };
}

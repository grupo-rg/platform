'use server';

import { checkAdmin, unauthorizedResult } from '@/actions/_guards';

import { processPriceBookPdf } from '@/genkit/ingestion';

export async function ingestPriceBook(fileUrl: string, fileName: string) {
    if (!(await checkAdmin())) return unauthorizedResult();
    console.log("Starting Ingestion for: ", fileName);

    try {
        const result = await processPriceBookPdf(fileUrl, new Date().getFullYear());
        return { success: true, count: result.count };
    } catch (error) {
        console.error(error);
        return { success: false, error: 'Failed to process PDF' };
    }
}

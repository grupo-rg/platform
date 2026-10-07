'use server';

import { checkAdmin, unauthorizedResult } from '@/actions/_guards';

import { GeminiFilesService } from '@/backend/ai/core/infrastructure/gemini-files.service';
import { measurementPricingFromItemsFlow } from '@/backend/ai/private/flows/measurements/measurement-pricing.flow';

export async function checkBatchJobStatusAction(jobId: string) {
    if (!(await checkAdmin())) return unauthorizedResult();
    try {
        const job = await GeminiFilesService.getBatchJobStatus(jobId);

        // Return standard states
        return {
            success: true,
            state: job.state, // e.g. 'JOB_STATE_SUCCEEDED', 'JOB_STATE_RUNNING', etc
            jobData: {
                createTime: job.createTime,
                updateTime: job.updateTime,
            }
        };
    } catch (e: any) {
        console.error("[checkBatchJobStatusAction] Error:", e);
        return { success: false, error: e.message };
    }
}

export async function processBatchJobResultAction(jobId: string) {
    if (!(await checkAdmin())) return unauthorizedResult();
    try {
        const job = await GeminiFilesService.getBatchJobStatus(jobId);

        if (job.state !== 'JOB_STATE_SUCCEEDED' && job.state !== 'SUCCEEDED') {
            return { success: false, error: "El trabajo aún no se ha completado." };
        }

        // 1. Fetch JSONL Output from Gemini File API
        const outputUri = job.outputUri; // Depending on SDK: outputUri or outputFile.uri
        if (!outputUri) {
            return { success: false, error: "URI de resultado no encontrado." };
        }

        // Fetching from a standard HTTP URI or pulling via Google API
        // Workaround for raw SDK: usually the `outputUri` is a GCS URL or a GenAI file URL
        // Let's assume the SDK provides a way to download, or we fetch it:
        console.log(`[checkBatchJobStatusAction] Fetching batch results from ${outputUri}`);
        let items: any[] = [];
        const response = await fetch(outputUri);
        if (response.ok) {
            const text = await response.text();
            // JSONL processing
            const lines = text.split('\n').filter(l => l.trim().length > 0);
            for (const line of lines) {
                try {
                    const parsed = JSON.parse(line);
                    // The result contains the requested output. Format depends on AI response.
                    // Gemini usually returns {"response": {"candidates": [{"content": {"parts": [{"text": "..."}]}}]}}
                    const responseText = parsed?.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    if (responseText) {
                        try {
                            const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
                            const outputObj = JSON.parse(cleanJson);
                            if (outputObj.items && Array.isArray(outputObj.items)) {
                                items.push(...outputObj.items);
                            }
                        } catch (parseJSONError) {
                            console.error("Failed to parse inner JSON from Batch:", parseJSONError);
                        }
                    }
                } catch (e) {
                    console.error("Failed to parse JSONL line:", e);
                }
            }
        }

        if (items.length === 0) {
            return { success: false, error: "No se encontraron partidas válidas en el resultado." };
        }

        // 2. Price the extracted items
        const pricingResult = await measurementPricingFromItemsFlow({
            items,
            projectName: "Presupuesto desde Lotes"
        });

        return {
            success: true,
            data: pricingResult
        };

    } catch (e: any) {
        console.error("[processBatchJobResultAction] Error:", e);
        return { success: false, error: e.message };
    }
}

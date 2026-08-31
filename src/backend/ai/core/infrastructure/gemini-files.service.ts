import { getFilesApiClient as getGeminiClient } from './gemini-client';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

export const GeminiFilesService = {
    /**
     * Uploads base64 data to Google's GenAI File Storage.
     */
    async uploadBase64(base64Data: string, mimeType: string, displayName: string = 'document') {
        const client = getGeminiClient();
        const buffer = Buffer.from(base64Data, 'base64');
        const safeName = displayName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const tempFilePath = path.join(os.tmpdir(), `${Date.now()}_${safeName}`);

        await fs.writeFile(tempFilePath, buffer);

        try {
            const uploadResult = await client.files.upload({
                file: tempFilePath,
                config: {
                    mimeType: mimeType,
                    displayName: displayName
                }
            });
            console.log(`[GeminiFilesService] Uploaded ${displayName} as ${uploadResult.name} (${uploadResult.uri})`);
            return uploadResult;
        } finally {
            // Clean up local temp file
            await fs.unlink(tempFilePath).catch(e => console.error(`[GeminiFilesService] Cleanup error:`, e));
        }
    },

    /**
     * Gets metadata for an uploaded file.
     */
    async getFile(name: string) {
        const client = getGeminiClient();
        return await client.files.get({ name });
    },

    /**
     * Deletes a file from Gemini storage.
     */
    async deleteFile(name: string) {
        const client = getGeminiClient();
        return await client.files.delete({ name });
    },

    /**
     * Creates a Batch processing job for a large PDF extraction.
     * Note: We use `as any` for `client.batches` in case the local SDK types are incomplete.
     */
    async createBatchExtractionJob(pdfFileUri: string, promptText: string) {
        const client = getGeminiClient();

        // Create the JSONL request object
        // The Batch API expects each line to be a valid GenerateContent request
        const batchRequest = {
            request: {
                model: "models/gemini-2.5-flash",
                contents: [
                    {
                        role: "user",
                        parts: [
                            { text: promptText },
                            { fileData: { fileUri: pdfFileUri, mimeType: "application/pdf" } }
                        ]
                    }
                ],
                generationConfig: {
                    temperature: 0.1
                }
            }
        };

        const jsonlContent = JSON.stringify(batchRequest) + "\n";

        // Upload the JSONL file to Gemini
        const jsonlBase64 = Buffer.from(jsonlContent).toString('base64');
        const jsonlFile = await this.uploadBase64(jsonlBase64, 'application/jsonl', 'extraction_batch.jsonl');

        // Create the Batch Job
        // The @google/genai SDK usually takes a dataset object or directly the input file URI.
        try {
            const batchClient = (client as any).batches;
            if (!batchClient) {
                throw new Error("Batch API is not available on this version of the @google/genai SDK.");
            }

            const batchJob = await batchClient.create({
                model: "models/gemini-2.5-flash",
                src: { fileName: jsonlFile.name }
            });

            console.log(`[GeminiFilesService] Batch Job Created: ${batchJob.name}`);
            return batchJob;
        } catch (error) {
            console.error("[GeminiFilesService] Error creating batch job:", error);
            throw error;
        }
    },

    /**
     * Gets the status of a batch job.
     */
    async getBatchJobStatus(jobName: string) {
        const client = getGeminiClient();
        return await (client as any).batches.get({ name: jobName });
    }
};

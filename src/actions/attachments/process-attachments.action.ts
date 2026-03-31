'use server';

import { analyzeAttachmentsFlow } from '@/backend/ai/private-core/flows/analyze-attachments.flow';
import { adminStorage } from '@/backend/shared/infrastructure/firebase/admin-app';
import { v4 as uuidv4 } from 'uuid';

export async function processAttachmentsAction(formData: FormData) {
    try {
        const files = formData.getAll('files') as File[];
        if (!files || files.length === 0) throw new Error("No files provided");

        const processedFiles = await Promise.all(files.map(async (file) => {
            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            return {
                base64: buffer.toString('base64'),
                mimeType: file.type || 'application/octet-stream',
            };
        }));

        const result = await analyzeAttachmentsFlow({
            files: processedFiles,
        });

        // Upload to Cloud Storage to prevent 1MB Firestore limits and allow Python fetching
        const uploadedUrls = await Promise.all(processedFiles.map(async (f, index) => {
            const file = files[index];
            const uniqueFileName = `chat-attachments/${uuidv4()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
            const fileRef = adminStorage.bucket().file(uniqueFileName);
            
            await fileRef.save(Buffer.from(f.base64, 'base64'), {
                metadata: { contentType: f.mimeType }
            });

            try {
                await fileRef.makePublic();
                return `https://storage.googleapis.com/${adminStorage.bucket().name}/${uniqueFileName}`;
            } catch (e) {
                // If bucket doesn't allow public ACLs, fallback to long-lived signed URL
                const [signedUrl] = await fileRef.getSignedUrl({ action: 'read', expires: '01-01-2099' });
                return signedUrl;
            }
        }));

        return { success: true, analysis: result.analysis, urls: uploadedUrls };
    } catch (error: any) {
        console.error("Attachment processing error:", error);
        return { success: false, error: error.message };
    }
}

'use server';

import { transcribeAudioFlow } from '@/backend/ai/private-core/flows/transcribe-audio.flow';

export async function processAudioAction(formData: FormData) {
    try {
        const file = formData.get('audio') as File;
        if (!file) throw new Error("No audio file provided");

        // Convert File to Base64
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString('base64');
        const mimeType = file.type || 'audio/webm'; // Default fallback

        // Call Genkit Flow
        const result = await transcribeAudioFlow({
            audioBase64: base64,
            mimeType: mimeType,
        });

        return { success: true, transcription: result.transcription };
    } catch (error: any) {
        console.error("Audio processing error:", error);
        return { success: false, error: error.message };
    }
}

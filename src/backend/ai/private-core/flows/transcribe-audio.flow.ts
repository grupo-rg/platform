import { z, Part } from 'genkit';
import { ai, gemini25Flash } from '@/backend/ai/shared/config/genkit.config';

const TranscriptionInput = z.object({
    audioBase64: z.string(),
    mimeType: z.string(),
});

const TranscriptionOutput = z.object({
    transcription: z.string(),
});

export const transcribeAudioFlow = ai.defineFlow(
    {
        name: 'transcribeAudioFlow',
        inputSchema: TranscriptionInput,
        outputSchema: TranscriptionOutput,
    },
    async (input) => {
        const { audioBase64, mimeType } = input;

        const prompt = `
            Please transcribe the following audio file exactly as spoken. 
            The user is likely describing a construction or renovation project.
            Pay attention to numbers, dimensions, and technical terms (e.g., "alicatado", "pladur", "solera").
            Do not add any commentary, just return the transcription.
        `;

        // Create a media part
        const audioPart: Part = {
            media: {
                url: `data:${mimeType};base64,${audioBase64}`,
                contentType: mimeType,
            },
        };

        const result = await ai.generate({
            model: gemini25Flash,
            prompt: [
                { text: prompt },
                audioPart
            ],
            config: {
                temperature: 0.1, // Low temp for accuracy
            },
        });

        return {
            transcription: result.text,
        };
    }
);

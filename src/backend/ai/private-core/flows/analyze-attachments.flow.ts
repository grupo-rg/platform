import { z, Part } from 'genkit';
import { ai, gemini25Flash } from '@/backend/ai/shared/config/genkit.config';

const AttachmentInput = z.object({
    files: z.array(z.object({
        base64: z.string(),
        mimeType: z.string(),
    })),
});

const AttachmentOutput = z.object({
    analysis: z.string(),
    detectedFeatures: z.array(z.string()),
});

export const analyzeAttachmentsFlow = ai.defineFlow(
    {
        name: 'analyzeAttachmentsFlow',
        inputSchema: AttachmentInput,
        outputSchema: AttachmentOutput,
    },
    async (input) => {
        const { files } = input;

        const prompt = `
            You are an expert Quantity Surveyor and Architect.
            Analyze the attached images or documents (floor plans, photos of rooms, etc.).
            
            1. Describe what you see in technical terms suitable for a budget estimation.
            2. If it's a floor plan, estimate room counts and rough areas if possible.
            3. If it's a photo, describe current condition, materials (e.g., "gotelé walls", "terrazzo floor"), and likely renovation needs.
            
            Return a summary description and a list of specific detected features.
        `;

        const parts: Part[] = [{ text: prompt }];

        files.forEach(file => {
            parts.push({
                media: {
                    url: `data:${file.mimeType};base64,${file.base64}`,
                    contentType: file.mimeType,
                }
            });
        });

        const result = await ai.generate({
            model: gemini25Flash,
            prompt: parts,
            config: {
                temperature: 0.2,
            },
        });

        // Simple parsing or just return text. 
        // For structured output, we could use outputSchema/output() but text is fine for context injection.

        return {
            analysis: result.text,
            detectedFeatures: [], // We could extract this if we asked for JSON, but text is enough generally.
        };
    }
);

import { z } from 'genkit';
import { ai } from '@/backend/ai/shared/config/genkit.config';
import { gemini25Flash } from '@/backend/ai/shared/config/genkit.config';
import { Prompts, SubtaskExtractionSchema } from '@/backend/ai/shared/prompts/prompt-registry';

/**
 * subtaskExtractionPrompt — inline definition replacing the file-based .prompt file.
 *
 * It generates requests by referencing the clean shared PromptRegistry instead
 * of defining a massive multi-line string directly in this flow handler.
 */
export const subtaskExtractionPrompt = {
    run: async (input: { userRequest: string }) => {
        const { system, fewShotHistory, buildUserMessage } = Prompts.SubtaskExtraction;

        const result = await ai.generate({
            model: gemini25Flash,
            system: system,
            messages: fewShotHistory,
            prompt: buildUserMessage(input.userRequest),
            config: {
                temperature: 0.1,
                topK: 40,
                topP: 0.95,
            },
            output: {
                schema: SubtaskExtractionSchema,
            },
        });
        return result;
    }
};

export const extractionFlow = ai.defineFlow(
    {
        name: 'extractionFlow',
        inputSchema: z.object({
            userRequest: z.string(),
        }),
        outputSchema: SubtaskExtractionSchema,
    },
    async (input) => {
        const result = await subtaskExtractionPrompt.run({
            userRequest: input.userRequest,
        });

        if (!result.output) {
            throw new Error('Failed to generate subtasks');
        }

        return result.output;
    }
);

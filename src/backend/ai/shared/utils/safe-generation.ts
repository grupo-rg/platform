
import { ai } from '@/backend/ai/shared/config/genkit.config';
import { GenerateOptions, GenerateResponse } from 'genkit';

/**
 * Wraps ai.generate with retry logic for 429 errors.
 * Simple exponential backoff.
 */
export async function safeGenerate<O extends import('zod').ZodTypeAny = import('zod').ZodTypeAny>(
    options: GenerateOptions<O>,
    retries: number = 3,
    delayMs: number = 2000
): Promise<GenerateResponse<O>> {
    try {
        return await ai.generate(options);
    } catch (error: any) {
        if (retries > 0 && (error.status === 429 || error.message?.includes('429'))) {
            console.warn(`[SafeGenerate] 429 Rate Limit hit. Retrying in ${delayMs}ms... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            return safeGenerate(options, retries - 1, delayMs * 2);
        }
        throw error;
    }
}

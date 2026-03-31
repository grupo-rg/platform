import { ai } from '@/backend/ai/shared/config/genkit.config';
import { GenerateOptions, GenerateResponse } from 'genkit';

/**
 * Exponential backoff wrapper for AI generation to handle transient 'fetch failed' errors.
 * This ensures the application is scalable and fault-tolerant in production environments
 * against transient network issues, rate limits, and Node.js IPv6 resolution bugs.
 */
export async function generateWithRetry(
    options: any,
    maxRetries = 5,
    baseDelayMs = 4000
): Promise<any> {
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            return await ai.generate(options);
        } catch (error: any) {
            attempt++;

            const errorMessage = error?.message || '';
            const isRetriable =
                errorMessage.includes('fetch failed') ||
                errorMessage.includes('ECONNRESET') ||
                errorMessage.includes('Timeout') ||
                errorMessage.includes('socket hang up') ||
                error?.status === 429 || // Too Many Requests
                (error?.status >= 500 && error?.status < 600); // Server errors

            if (!isRetriable || attempt >= maxRetries) {
                console.error(`[AI Retry] Fatal error or max retries reached (${attempt}/${maxRetries}). Error:`, errorMessage);
                throw error;
            }

            // Exponential backoff: 1.5s, 3s, 6s...
            const delay = baseDelayMs * Math.pow(2, attempt - 1);
            console.warn(`[AI Retry] Transient error '${errorMessage}'. Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw new Error('AI Generation failed after max retries');
}

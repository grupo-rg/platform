import { z } from 'zod';
import { AsyncLocalStorage } from 'async_hooks';

/**
 * Genkit Context Schema
 * Carries authentication and session information through the Genkit flow execution.
 */
export const GenkitContextSchema = z.object({
    userId: z.string().optional(),
    role: z.enum(['admin', 'user', 'guest']).default('guest'),
    sessionId: z.string().optional(),
    traceId: z.string().optional(),
});

export type GenkitContext = z.infer<typeof GenkitContextSchema>;

// Async Local Storage to hold context implicitly if needed (though Genkit supports explicit context passing)
// For now, we define the schema to use in flow definitions.
export const contextStorage = new AsyncLocalStorage<GenkitContext>();

/**
 * Helper to execute a function with a given context
 */
export function runWithContext<T>(context: GenkitContext, fn: () => Promise<T>): Promise<T> {
    return contextStorage.run(context, fn);
}

/**
 * Helper to get current context
 */
export function getCurrentContext(): GenkitContext | undefined {
    return contextStorage.getStore();
}

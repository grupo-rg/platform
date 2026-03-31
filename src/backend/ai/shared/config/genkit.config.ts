import { genkit } from 'genkit';
import { googleAI, geminiEmbedding001, textEmbedding004, gemini } from '@genkit-ai/googleai';
import dns from 'node:dns';

/**
 * Shared Genkit Instance Configuration.
 * Initializes Genkit with Google AI plugin and exports the AI instance and Embedding Model.
 */

// Fix for Node.js Undici fetch taking 60s to timeout on Windows IPv6 networks
dns.setDefaultResultOrder('ipv4first');

// Initialize Genkit
export const ai = genkit({
    plugins: [
        googleAI(), // Automatically uses GOOGLE_GENAI_API_KEY from env
    ],
    promptDir: 'src/backend/ai/prompts', // Explicitly set prompt directory
});

// Export the Embedding Model Reference
// Using geminiEmbedding001 which supports outputDimensionality.
// Firestore requires exactly 768 dimensions.
export const embeddingModel = geminiEmbedding001;

// Use the model reference from the plugin
export const gemini25Flash = gemini('gemini-2.5-flash');

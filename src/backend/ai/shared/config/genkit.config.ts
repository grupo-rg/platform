import { genkit } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';
import dns from 'node:dns';
import { getVertexPluginConfig } from './vertex-auth';
import { defineEuEmbedder } from './eu-embedder';
import { GEMINI_FLASH_MODEL, GEMINI_PRO_MODEL } from './gemini-models';
import { withGeminiFamilyConfig } from './genkit-family-config';

/**
 * Shared Genkit Instance Configuration.
 * Inicializa Genkit con Vertex AI (Gemini Enterprise Agent Platform) y exporta
 * la instancia `ai`, el embedder y las referencias de modelo.
 *
 * Migración Gemini 3.x (2026-09): plugin `@genkit-ai/google-genai` en location
 * `global` (único endpoint con Gemini 3.x) para generación; embeddings en la
 * región UE vía `defineEuEmbedder`. Ver `core/config/genkit.config.ts`.
 */

// Fix for Node.js Undici fetch taking 60s to timeout on Windows IPv6 networks
dns.setDefaultResultOrder('ipv4first');

// Initialize Genkit (+ config por familia Gemini en generate/generateStream)
export const ai = withGeminiFamilyConfig(
    genkit({
        plugins: [
            vertexAI(getVertexPluginConfig()),
        ],
        promptDir: 'src/backend/ai/prompts', // Explicitly set prompt directory
    }),
);

// Embedder gemini-embedding-001 en europe-southwest1 (Firestore requiere 768 dims;
// los call sites pasan `options: { outputDimensionality: 768 }`).
export const embeddingModel = defineEuEmbedder(ai);

// Referencias de modelo (reparto aprobado: Flash = volumen, Pro = razonamiento).
export const geminiFlash = vertexAI.model(GEMINI_FLASH_MODEL);
export const geminiPro = vertexAI.model(GEMINI_PRO_MODEL);

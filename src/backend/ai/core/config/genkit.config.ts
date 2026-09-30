import { genkit } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';
import { getVertexPluginConfig } from '../../shared/config/vertex-auth';
import { defineEuEmbedder } from '../../shared/config/eu-embedder';
import { GEMINI_FLASH_MODEL, GEMINI_PRO_MODEL } from '../../shared/config/gemini-models';
import { withGeminiFamilyConfig } from '../../shared/config/genkit-family-config';

/**
 * Shared Genkit Instance Configuration.
 * Inicializa Genkit con Vertex AI (Gemini Enterprise Agent Platform) y exporta
 * la instancia `ai`, el embedder y las referencias de modelo.
 *
 * Migración Gemini 3.x (2026-09): plugin `@genkit-ai/google-genai` (sucesor de
 * `@genkit-ai/vertexai`, cuyo SDK `@google-cloud/vertexai` está deprecado y no
 * sabe hablar con el endpoint `global`). Generación en `global` (único endpoint
 * con Gemini 3.x); embeddings en la región UE vía `defineEuEmbedder`.
 * Config por familia (temperatura / thinking): `geminiConfig()` en
 * `shared/config/gemini-models.ts`.
 */

// Initialize Genkit (+ config por familia Gemini en generate/generateStream)
export const ai = withGeminiFamilyConfig(
    genkit({
        plugins: [
            vertexAI(getVertexPluginConfig()),
        ],
        promptDir: 'src/backend/ai/prompts', // Explicitly set prompt directory
    }),
);

// Embedder gemini-embedding-001 en europe-southwest1 (sin cambio de vectores).
// Los call sites pasan `options: { outputDimensionality: 768 }` (Firestore @768).
export const embeddingModel = defineEuEmbedder(ai);

// Referencias de modelo (reparto aprobado: Flash = volumen, Pro = razonamiento).
export const geminiFlash = vertexAI.model(GEMINI_FLASH_MODEL);
export const geminiPro = vertexAI.model(GEMINI_PRO_MODEL);

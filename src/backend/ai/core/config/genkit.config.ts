
import { genkit } from 'genkit';
import { vertexAI, geminiEmbedding001, gemini } from '@genkit-ai/vertexai';
import { getVertexPluginConfig } from '../../shared/config/vertex-auth';

/**
 * Shared Genkit Instance Configuration.
 * Inicializa Genkit con el plugin Vertex AI (Gemini Enterprise Agent Platform)
 * y exporta la instancia `ai` y el modelo de embeddings.
 *
 * Migrado desde el plugin `googleAI()` (Gemini Developer API / AI Studio, con
 * saldo prepago) a Vertex AI (pago por uso vía la cuenta de facturación de GCP).
 * Los IDs de modelo y el nombre del embedder son idénticos; sólo cambia el
 * proveedor y la autenticación (service-account en vez de API key).
 */

// Initialize Genkit
export const ai = genkit({
    plugins: [
        vertexAI(getVertexPluginConfig()),
    ],
    promptDir: 'src/backend/ai/prompts', // Explicitly set prompt directory
});

// Export the Embedding Model Reference
// Using geminiEmbedding001 which supports outputDimensionality.
// Firestore requires exactly 768 dimensions.
export const embeddingModel = geminiEmbedding001;

// Use the model reference from the plugin
export const gemini25Flash = gemini('gemini-2.5-flash');

import { GoogleGenAI } from '@google/genai';
import { z, type Genkit } from 'genkit';
import { getEmbeddingLocation, getVertexGoogleAuth, getVertexProjectId } from './vertex-auth';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID } from './gemini-models';

/**
 * Embedder `gemini-embedding-001` fijado a la región UE (europe-southwest1).
 *
 * Por qué existe: el plugin de generación (`@genkit-ai/google-genai`, necesario
 * para Gemini 3.x) está configurado en `location: 'global'`, y su embedder NO
 * admite override de región por petición (ignora `options.location`). Como los
 * embeddings deben quedarse en la UE (decisión aprobada; y cambiar de modelo
 * exigiría re-vectorizar), definimos un embedder propio sobre `@google/genai`
 * con un cliente Vertex regional. Mismo modelo, mismas dimensiones (768 vía
 * `outputDimensionality`), mismos vectores que ya hay en Firestore.
 *
 * Se registra como `vertexai-eu/gemini-embedding-001` (el nombre
 * `vertexai/gemini-embedding-001` ya lo registra el plugin global).
 */
export const EU_EMBEDDER_NAME = `vertexai-eu/${EMBEDDING_MODEL_ID}`;

const EuEmbedderConfigSchema = z
    .object({
        outputDimensionality: z.number().min(1).max(3072).optional(),
        taskType: z.string().optional(),
        title: z.string().optional(),
    })
    .passthrough();

let embeddingClient: GoogleGenAI | null = null;

/** Cliente `@google/genai` Vertex en la región de EMBEDDINGS (lazy). */
export function getEmbeddingClient(): GoogleGenAI {
    if (!embeddingClient) {
        embeddingClient = new GoogleGenAI({
            vertexai: true,
            project: getVertexProjectId(),
            location: getEmbeddingLocation(),
            // cast: @google/genai empaqueta su propia copia de google-auth-library.
            googleAuthOptions: getVertexGoogleAuth() as any,
        });
    }
    return embeddingClient;
}

/** Registra el embedder UE en la instancia Genkit `ai` y lo devuelve. */
export function defineEuEmbedder(ai: Genkit) {
    return ai.defineEmbedder(
        {
            name: EU_EMBEDDER_NAME,
            configSchema: EuEmbedderConfigSchema,
            info: {
                label: `Vertex AI (${getEmbeddingLocation()}) - ${EMBEDDING_MODEL_ID}`,
                dimensions: EMBEDDING_DIMENSIONS,
                supports: { input: ['text'], multilingual: true },
            },
        },
        async (input, options) => {
            const texts = input.map((doc) => doc.text);
            const res = await getEmbeddingClient().models.embedContent({
                model: EMBEDDING_MODEL_ID,
                contents: texts,
                config: {
                    outputDimensionality: options?.outputDimensionality,
                    taskType: options?.taskType,
                    title: options?.title,
                },
            });
            const embeddings = res.embeddings ?? [];
            if (embeddings.length !== texts.length) {
                throw new Error(
                    `[eu-embedder] esperado ${texts.length} embeddings, recibidos ${embeddings.length}`,
                );
            }
            return { embeddings: embeddings.map((e) => ({ embedding: e.values ?? [] })) };
        },
    );
}

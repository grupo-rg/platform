import { VectorizerPort } from '../../domain/vectorizer.port';
import { ai, embeddingModel } from '@/backend/ai/shared/config/genkit.config';

/**
 * Vectorizador basado en Vertex AI (Gemini Enterprise Agent Platform) vía Genkit.
 *
 * Migrado desde la Gemini Developer API (REST con API key + saldo prepago
 * agotado) a Vertex (pago por uso vía la cuenta de facturación de GCP). Usa el
 * MISMO modelo `gemini-embedding-001` con `outputDimensionality: 768`, así que
 * los vectores son compatibles con los ya almacenados en Firestore (campo
 * `embedding`) — no requiere re-indexar.
 *
 * (Se mantiene el nombre `RestApiVectorizerAdapter` para no tocar los ~10 sitios
 * que lo instancian; internamente ya no es REST.)
 */
export class RestApiVectorizerAdapter implements VectorizerPort {
    async embedText(text: string): Promise<number[]> {
        if (!text) throw new Error("Text to embed cannot be empty");

        const result = await ai.embed({
            embedder: embeddingModel,
            content: text,
            options: { outputDimensionality: 768 },
        });

        const vector = Array.isArray(result)
            ? result[0]?.embedding
            : (result as any).embedding;

        if (!vector || vector.length === 0) {
            throw new Error("Vertex embedding returned an empty vector");
        }
        return vector;
    }

    async embedMany(texts: string[]): Promise<number[][]> {
        if (!texts.length) return [];

        const results = await ai.embedMany({
            embedder: embeddingModel,
            content: texts,
            options: { outputDimensionality: 768 },
        });

        return results.map((r) => r.embedding);
    }
}

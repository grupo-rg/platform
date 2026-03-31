
import { VectorizerPort } from '../../domain/vectorizer.port';

interface GeminiEmbeddingResponse {
    embedding: {
        values: number[];
    };
}

export class RestApiVectorizerAdapter implements VectorizerPort {
    private apiKey: string;
    // Reverted to gemini-embedding-001 as text-embedding-004 is unavailable for this key
    private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';

    constructor() {
        const key = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY;
        if (!key) throw new Error("GOOGLE_GENAI_API_KEY or GEMINI_API_KEY is not set");
        this.apiKey = key;
    }

    async embedText(text: string): Promise<number[]> {
        if (!text) throw new Error("Text to embed cannot be empty");

        const url = `${this.baseUrl}?key=${this.apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: { parts: [{ text }] },
                outputDimensionality: 768
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini API Error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data = await response.json() as GeminiEmbeddingResponse;
        return data.embedding.values;
    }

    async embedMany(texts: string[]): Promise<number[][]> {
        // Simple parallel implementation. 
        // Note: For large batches, we might need rate limiting/throttling.
        // But the UseCase sends batches of 50, which should be fine for concurrency.
        return Promise.all(texts.map(text => this.embedText(text)));
    }
}

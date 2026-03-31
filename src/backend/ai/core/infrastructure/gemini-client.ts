import { GoogleGenAI } from "@google/genai";

// Ensure we use the same key as Genkit
const apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY;

if (!apiKey) {
    throw new Error("Missing GOOGLE_GENAI_API_KEY or GEMINI_API_KEY environment variable");
}

let geminiClient: GoogleGenAI | null = null;

export const getGeminiClient = () => {
    if (!geminiClient) {
        geminiClient = new GoogleGenAI({
            apiKey: apiKey,
        });
    }
    return geminiClient;
};

/**
 * Vertex AI client for features with geo-restrictions (e.g. image generation).
 * Uses Application Default Credentials via the service account.
 */
let vertexClient: GoogleGenAI | null = null;

export const getVertexAIClient = () => {
    if (!vertexClient) {
        const project = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
        if (!project) {
            throw new Error("Missing GCLOUD_PROJECT or FIREBASE_PROJECT_ID for Vertex AI");
        }
        vertexClient = new GoogleGenAI({
            vertexai: true,
            project,
            location: 'europe-west1',
        });
    }
    return vertexClient;
};

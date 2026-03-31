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

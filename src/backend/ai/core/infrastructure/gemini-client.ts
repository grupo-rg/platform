import { GoogleGenAI } from "@google/genai";
import { getVertexProjectId, getVertexLocation, getVertexGoogleAuth } from "../../shared/config/vertex-auth";

/**
 * Cliente `@google/genai` en modo Vertex AI (Gemini Enterprise Agent Platform),
 * facturado por uso contra la cuenta de GCP. Reemplaza el cliente anterior
 * basado en API key de la Gemini Developer API (saldo prepago agotado).
 *
 * Lazy: NO lanza en el import; construye al primer uso. En Vercel usa las
 * credenciales explícitas del service-account (via getVertexGoogleAuth); en
 * Cloud Run/local usa ADC.
 */
let vertexClient: GoogleGenAI | null = null;

export const getGeminiClient = (): GoogleGenAI => {
    if (!vertexClient) {
        vertexClient = new GoogleGenAI({
            vertexai: true,
            project: getVertexProjectId(),
            location: getVertexLocation(),
            // cast: @google/genai empaqueta su propia copia de google-auth-library
            // (genérico AnyAuthClient) distinta de la del helper; el shape es idéntico.
            googleAuthOptions: getVertexGoogleAuth() as any,
        });
    }
    return vertexClient;
};

/** Alias mantenido por compatibilidad con llamadas existentes. */
export const getVertexAIClient = getGeminiClient;

/**
 * Cliente de la Gemini Developer API (API key) SÓLO para la Files API / Batch
 * API, que Vertex AI no expone de la misma forma (usa GCS URIs en su lugar).
 * Pendiente de migrar a Vertex+GCS — ver `gemini-files.service.ts`.
 *
 * Lazy para no romper el import cuando no hay API key.
 */
let filesApiClient: GoogleGenAI | null = null;

export const getFilesApiClient = (): GoogleGenAI => {
    if (!filesApiClient) {
        const apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error(
                "Files/Batch API requiere GOOGLE_GENAI_API_KEY (pendiente de migrar a Vertex+GCS)"
            );
        }
        filesApiClient = new GoogleGenAI({ apiKey });
    }
    return filesApiClient;
};

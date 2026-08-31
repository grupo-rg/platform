import { GoogleGenAI } from "@google/genai";
import { getVertexProjectId, getVertexLocation, getVertexGoogleAuth } from "../shared/config/vertex-auth";

/**
 * Cliente `@google/genai` en modo Vertex AI (Gemini Enterprise Agent Platform),
 * facturado por uso contra la cuenta de GCP. Reemplaza el cliente anterior
 * basado en API key de la Gemini Developer API (saldo prepago agotado).
 *
 * Lazy: NO lanza en el import; construye al primer uso.
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

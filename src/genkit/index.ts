
import { genkit } from 'genkit';
import { vertexAI } from '@genkit-ai/vertexai';
import { getVertexPluginConfig } from '@/backend/ai/shared/config/vertex-auth';
// import { firebase } from '@genkit-ai/firebase';

export const ai = genkit({
    plugins: [
        vertexAI(getVertexPluginConfig()),
        // firebase(), // Temporarily disabled due to import error // Temporarily disabled due to import error
    ],
    model: 'vertexai/gemini-2.5-flash', // Migrado a Vertex AI (pago por uso)
});


import { genkit } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';
import { getVertexPluginConfig } from '@/backend/ai/shared/config/vertex-auth';
import { GEMINI_FLASH_MODEL } from '@/backend/ai/shared/config/gemini-models';
import { withGeminiFamilyConfig } from '@/backend/ai/shared/config/genkit-family-config';
// import { firebase } from '@genkit-ai/firebase';

const DEFAULT_MODEL = `vertexai/${GEMINI_FLASH_MODEL}`;

export const ai = withGeminiFamilyConfig(
    genkit({
        plugins: [
            // Gemini 3.x → plugin @genkit-ai/google-genai en location `global`.
            vertexAI(getVertexPluginConfig()),
            // firebase(), // Temporarily disabled due to import error // Temporarily disabled due to import error
        ],
        model: DEFAULT_MODEL,
    }),
    DEFAULT_MODEL,
);

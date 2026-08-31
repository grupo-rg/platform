import type { GoogleAuthOptions } from 'google-auth-library';

/**
 * Configuración de autenticación para el plugin Vertex AI de Genkit.
 *
 * Vertex AI (Gemini Enterprise Agent Platform) NO usa API key: se autentica
 * con un service-account vía ADC o credenciales explícitas. En Vercel no hay
 * ADC (ni metadata server ni GOOGLE_APPLICATION_CREDENTIALS), así que
 * construimos las credenciales explícitas a partir de las mismas variables que
 * ya usa el Firebase Admin SDK (ver
 * `src/backend/shared/infrastructure/firebase/admin-app.ts`).
 *
 * En Cloud Run / local con `gcloud auth application-default login`, si no hay
 * FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY, se devuelve `undefined` y el
 * plugin cae en ADC automáticamente.
 */

export interface VertexPluginConfig {
    projectId: string;
    location: string;
    googleAuth?: GoogleAuthOptions;
}

const VERTEX_SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];

/** Región de Vertex. Por defecto Madrid (residencia UE); override vía env. */
export function getVertexLocation(): string {
    return process.env.GOOGLE_CLOUD_LOCATION || 'europe-southwest1';
}

/** Proyecto GCP donde vive Vertex. */
export function getVertexProjectId(): string {
    const projectId =
        process.env.GOOGLE_CLOUD_PROJECT ||
        process.env.GCLOUD_PROJECT ||
        process.env.FIREBASE_PROJECT_ID;
    if (!projectId) {
        throw new Error(
            'Missing GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT / FIREBASE_PROJECT_ID for Vertex AI'
        );
    }
    return projectId;
}

/**
 * Credenciales explícitas para Vertex a partir del service-account de Firebase
 * Admin (mismo des-escape de `\n` que admin-app.ts). Devuelve `undefined` para
 * dejar que el plugin use ADC cuando no hay credenciales en env (Cloud Run).
 */
export function getVertexGoogleAuth(): GoogleAuthOptions | undefined {
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (clientEmail && privateKey) {
        return {
            projectId: getVertexProjectId(),
            credentials: {
                client_email: clientEmail,
                private_key: privateKey.replace(/\\n/g, '\n'),
            },
            scopes: VERTEX_SCOPES,
        };
    }
    return undefined;
}

/** Config lista para pasar a `vertexAI(...)`. */
export function getVertexPluginConfig(): VertexPluginConfig {
    return {
        projectId: getVertexProjectId(),
        location: getVertexLocation(),
        googleAuth: getVertexGoogleAuth(),
    };
}

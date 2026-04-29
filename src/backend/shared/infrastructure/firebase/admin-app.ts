
import { getApps, initializeApp, cert, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

let firestoreSettingsApplied = false;

/**
 * Aplica `ignoreUndefinedProperties: true` al Firestore Admin SDK.
 * Sin esto, cualquier write con un campo `undefined` (ej. `address`
 * opcional en un Lead) lanza error y rompe el flujo. Esto es defense
 * in depth — los repositorios además filtran con sanitizers, pero un
 * setting global evita errores cuando se olvida.
 *
 * Debe llamarse UNA SOLA VEZ por proceso, ANTES de cualquier
 * `getFirestore().collection()`. Si se llama dos veces o tarde,
 * Firestore lanza "settings() can only be called once".
 */
function configureFirestoreSettings(): void {
    if (firestoreSettingsApplied) return;
    try {
        getFirestore().settings({ ignoreUndefinedProperties: true });
        firestoreSettingsApplied = true;
    } catch (err: any) {
        // Si ya se aplicó por otra ruta de inicio, es seguro ignorar.
        if (err?.message?.includes('already')) {
            firestoreSettingsApplied = true;
            return;
        }
        console.warn('[AdminApp] No se pudieron aplicar Firestore settings:', err?.message);
    }
}

export function initFirebaseAdminApp(): App {
    if (getApps().length === 0) {
        // Check for Service Account in Env Vars (Local Dev)
        if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
            console.log("[AdminApp] Initializing with Service Account from Env Vars");
            const app = initializeApp({
                credential: cert({
                    projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Handle newlines
                }),
                storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
            });
            configureFirestoreSettings();
            return app;
        }

        console.log("[AdminApp] Initializing with Default Credentials");
        // Production (Vercel/Cloud Run) / Fallback (if using ADC)
        const app = initializeApp({
            projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
        });
        configureFirestoreSettings();
        return app;
    }
    // Ya existe app — asegurar que las settings se aplicaron al menos una vez.
    configureFirestoreSettings();
    return getApps()[0];
}

export const adminApp = initFirebaseAdminApp();
export const adminAuth = getAuth(adminApp);
export const adminFirestore = getFirestore(adminApp);
export const adminStorage = getStorage(adminApp);

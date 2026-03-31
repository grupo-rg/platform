
import { getApps, initializeApp, cert, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

export function initFirebaseAdminApp(): App {
    if (getApps().length === 0) {
        // Check for Service Account in Env Vars (Local Dev)
        if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
            console.log("[AdminApp] Initializing with Service Account from Env Vars");
            return initializeApp({
                credential: cert({
                    projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Handle newlines
                }),
                storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
            });
        }

        console.log("[AdminApp] Initializing with Default Credentials");
        // Production (Vercel/Cloud Run) / Fallback (if using ADC)
        return initializeApp({
            projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
        });
    }
    return getApps()[0];
}

export const adminApp = initFirebaseAdminApp();
export const adminAuth = getAuth(adminApp);
export const adminFirestore = getFirestore(adminApp);
export const adminStorage = getStorage(adminApp);

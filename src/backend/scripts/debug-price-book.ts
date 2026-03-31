
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function initFirebaseAdminApp() {
    if (getApps().length === 0) {
        if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
            return initializeApp({
                credential: cert({
                    projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                }),
                storageBucket: process.env.FIREBASE_STORAGE_BUCKET
            });
        }
        return initializeApp({
            projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET
        });
    }
    return getApps()[0];
}

async function main() {
    console.log("=== DEBUGGING PRICE BOOK ITEMS ===");
    try {
        initFirebaseAdminApp();
        const db = getFirestore();
        const collectionRef = db.collection('price_book_items');

        // Check total count (estimate)
        console.log("Checking count...");
        const countSnapshot = await collectionRef.count().get();
        console.log(`Total documents in 'price_book_items': ${countSnapshot.data().count}`);

        // Check a few items
        console.log("Fetching first 5 items...");
        const snapshot = await collectionRef.limit(5).get();

        if (snapshot.empty) {
            console.log("No items found.");
        } else {
            snapshot.forEach(doc => {
                console.log(`[${doc.id}] Year: ${doc.data().year} (${typeof doc.data().year}), Code: ${doc.data().code}`);
            });
        }

        // Stress test: mimic the dashboard
        console.log("Fetching 2000 items (mimicking dashboard)...");
        const startTime = Date.now();
        const largeSnapshot = await collectionRef.where('year', '==', 2025).limit(2000).get();
        const endTime = Date.now();

        console.log(`Query took ${endTime - startTime}ms. Found ${largeSnapshot.size} items.`);

        if (!largeSnapshot.empty) {
            // Check serialization
            const items = largeSnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    ...data,
                    id: doc.id,
                    embedding: undefined,
                    createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
                    updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(),
                };
            });

            const payload = JSON.stringify(items);
            console.log(`Payload size: ${(payload.length / 1024 / 1024).toFixed(2)} MB`);
        }

    } catch (error) {
        console.error("Error:", error);
    }
}

main();

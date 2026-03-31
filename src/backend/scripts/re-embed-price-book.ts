
import 'dotenv/config';
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';
import { ai, embeddingModel } from '@/backend/ai/shared/config/genkit.config';

const BATCH_SIZE = 50;
const COLLECTION_NAME = 'price_book_items';

const main = async () => {
    console.log("🚀 Starting Price Book Re-vectorization...");
    initFirebaseAdminApp();
    const db = getFirestore();

    const snapshot = await db.collection(COLLECTION_NAME).get();
    const totalDocs = snapshot.size;
    console.log(`Found ${totalDocs} documents to process.`);

    if (totalDocs === 0) {
        console.log("No documents found. Exiting.");
        return;
    }

    const docs = snapshot.docs;
    let processedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < totalDocs; i += BATCH_SIZE) {
        const batchDocs = docs.slice(i, i + BATCH_SIZE);
        const batchTexts = batchDocs.map(doc => {
            const data = doc.data();
            // Match the embedding format used in ingestion: "Code: Description (Unit)"
            return `${data.code}: ${data.description} (${data.unit})`;
        });

        console.log(`\nProcessing batch ${i / BATCH_SIZE + 1} (${batchDocs.length} items)...`);

        try {
            // Generate Embeddings
            const embeddings = await ai.embedMany({
                embedder: embeddingModel,
                content: batchTexts,
            });

            // Prepare Bulk Writer or Batch Update
            // Firestore limit for batch is 500, we use 50 so it's fine.
            const batch = db.batch();

            batchDocs.forEach((doc, index) => {
                const vector = embeddings[index].embedding;
                batch.update(doc.ref, { embedding: vector });
            });

            await batch.commit();
            processedCount += batchDocs.length;
            console.log(`✅ Processed ${processedCount}/${totalDocs}`);

        } catch (error) {
            console.error(`❌ Error processing batch starting at index ${i}:`, error);
            errorCount += batchDocs.length;
        }
    }

    console.log("\n--------------------------------------------------");
    console.log(`🎉 Finished! Processed: ${processedCount}, Errors: ${errorCount}`);
    console.log("--------------------------------------------------");
};

main().catch(console.error);

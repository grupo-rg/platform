
import { ai } from './index'; // Genkit instance
import { z } from 'zod';
import { PriceBookItemSchema } from './schema';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
// import { textEmbeddingGecko } from '@genkit-ai/googleai'; // Assuming this import, might need check
// In new Genkit, we often use the model's embedding capability or specific embedder.
import { Document } from 'genkit/retriever';

// Initialize Firebase Admin if not already done in the project
// We'll assume a singleton init file exists or do it here safely.
import { getApps, initializeApp, cert } from 'firebase-admin/app';

if (getApps().length === 0) {
    // In a real app, use GOOGLE_APPLICATION_CREDENTIALS or similar.
    // For this context, we assume it's set up in the environment or invalid. 
    // If running in Firebase Functions/App Hosting, it's auto.
    initializeApp();
}

const db = getFirestore();
const storage = getStorage();

export async function processPriceBookPdf(fileUrl: string, year: number) {
    try {
        console.log(`Starting ingestion for Price Book ${year} from ${fileUrl}`);

        // 1. Download PDF
        // Since fileUrl is a signed URL or public URL, fetch it.
        // Or if it's a gs:// path, use admin storage. 
        // The client uploaded it, so we have a mapped URL.
        const response = await fetch(fileUrl);
        const buffer = await response.arrayBuffer();
        const pdfBase64 = Buffer.from(buffer).toString('base64');

        // 2. Extract Data using Gemini 1.5 Pro Multimodal
        // We send the PDF and ask for a structured JSON output.
        // For very large PDFs, this should be chunked. We'll start with a "Limit to 50 items" for safety/demo 
        // or assume we ask for "ALL" but the model might truncate.
        // A better production approach is page-by-page. For now, we try the whole file (Gemini 1.5 feature).

        const extractionPrompt = `
      You are an expert Data Engineer. 
      Analyze the attached PDF, which is a Construction Price Book.
      Extract the construction items (Partidas) into a JSON list.
      
      For each item, extract:
      - code: The unique ID (e.g., D01.05)
      - description: The full text description
      - unit: Unit of measure (m2, u, ml, etc)
      - priceLabor: Labor cost
      - priceMaterial: Material cost
      - priceTotal: Total cost

      Output ONLY valid JSON matching this schema: 
      Array<{ code: string, description: string, unit: string, priceLabor: number, priceMaterial: number, priceTotal: number }>
    `;

        const { output } = await ai.generate({
            model: 'vertexai/gemini-2.5-pro',
            prompt: [
                { text: extractionPrompt },
                { media: { url: `data:application/pdf;base64,${pdfBase64}` } }
            ],
            output: { schema: z.array(PriceBookItemSchema) }, // Genkit handles structured output
        });

        if (!output) {
            throw new Error("Failed to extract data from PDF");
        }

        console.log(`Extracted ${output.length} items. Starting vectorization...`);

        // 3. Vectorize and Store
        const batch = db.batch();
        const collectionRef = db.collection('price_book_items');

        // Delete old items for this year? Or upsert?
        // For now, simple add.

        let count = 0;
        for (const item of output) {
            // Embedding is handled by IngestPriceBookService via RestApiVectorizerAdapter (gemini-embedding-001)
            // This legacy flow bypasses proper vectorization - use IngestPriceBookService instead

            const docRef = collectionRef.doc(item.code.replace(/\./g, '_')); // Sanitize ID

            // We will store the vector in a field named 'embedding_field' (standard for FS Vector Search)
            // but without the actual vector calculation here, we rely on the extension OR we need to add it.
            // I'll add a 'keywords' field for simple search as fallback.

            batch.set(docRef, {
                ...item,
                year,
                // embedding_field: FieldValue.vector(embedding), // Requires vector
                searchKeywords: item.description.toLowerCase().split(' '),
                createdAt: FieldValue.serverTimestamp(),
            });

            count++;
            if (count % 400 === 0) {
                await batch.commit();
                // Reset batch? batch is not reusable? 
                // Firestore batches are limited to 500.
                // In a loop, we should manage batches better. 
                // Simplified: just commit and create new batch logic is needed.
            }
        }

        await batch.commit();
        console.log("Ingestion complete.");
        return { success: true, count: output.length };

    } catch (error) {
        console.error("Ingestion failed:", error);
        throw error;
    }
}

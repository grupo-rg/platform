
import { PriceBookItem } from '../domain/price-book-item';
import { PriceBookRepository } from '../domain/price-book-repository';
import { getSafeDb } from '@/lib/firebase/client';
import { collection, doc, writeBatch, getDocs, query, where, Timestamp } from 'firebase/firestore';

/**
 * Concrete implementation of PriceBookRepository using Firestore.
 * Note: Check if we are running Server-side or Client-side. 
 * Since this is "Backend" code intended for actions/services, we should ideally use 'firebase-admin' if server-only,
 * or the client SDK if this code runs in the browser or next.js client components. 
 * 
 * Given "Actions" run on server, we should use 'firebase-admin'.
 * However, the existing project seems to mix both or use client SDK in some parts.
 * Let's assume Server Actions environment and try to use Admin SDK if initialized, or Client SDK if appropriate.
 * 
 * REVISION: The User insisted on "Backend" folder. Usually implies Admin SDK.
 * I will use 'firebase-admin' here assuming it's properly initialized in 'src/lib/firebase/admin' (which we need to create/verify).
 * IF no admin file, I'll fallback to a unified solution or create the admin one.
 */

// Let's create a shared admin init file first to be clean. For now, I will write the implementation assuming Admin SDK.
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app'; // We need this

export class FirestorePriceBookRepository implements PriceBookRepository {
    private db;
    private collectionName: string;

    constructor(collectionName: string = 'price_book_2025') {
        initFirebaseAdminApp();
        this.db = getFirestore();
        this.collectionName = collectionName;
    }
    async saveBatch(items: PriceBookItem[]): Promise<void> {
        // Reduced from 400 to 50 because Embeddings increase payload size significantly
        // Firestore has a 10MB limit per request. 50 items * ~8KB (embedding+text) << 10MB
        const batchSize = 50;
        const chunks = [];

        for (let i = 0; i < items.length; i += batchSize) {
            chunks.push(items.slice(i, i + batchSize));
        }

        for (const chunk of chunks) {
            const batch = this.db.batch();
            chunk.forEach(item => {
                // Create a deterministic ID or auto-id
                const docId = `${item.year}_${item.code.replace(/\./g, '_')}`;
                const docRef = this.db.collection(this.collectionName).doc(docId);

                // IMPORTANT: Must convert raw array to VectorValue for Vector Search to index it!
                const { embedding, ...itemData } = item;
                const dbPayload: any = {
                    ...itemData,
                    createdAt: item.createdAt || new Date()
                };

                // Sanitize undefined breakdown
                if (dbPayload.breakdown === undefined) {
                    delete dbPayload.breakdown;
                } else if (Array.isArray(dbPayload.breakdown)) {
                    // Sanitize undefineds inside breakdown objects
                    dbPayload.breakdown = dbPayload.breakdown.map((b: any) => {
                        const cleanB = { ...b };
                        Object.keys(cleanB).forEach(key => {
                            if (cleanB[key] === undefined) delete cleanB[key];
                        });
                        return cleanB;
                    });
                }

                if (embedding) {
                    dbPayload.embedding = FieldValue.vector(embedding);
                }

                // Convert Dates to Firestore Types if needed, Admin SDK handles JS Date usually.
                batch.set(docRef, dbPayload);
            });
            await batch.commit();
        }
    }

    async findByYear(year: number): Promise<PriceBookItem[]> {
        const q = this.db.collection(this.collectionName).where('year', '==', year);
        const snapshot = await q.get();
        return snapshot.docs.map(doc => {
            const data = doc.data();
            const { embedding, createdAt, ...rest } = data;

            // Serialize Date/Timestamp
            let createdDate: Date | undefined;
            if (createdAt && typeof createdAt.toDate === 'function') {
                createdDate = createdAt.toDate();
            } else if (createdAt instanceof Date) {
                createdDate = createdAt;
            } else if (typeof createdAt === 'string') {
                createdDate = new Date(createdAt);
            }

            return {
                id: doc.id,
                createdAt: createdDate,
                ...rest
            } as PriceBookItem;
        });
    }

    async search(queryText: string, limit: number = 10): Promise<PriceBookItem[]> {
        // Basic keyword search (legacy/fallback)
        // If we want real search, we should use searchByVector
        return [];
    }

    async searchByVector(embedding: number[], limit: number = 10, year?: number, keywordFilter?: string): Promise<(PriceBookItem & { matchScore: number })[]> {
        const collectionRef = this.db.collection(this.collectionName);

        const vectorValue = FieldValue.vector(embedding);

        // Hybrid Strategy: Fetch more candidates via Vector Search (Loose Net), then Re-rank via Keyword
        const candidateLimit = keywordFilter ? limit * 3 : limit;

        let vectorQuery = collectionRef.findNearest('embedding', vectorValue, {
            limit: candidateLimit,
            distanceMeasure: 'COSINE',
        });

        // if (year) { ... } // Complicated in Firestore with Vector currently without composite index. Ignoring for now.

        const snapshot = await vectorQuery.get();

        let candidates = snapshot.docs.map(doc => {
            const data = doc.data();
            const storedEmbeddingVector = data.embedding;
            let matchScore = 0;

            if (storedEmbeddingVector) {
                const vec = Array.isArray(storedEmbeddingVector) ? storedEmbeddingVector : (storedEmbeddingVector.toArray ? storedEmbeddingVector.toArray() : null);
                if (vec) {
                    matchScore = this.cosineSimilarity(embedding, vec);
                }
            }

            const { embedding: _, createdAt, ...rest } = data;

            let createdDate: Date | undefined;
            if (createdAt && typeof createdAt.toDate === 'function') {
                createdDate = createdAt.toDate();
            } else if (createdAt instanceof Date) {
                createdDate = createdAt;
            } else if (typeof createdAt === 'string') {
                createdDate = new Date(createdAt);
            }

            return {
                id: doc.id,
                createdAt: createdDate,
                matchScore: matchScore,
                ...rest
            } as PriceBookItem & { matchScore: number };
        });

        // Hybrid Re-ranking
        if (keywordFilter && keywordFilter.trim().length > 0) {
            const keywords = keywordFilter.toLowerCase().split(/\s+/).filter(k => k.length > 2); // Ignore small words

            candidates = candidates.map(candidate => {
                const text = (candidate.description || "").toLowerCase();
                let keywordScore = 0;
                let matches = 0;

                keywords.forEach(kw => {
                    if (text.includes(kw)) {
                        matches++;
                        // Bonus for exact word match vs substring? 
                        // Simple inclusion is fine for now.
                    }
                });

                if (keywords.length > 0) {
                    keywordScore = matches / keywords.length; // 0 to 1
                }

                // Weighted Score: Vector (Semantic) + Keyword (Exactness)
                // We want to boost items that match keywords but still respect vector similarity
                // New Score = Vector * (1 + 0.5 * KeywordScore)
                return {
                    ...candidate,
                    matchScore: candidate.matchScore * (1 + 0.5 * keywordScore)
                };
            });
        }

        // Final Sort and Limit
        return candidates
            .sort((a, b) => b.matchScore - a.matchScore)
            .slice(0, limit);
    }

    async searchByVectorWithFilters(
        embedding: number[],
        filters: import('../domain/price-book-repository').SearchFilters,
        limit: number = 10
    ): Promise<(PriceBookItem & { matchScore: number })[]> {
        const collectionRef = this.db.collection(this.collectionName);

        let queryRef: any = collectionRef;

        if (filters.chapter) queryRef = queryRef.where('chapter', '==', filters.chapter);
        if (filters.section) queryRef = queryRef.where('section', '==', filters.section);
        if (filters.year) queryRef = queryRef.where('year', '==', filters.year);
        if (filters.maxPrice) queryRef = queryRef.where('priceTotal', '<=', filters.maxPrice);

        const vectorValue = FieldValue.vector(embedding);

        const vectorQuery = queryRef.findNearest('embedding', vectorValue, {
            limit: limit,
            distanceMeasure: 'COSINE'
        });

        console.log(`[Firestore] Executing Hybrid Search... Filters:`, filters);

        const snapshot = await vectorQuery.get();
        return snapshot.docs.map((doc: any) => {
            const data = doc.data();

            const storedEmbeddingVector = data.embedding;
            let matchScore = 0;
            if (storedEmbeddingVector) {
                const vec = Array.isArray(storedEmbeddingVector) ? storedEmbeddingVector : (storedEmbeddingVector.toArray ? storedEmbeddingVector.toArray() : null);
                if (vec) {
                    matchScore = this.cosineSimilarity(embedding, vec);
                }
            }

            const { embedding: _, createdAt, ...rest } = data;
            return {
                id: doc.id,
                matchScore,
                ...rest
            } as PriceBookItem & { matchScore: number };
        }).sort((a: PriceBookItem & { matchScore: number }, b: PriceBookItem & { matchScore: number }) => b.matchScore - a.matchScore);
    }

    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        if (vecA.length !== vecB.length) return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}

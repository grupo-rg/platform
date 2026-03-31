'use server';

import { ai, embeddingModel } from '@/backend/ai/shared/config/genkit.config';
import { FirestorePriceBookRepository } from '@/backend/price-book/infrastructure/firestore-price-book-repository';
import { FirestorePendingPriceItemRepository } from '@/backend/budget/infrastructure/firestore-pending-item.repository';
import { PendingPriceItem } from '@/backend/budget/domain/pending-price-item';
import { revalidatePath } from 'next/cache';

const priceBookRepo = new FirestorePriceBookRepository();
const pendingRepo = new FirestorePendingPriceItemRepository();

export interface ApproveItemInput {
    id: string; // Pending ID
    finalCode: string;
    finalDescription: string;
    finalPrice: number;
    finalUnit: string;
}

export async function approvePendingItemAction(input: ApproveItemInput) {
    try {
        console.log(`[Action] Approving item ${input.id}...`);

        // 1. Generate Embedding for the new description
        // Use Genkit embed
        const embeddingResult = await ai.embed({
            embedder: embeddingModel,
            content: input.finalDescription,
        });

        const embedding = Array.isArray(embeddingResult)
            ? embeddingResult[0].embedding
            : (embeddingResult as any).embedding;

        // 2. Create Price Book Item
        await priceBookRepo.saveBatch([{
            id: input.finalCode, // Or generate new ID? Use Code as ID for uniqueness? Or auto-id
            code: input.finalCode,
            description: input.finalDescription,
            unit: input.finalUnit,
            priceTotal: input.finalPrice,
            priceLabor: 0, // Default breakdown
            priceMaterial: input.finalPrice,
            year: 2025,
            embedding: embedding,
            searchKeywords: input.finalDescription.toLowerCase().split(' '),
            createdAt: new Date()
        }]);

        // 3. Mark Pending as Approved
        await pendingRepo.updateStatus(input.id, 'approved');

        revalidatePath('/dashboard/admin/pending-items');
        return { success: true };
    } catch (error) {
        console.error("Error approving item:", error);
        return { success: false, error: 'Failed' };
    }
}

export async function rejectPendingItemAction(id: string) {
    await pendingRepo.updateStatus(id, 'rejected');
    revalidatePath('/dashboard/admin/pending-items');
}

export async function getPendingItemsAction() {
    return await pendingRepo.findAllPending();
}

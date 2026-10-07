'use server';

import { checkAdmin, unauthorizedResult } from '@/actions/_guards';

import { FirestorePriceBookRepository } from '@/backend/price-book/infrastructure/firestore-price-book-repository';
import { SearchPriceBookService } from '@/backend/price-book/application/search-price-book-service';

export async function searchPriceBookAction(query: string, limit: number = 10, year?: number) {
    if (!(await checkAdmin())) return unauthorizedResult();
    try {
        const repository = new FirestorePriceBookRepository();
        const service = new SearchPriceBookService(repository);

        const items = await service.execute(query, limit, year);

        return { success: true, items };
    } catch (error: any) {
        console.error("Search Error:", error);
        return { success: false, error: error.message };
    }
}

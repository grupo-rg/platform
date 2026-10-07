'use server';

import { requireAdmin } from '@/actions/_guards';

import { SearchMaterialService } from '../application/search-material-service';
import { FirestoreMaterialCatalogRepository } from '../infrastructure/firestore-material-catalog-repository';
import { MaterialItem } from '../domain/material-item';

const repository = new FirestoreMaterialCatalogRepository();
const service = new SearchMaterialService(repository);

export async function searchMaterialsAction(query: string): Promise<MaterialItem[]> {
    await requireAdmin();
    if (!query || query.trim().length < 2) return [];

    try {
        const results = await service.search(query, 20);
        // Serialize Dates if necessary (Next.js Server Actions requirement)
        return results.map(item => ({
            ...item,
            createdAt: item.createdAt ? new Date(item.createdAt) : undefined,
            updatedAt: item.updatedAt ? new Date(item.updatedAt) : undefined
        }));
    } catch (error) {
        console.error("Error in searchMaterialsAction:", error);
        return [];
    }
}

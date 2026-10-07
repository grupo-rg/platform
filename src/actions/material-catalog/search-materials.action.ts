'use server';

import { requireAdmin } from '@/actions/_guards';

import { SearchMaterialService } from '@/backend/material-catalog/application/search-material-service';
import { FirestoreMaterialCatalogRepository } from '@/backend/material-catalog/infrastructure/firestore-material-catalog-repository';
import { MaterialItem } from '@/backend/material-catalog/domain/material-item';

const repository = new FirestoreMaterialCatalogRepository();
const service = new SearchMaterialService(repository);

export async function searchMaterialsAction(query: string): Promise<MaterialItem[]> {
    await requireAdmin();
    try {
        if (!query || query.length < 2) return [];

        const items = await service.search(query, 30); // Limit 30

        return items.map(item => {
            const { embedding, ...rest } = item;
            return {
                ...rest,
                // Serialize dates/timestamps to plain strings or numbers if needed, 
                // but Client Components handle Date objects if passed from Server Actions in Next 14+ usually.
                // SAFEST: Convert to Date object if it's not, or keep as is if Next serializes it.
                // However, to be 100% safe against "Only plain objects" errors for complex types:
                createdAt: item.createdAt ? new Date(item.createdAt) : undefined,
                updatedAt: item.updatedAt ? new Date(item.updatedAt) : undefined,
            } as MaterialItem;
        });
    } catch (error) {
        console.error("Search Material Error:", error);
        return [];
    }
}

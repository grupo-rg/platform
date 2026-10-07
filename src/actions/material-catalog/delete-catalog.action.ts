'use server';

import { checkAdmin, unauthorizedResult } from '@/actions/_guards';

import { DeleteMaterialService } from '@/backend/material-catalog/application/delete-material-service';
import { FirestoreMaterialCatalogRepository } from '@/backend/material-catalog/infrastructure/firestore-material-catalog-repository';
import { revalidatePath } from 'next/cache';

const repository = new FirestoreMaterialCatalogRepository();
const service = new DeleteMaterialService(repository);

export async function deleteCatalogByYearAction(year: number): Promise<{ success: boolean, count?: number, error?: string }> {
    if (!(await checkAdmin())) return unauthorizedResult();
    try {
        if (!year || year < 2000) {
            throw new Error("Año no válido para la eliminación.");
        }

        const { deletedCount } = await service.deleteCatalogByYear(year);

        // Revalidate price/catalog related paths
        revalidatePath('/dashboard/admin/prices');

        return { success: true, count: deletedCount };
    } catch (error: any) {
        console.error("Delete Catalog Action Error:", error);
        return { success: false, error: error.message };
    }
}

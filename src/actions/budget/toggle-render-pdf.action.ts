'use server';

import { BudgetRepositoryFirestore } from '@/backend/budget/infrastructure/budget-repository-firestore';
import { revalidatePath } from 'next/cache';

const budgetRepository = new BudgetRepositoryFirestore();

interface ToggleRenderPdfParams {
    budgetId: string;
    renderId: string;
    includeInPdf: boolean;
}

export async function toggleRenderPdfAction({ budgetId, renderId, includeInPdf }: ToggleRenderPdfParams) {
    try {
        const budget = await budgetRepository.findById(budgetId);
        if (!budget) {
            return { success: false, error: "Budget not found" };
        }

        let renders = budget.renders || [];
        
        renders = renders.map(r => {
            if (r.id === renderId) {
                return { ...r, includeInPdf };
            }
            return r;
        });
        
        const updatedBudget = {
            ...budget,
            renders
        };

        await budgetRepository.save(updatedBudget);
        
        revalidatePath(`/dashboard/admin/budgets/${budgetId}/edit`);
        
        return { success: true };
    } catch (e) {
        console.error("Error updating render PDF status", e);
        return { success: false, error: "Internal Error" };
    }
}

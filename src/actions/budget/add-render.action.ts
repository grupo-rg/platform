'use server';

import { checkAdmin, unauthorizedResult } from '@/actions/_guards';

import { BudgetRepositoryFirestore } from '@/backend/budget/infrastructure/budget-repository-firestore';
import { BudgetRender } from '@/backend/budget/domain/budget';
import { revalidatePath } from 'next/cache';

const budgetRepository = new BudgetRepositoryFirestore();

interface AddRenderParams {
    budgetId: string;
    render: Omit<BudgetRender, 'createdAt'>; // createdAt generated server-side
}

export async function addRenderAction({ budgetId, render }: AddRenderParams) {
    if (!(await checkAdmin())) return unauthorizedResult();
    try {
        const budget = await budgetRepository.findById(budgetId);
        if (!budget) {
            return { success: false, error: "Budget not found" };
        }

        const newRender: BudgetRender = {
            ...render,
            createdAt: new Date()
        };

        const updatedRenders = [...(budget.renders || []), newRender];

        // We update the full budget entity
        // Ideally we would have a partial update method, but repository.save replaces the document usually.
        // Let's assume save() handles merge or full overwrite. With Firestore "set({ merge: true })" is common or just set().
        // We will modify the budget object and save it.
        const updatedBudget = {
            ...budget,
            renders: updatedRenders
        };

        await budgetRepository.save(updatedBudget);

        revalidatePath(`/dashboard/admin/budgets/${budgetId}/edit`);

        return { success: true, data: newRender };

    } catch (error) {
        console.error("Error adding render to budget:", error);
        return { success: false, error: "Failed to save render" };
    }
}

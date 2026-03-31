'use server';

import { BudgetRepositoryFirestore } from '@/backend/budget/infrastructure/budget-repository-firestore';
import { Budget } from '@/backend/budget/domain/budget';

const budgetRepository = new BudgetRepositoryFirestore();

export async function getBudgetAction(id: string): Promise<Budget | null> {
    try {
        const budget = await budgetRepository.findById(id);
        if (!budget) {
            console.warn(`Budget not found: ${id}`);
            return null;
        }
        // Serialize deeply to remove Firestore Timestamps classes that crash Next.js Client Boundaries
        return JSON.parse(JSON.stringify(budget));
    } catch (error) {
        console.error(`Error fetching budget ${id}:`, error);
        return null;
    }
}

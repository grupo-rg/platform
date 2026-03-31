'use server';

import { BudgetRepositoryFirestore } from '@/backend/budget/infrastructure/budget-repository-firestore';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { revalidatePath } from 'next/cache';

export async function assignBudgetClientAction(budgetId: string, leadId: string) {
    try {
        const budgetRepo = new BudgetRepositoryFirestore();
        const leadRepo = new FirestoreLeadRepository();

        const budget = await budgetRepo.findById(budgetId);
        if (!budget) {
            return { success: false, error: "Budget not found" };
        }

        const lead = await leadRepo.findById(leadId);
        if (!lead) {
            return { success: false, error: "Lead not found" };
        }

        // Update the budget entity directly to point to the new lead
        budget.leadId = lead.id;
        budget.clientSnapshot = lead.personalInfo;
        budget.updatedAt = new Date();

        await budgetRepo.save(budget);

        revalidatePath(`/dashboard/admin/budgets/${budgetId}/edit`);

        return {
            success: true,
            clientSnapshot: budget.clientSnapshot
        };
    } catch (error: any) {
        console.error("Error assigning client to budget:", error);
        return { success: false, error: error.message };
    }
}

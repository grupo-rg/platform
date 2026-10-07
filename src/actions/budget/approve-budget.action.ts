'use server';

import { checkAdmin, unauthorizedResult } from '@/actions/_guards';

import { BudgetRepositoryFirestore } from '@/backend/budget/infrastructure/budget-repository-firestore';
import { FirestoreProjectRepository } from '@/backend/project/infrastructure/firestore-project-repository';
import { ProjectService } from '@/backend/project/application/project-service';
import { revalidatePath } from 'next/cache';

const budgetRepository = new BudgetRepositoryFirestore();
const projectRepository = new FirestoreProjectRepository();
const projectService = new ProjectService(projectRepository);

interface ApproveResult {
    success: boolean;
    projectId?: string;
    error?: string;
}

/**
 * Approves a budget and creates a Project (Obra) from it.
 * Steps:
 *   1. Updates budget status → 'approved'
 *   2. Calls ProjectService.createFromBudget() to generate Obra + phases
 */
export async function approveBudgetAction(
    budgetId: string,
    overrides?: {
        name?: string;
        description?: string;
        address?: string;
        startDate?: string;  // ISO string
        estimatedEndDate?: string;  // ISO string
    }
): Promise<ApproveResult> {
    if (!(await checkAdmin())) return unauthorizedResult();
    try {
        const budget = await budgetRepository.findById(budgetId);
        if (!budget) {
            return { success: false, error: 'Presupuesto no encontrado' };
        }

        if (budget.status === 'approved') {
            // Already approved — check if project exists
            const existing = await projectRepository.findByBudgetId(budgetId);
            if (existing) {
                return { success: true, projectId: existing.id };
            }
        }

        // Step 1: Update budget status to approved
        budget.status = 'approved';
        budget.updatedAt = new Date();
        await budgetRepository.save(budget);

        // Step 2: Create project from budget
        const project = await projectService.createFromBudget(budget, {
            name: overrides?.name,
            description: overrides?.description,
            address: overrides?.address,
            startDate: overrides?.startDate ? new Date(overrides.startDate) : undefined,
            estimatedEndDate: overrides?.estimatedEndDate ? new Date(overrides.estimatedEndDate) : undefined,
        });

        // Revalidate affected pages
        revalidatePath('/dashboard/admin/budgets');
        revalidatePath('/dashboard/projects');
        revalidatePath('/dashboard');

        return { success: true, projectId: project.id };
    } catch (error: any) {
        console.error('Error approving budget:', error);
        return { success: false, error: error.message || 'Error al aprobar el presupuesto' };
    }
}

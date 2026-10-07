'use server';

import { checkAdmin, unauthorizedResult } from '@/actions/_guards';

import { FirestoreExpenseRepository } from '@/backend/expense/infrastructure/firestore-expense-repository';
import { FirestoreProviderRepository } from '@/backend/expense/infrastructure/firestore-provider-repository';
import { FirestoreProjectRepository } from '@/backend/project/infrastructure/firestore-project-repository';
import { ExpenseService } from '@/backend/expense/application/expense-service';
import { revalidatePath } from 'next/cache';

const expenseRepository = new FirestoreExpenseRepository();
const providerRepository = new FirestoreProviderRepository();
const projectRepository = new FirestoreProjectRepository();
const expenseService = new ExpenseService(expenseRepository, providerRepository, projectRepository);

export async function validateExpenseAction(expenseId: string) {
    if (!(await checkAdmin())) return unauthorizedResult();
    try {
        const expense = await expenseService.validateExpense(expenseId);
        revalidatePath('/dashboard/expenses');
        revalidatePath('/dashboard/projects');
        return { success: true, expense };
    } catch (error: any) {
        console.error('Error validating expense:', error);
        return { success: false, error: error.message || 'Error al validar el gasto' };
    }
}

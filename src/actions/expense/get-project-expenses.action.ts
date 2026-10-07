'use server';

import { requireAdmin, requireUser } from '@/actions/_guards';

import { FirestoreExpenseRepository } from '@/backend/expense/infrastructure/firestore-expense-repository';
import { Expense } from '@/backend/expense/domain/expense';

const expenseRepository = new FirestoreExpenseRepository();

// Lectura de obra: basta con sesión válida (rol `encargado` de A). El filtrado
// por obras asignadas queda pendiente (TODO Fase 1).
export async function getProjectExpensesAction(projectId: string): Promise<Expense[]> {
    await requireUser();
    try {
        return await expenseRepository.findByProjectId(projectId);
    } catch (error) {
        console.error('Error fetching project expenses:', error);
        return [];
    }
}

export async function getAllExpensesAction(): Promise<Expense[]> {
    await requireAdmin();
    try {
        return await expenseRepository.findAll();
    } catch (error) {
        console.error('Error fetching expenses:', error);
        return [];
    }
}

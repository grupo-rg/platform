'use server';

import { FirestoreExpenseRepository } from '@/backend/expense/infrastructure/firestore-expense-repository';
import { FirestoreProviderRepository } from '@/backend/expense/infrastructure/firestore-provider-repository';
import { FirestoreProjectRepository } from '@/backend/project/infrastructure/firestore-project-repository';
import { ExpenseService } from '@/backend/expense/application/expense-service';
import { extractInvoiceFlow } from '@/backend/ai/private-core/flows/extract-invoice.flow';
import { revalidatePath } from 'next/cache';

const expenseRepository = new FirestoreExpenseRepository();
const providerRepository = new FirestoreProviderRepository();
const projectRepository = new FirestoreProjectRepository();
const expenseService = new ExpenseService(expenseRepository, providerRepository, projectRepository);

/**
 * Server action that receives a PDF/image file, runs AI extraction,
 * and creates an expense in 'pendiente' status for human review.
 */
export async function uploadInvoiceAction(data: {
    projectId: string;
    fileBase64: string;
    mimeType: string;
    budgetChapters?: string[];
}) {
    try {
        // 1. Run AI extraction
        const extracted = await extractInvoiceFlow({
            file: {
                base64: data.fileBase64,
                mimeType: data.mimeType,
            },
            budgetChapters: data.budgetChapters,
        });

        // 2. Create expense from extraction (status: pendiente)
        const expense = await expenseService.createFromAIExtraction(
            data.projectId,
            extracted,
        );

        revalidatePath('/dashboard/expenses');

        return {
            success: true,
            expenseId: expense.id,
            extracted, // Return extracted data for frontend preview
        };
    } catch (error: any) {
        console.error('Error uploading invoice:', error);
        return { success: false, error: error.message || 'Error al procesar la factura' };
    }
}

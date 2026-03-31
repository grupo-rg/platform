'use server';

import { BudgetService } from '@/backend/budget/application/budget-service';
import { BudgetRepositoryFirestore } from '@/backend/budget/infrastructure/budget-repository-firestore';
import { PricingOutput } from '@/backend/ai/private-core/flows/measurements/measurement-pricing.flow';
import { BudgetLineItem, BudgetCostBreakdown } from '@/backend/budget/domain/budget';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';

const budgetRepository = new BudgetRepositoryFirestore();
const budgetService = new BudgetService(budgetRepository);

export async function createBudgetFromMeasurementsAction(
    pricingOutput: PricingOutput,
    fileName: string,
    pageCount?: number
) {
    try {
        // The lineItems and costBreakdown variables are no longer needed as separate entities
        // The new budget structure will be built directly in the createNewBudget call.

        // Create Budget
        const newBudget = await budgetService.createNewBudget({
            type: 'renovation', // Default to renovation for PDF uploads usually
            status: 'draft',    // Start as draft so admin can review
            version: 1,
            updatedAt: new Date(),
            // leadId: 'admin', // Handled by budgetService or we generate one? Budget requires leadId.
            leadId: randomUUID(), // Temporary until we have real Lead integration


            clientSnapshot: {
                name: pricingOutput.clientName || 'Cliente (Desde PDF)',
                email: '', // Unknown
                phone: '',
                address: '',
            },

            specs: {
                propertyType: 'flat', // Default to flat/apartment
                interventionType: 'partial',
                totalArea: 0,
                qualityLevel: 'medium'
            },

            chapters: [{
                id: randomUUID(),
                name: "Presupuesto Importado",
                order: 0,
                items: pricingOutput.items.map((item, index) => ({
                    type: 'PARTIDA',
                    id: (item as any).id || randomUUID(),
                    order: index,
                    code: item.code || '',
                    description: item.description,
                    unit: item.unit,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    totalPrice: item.totalPrice,
                    originalTask: '',
                    note: '',
                    isEstimate: item.isEstimate
                })),
                totalPrice: pricingOutput.summary.total
            }],
            costBreakdown: {
                materialExecutionPrice: pricingOutput.summary.subtotal,
                overheadExpenses: pricingOutput.summary.overheadExpenses,
                industrialBenefit: pricingOutput.summary.industrialBenefit,
                tax: pricingOutput.summary.iva,
                globalAdjustment: 0,
                total: pricingOutput.summary.total,
            },
            totalEstimated: pricingOutput.summary.total,

            // Metadata
            source: 'pdf_measurement',
            pricingMetadata: {
                uploadedFileName: fileName,
                ...(pageCount !== undefined && { pageCount }),
                extractionConfidence: (pricingOutput.summary.matchedItems / pricingOutput.summary.totalItems) * 100
            }
        });

        revalidatePath('/dashboard/admin/budgets');
        return { success: true, budgetId: newBudget.id };

    } catch (error) {
        console.error("Error creating budget from measurements:", error);
        return { success: false, error: "Failed to persist budget" };
    }
}

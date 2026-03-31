'use server';

import { BudgetNarrativeBuilder } from '@/backend/budget/domain/budget-narrative-builder';
// Deprecated import removed
import { runWithContext } from '@/backend/ai/shared/context/genkit.context';
import { BudgetRepositoryFirestore } from '@/backend/budget/infrastructure/budget-repository-firestore';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { Budget } from '@/backend/budget/domain/budget';
import { FormToSpecsMapper } from '@/backend/budget/application/mappers/form-to-specs.mapper';
import { DetailedFormValues } from '@/components/budget-request/schema'; // Still needed as input type
import { v4 as uuidv4 } from 'uuid';

const budgetRepository = new BudgetRepositoryFirestore();
const leadRepository = new FirestoreLeadRepository();

export async function generateBudgetAction(leadId: string, formValues: DetailedFormValues) {
    try {
        console.log(">> Generating Budget from Requirements...");

        // 0. Validate/Fetch Lead to ensure it exists and get snapshot
        const lead = await leadRepository.findById(leadId);
        if (!lead) throw new Error("Lead not found. Please verify your identity first.");

        // 1. Map Frontend Form -> Domain Specs
        const specs = FormToSpecsMapper.map(formValues);

        // 2. Build Narrative from Domain Specs
        const narrative = BudgetNarrativeBuilder.build(specs);
        console.log(">> Narrative built:", narrative);

        // 3. Call AI Flow (The "Estimator")
        const budgetResult: any = { chapters: [], costBreakdown: null, totalEstimated: 0 };

        // 4. Persist Budget
        const budgetId = uuidv4();

        const newBudget: Budget = {
            id: budgetId,
            leadId: lead.id,
            clientSnapshot: lead.personalInfo, // Immutable copy
            specs: specs,

            status: 'draft',
            createdAt: new Date(),
            updatedAt: new Date(),
            version: 1,
            type: specs.interventionType === 'new_build' ? 'new_build' : 'renovation',

            chapters: budgetResult.chapters?.map((c: any) => ({
                ...c,
                id: c.id || uuidv4(),
                items: c.items.map((i: any) => ({ ...i, id: uuidv4(), type: 'PARTIDA' })) // Ensure IDs and type
            })) || [],
            costBreakdown: budgetResult.costBreakdown || {
                materialExecutionPrice: 0,
                overheadExpenses: 0,
                industrialBenefit: 0,
                tax: 0,
                globalAdjustment: 0,
                total: budgetResult.totalEstimated
            },
            totalEstimated: budgetResult.totalEstimated,
            source: 'wizard'
        };

        await budgetRepository.save(newBudget);
        console.log(`[Action] Budget persisted with ID: ${budgetId}`);

        return {
            success: true,
            budgetId,
            budgetResult: { ...budgetResult, id: budgetId }
        };

    } catch (error: any) {
        console.error("Error generating budget:", error);
        return { success: false, error: error.message };
    }
}


'use server';

// Deprecated import removed
import { runWithContext } from '@/backend/ai/shared/context/genkit.context';
import { BudgetRepositoryFirestore } from '@/backend/budget/infrastructure/budget-repository-firestore';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { Budget } from '@/backend/budget/domain/budget';
import { BudgetRequirement } from '@/backend/budget/domain/budget-requirements';
import { v4 as uuidv4 } from 'uuid';
import { ProjectSpecs } from '@/backend/budget/domain/project-specs';

const budgetRepository = new BudgetRepositoryFirestore();
const leadRepository = new FirestoreLeadRepository();

export async function generateDemoBudgetAction(leadId: string, requirements: Partial<BudgetRequirement>) {
    try {
        console.log(`[Demo] Generating Budget for Lead: ${leadId}`);

        // 1. Fetch Lead & Enforce Limit
        const lead = await leadRepository.findById(leadId);
        if (!lead) throw new Error("Lead not found.");

        if (lead.demoBudgetsGenerated >= 1) {
            return {
                success: false,
                error: "Has alcanzado el límite de 1 presupuesto gratuito para la demostración."
            };
        }

        // 2. Build Narrative from Requirements
        const lines: string[] = ["=== PRESUPUESTO DEMO TIER ==="];

        if (requirements.specs) {
            const s = requirements.specs;
            if (s.propertyType) lines.push(`Tipo de Propiedad: ${s.propertyType}`);
            if (s.interventionType) lines.push(`Alcance: ${s.interventionType}`);
            if (s.totalArea) lines.push(`Área a reformar: ${s.totalArea} m2`);
            if (s.qualityLevel) lines.push(`Calidad General: ${s.qualityLevel}`);
            if (s.description) lines.push(`Descripción del usuario: ${s.description}`);
        }

        if (requirements.detectedNeeds && requirements.detectedNeeds.length > 0) {
            lines.push(`\n=== NECESIDADES DETECTADAS ===`);
            requirements.detectedNeeds.forEach(need => {
                lines.push(`- [${need.category}] ${need.description} (Cant: ${need.estimatedQuantity || 'N/A'} ${need.unit || ''})`);
            });
        }

        const narrative = lines.join('\n');
        console.log("[Demo] AI Narrative built:", narrative);

        // 3. Call AI Flow
        const budgetResult: any = { chapters: [], costBreakdown: null, totalEstimated: 0 };

        // 4. Persist Budget
        const budgetId = uuidv4();

        // Assert complete specs for persistence, fallback to generic if AI didn't catch it
        const finalSpecs = {
            propertyType: requirements.specs?.propertyType || 'flat',
            interventionType: 'partial', // forced for demo
            totalArea: requirements.specs?.totalArea || 0,
            qualityLevel: requirements.specs?.qualityLevel || 'medium',
            description: 'Presupuesto autogenerado en demo pública.'
        } as ProjectSpecs;

        const newBudget: Budget = {
            id: budgetId,
            leadId: lead.id,
            clientSnapshot: lead.personalInfo,
            specs: finalSpecs,
            status: 'draft',
            createdAt: new Date(),
            updatedAt: new Date(),
            version: 1,
            type: 'renovation',
            chapters: budgetResult.chapters?.map((c: any) => ({
                ...c,
                id: c.id || uuidv4(),
                items: c.items.map((i: any) => ({ ...i, id: uuidv4(), type: 'PARTIDA' }))
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
        console.log(`[Demo] Budget persisted with ID: ${budgetId}`);

        // 5. Increment Lead Usage Limit
        lead.incrementDemoBudgets();
        await leadRepository.save(lead);

        return {
            success: true,
            budgetId,
            budgetResult: newBudget // Return the fully constructed budget object
        };

    } catch (error: any) {
        console.error("[Demo] Error generating budget:", error);
        return { success: false, error: error.message || "Failed to generate demo budget." };
    }
}

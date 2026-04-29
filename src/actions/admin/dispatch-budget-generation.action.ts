'use server';

import { revalidatePath } from 'next/cache';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { BudgetRepositoryFirestore } from '@/backend/budget/infrastructure/budget-repository-firestore';
import { BudgetService } from '@/backend/budget/application/budget-service';
import { generateBudgetFromSpecsAction } from '@/actions/budget/generate-budget-from-specs.action';
import type { ProjectSpecs } from '@/backend/budget/domain/project-specs';
import type { LeadIntake, LeadProjectType } from '@/backend/lead/domain/lead';
import type { BudgetRequirement } from '@/backend/budget/domain/budget-requirements';

/**
 * Acción que el admin invoca desde el detalle del lead para arrancar la
 * generación de pre-presupuesto. Crea un Budget placeholder en
 * `status='pending_review'` enlazado al Lead real, e invoca el motor IA
 * elegido. El UI escucha la telemetría SSE para mostrar el progreso.
 */

export type BudgetEngine = 'from-specs';

export interface DispatchBudgetResult {
    success: boolean;
    budgetId?: string;
    error?: string;
}

const PROPERTY_TYPE_BY_PROJECT: Record<LeadProjectType, ProjectSpecs['propertyType']> = {
    bathroom: 'flat',
    kitchen: 'flat',
    integral: 'flat',
    new_build: 'house',
    pool: 'house',
    other: 'flat',
};

const INTERVENTION_BY_PROJECT: Record<LeadProjectType, ProjectSpecs['interventionType']> = {
    bathroom: 'partial',
    kitchen: 'partial',
    integral: 'total',
    new_build: 'new_build',
    pool: 'partial',
    other: 'partial',
};

function buildSpecsFromIntake(intake: LeadIntake): Partial<ProjectSpecs> {
    return {
        propertyType: PROPERTY_TYPE_BY_PROJECT[intake.projectType],
        interventionType: INTERVENTION_BY_PROJECT[intake.projectType],
        totalArea: intake.approxSquareMeters || 0,
        qualityLevel: (intake.qualityLevel as ProjectSpecs['qualityLevel']) || 'medium',
        description: intake.description,
        files: intake.imageUrls || [],
    };
}

function buildRequirementFromIntake(leadId: string, intake: LeadIntake): BudgetRequirement {
    const specs = buildSpecsFromIntake(intake);
    return {
        leadId,
        createdAt: new Date(),
        status: 'complete',
        specs,
        originalPrompt: intake.description,
        transcriptions: [],
        attachmentUrls: intake.imageUrls || [],
        detectedNeeds: [],
    };
}

export async function dispatchBudgetGenerationAction(
    leadId: string,
    engine: BudgetEngine = 'from-specs',
    /**
     * Si el admin viene del wizard tras refinar la conversación con el agente,
     * pasa aquí el `BudgetRequirement` enriquecido (con detectedNeeds,
     * finalBrief, originalRequest consolidada). Sustituye al construido a
     * partir del intake bruto.
     */
    enrichedRequirement?: BudgetRequirement
): Promise<DispatchBudgetResult> {
    if (engine !== 'from-specs') {
        return { success: false, error: `Motor '${engine}' aún no soportado` };
    }

    try {
        const leadRepo = new FirestoreLeadRepository();
        const lead = await leadRepo.findById(leadId);

        if (!lead) {
            return { success: false, error: 'Lead no encontrado' };
        }
        if (!lead.intake) {
            return {
                success: false,
                error: 'El lead no tiene intake — no es posible generar pre-presupuesto',
            };
        }

        // 1. Crear el Budget placeholder vinculado al Lead real, en pending_review.
        const budgetService = new BudgetService(new BudgetRepositoryFirestore());
        const specs = buildSpecsFromIntake(lead.intake);
        const placeholder = await budgetService.createNewBudget({
            leadId: lead.id,
            clientSnapshot: {
                name: lead.personalInfo.name,
                email: lead.personalInfo.email,
                phone: lead.personalInfo.phone,
                // address es opcional en el Lead; si no existe, no lo incluimos
                // (Firestore rechaza undefined aunque ya filtramos a nivel global).
                ...(lead.personalInfo.address ? { address: lead.personalInfo.address } : {}),
            },
            status: 'pending_review',
            updatedAt: new Date(),
            version: 1,
            specs: specs as ProjectSpecs,
            chapters: [],
            costBreakdown: {
                materialExecutionPrice: 0,
                overheadExpenses: 0,
                industrialBenefit: 0,
                tax: 0,
                globalAdjustment: 0,
                total: 0,
            },
            totalEstimated: 0,
            source: 'wizard',
            type: lead.intake.projectType === 'new_build' ? 'new_build' : 'renovation',
        });

        // 2. Invocar el motor IA Python con el budgetId reservado.
        // Si el admin pasó un requirement enriquecido (refinado vía wizard),
        // lo usamos. Si no, construimos uno mínimo desde el intake bruto.
        const requirement = enrichedRequirement
            ? { ...enrichedRequirement, leadId: lead.id }
            : buildRequirementFromIntake(lead.id, lead.intake);
        const result = await generateBudgetFromSpecsAction(
            lead.id,
            requirement,
            false,
            placeholder.id
        );

        if (!result.success) {
            console.error(`[dispatchBudgetGeneration] Motor IA falló para budget ${placeholder.id}:`, result.error);
            return {
                success: false,
                budgetId: placeholder.id,
                error: result.error || 'El motor IA no pudo iniciar la generación',
            };
        }

        revalidatePath('/dashboard/leads');
        revalidatePath(`/dashboard/leads/${lead.id}`);
        revalidatePath('/dashboard/admin/budgets');

        return { success: true, budgetId: placeholder.id };
    } catch (error: any) {
        console.error('[dispatchBudgetGenerationAction] error:', error);
        return { success: false, error: error?.message || 'Error desconocido' };
    }
}

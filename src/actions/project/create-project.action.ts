'use server';

import { FirestoreProjectRepository } from '@/backend/project/infrastructure/firestore-project-repository';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { ProjectService } from '@/backend/project/application/project-service';
import { BudgetRepositoryFirestore } from '@/backend/budget/infrastructure/budget-repository-firestore';
import { revalidatePath } from 'next/cache';

const projectRepository = new FirestoreProjectRepository();
const budgetRepository = new BudgetRepositoryFirestore();
const leadRepository = new FirestoreLeadRepository();
const projectService = new ProjectService(projectRepository);

export interface CreateProjectInput {
    // Si se pasa budgetId, se crea via createFromBudget (flujo clásico).
    // Si se omite, leadId pasa a ser obligatorio (flujo "obra sin presupuesto").
    budgetId?: string;
    leadId?: string;
    name?: string;
    description?: string;
    address?: string;
    startDate?: string;
    estimatedEndDate?: string;
    estimatedBudget?: number;
}

export async function createProjectAction(data: CreateProjectInput) {
    try {
        // --- Flujo 1: con presupuesto aprobado ---
        if (data.budgetId) {
            const budget = await budgetRepository.findById(data.budgetId);
            if (!budget) {
                return { success: false, error: 'Presupuesto no encontrado' };
            }

            const project = await projectService.createFromBudget(budget, {
                name: data.name,
                description: data.description,
                address: data.address,
                startDate: data.startDate ? new Date(data.startDate) : undefined,
                estimatedEndDate: data.estimatedEndDate ? new Date(data.estimatedEndDate) : undefined,
            });

            revalidatePath('/dashboard/projects');
            return { success: true, projectId: project.id };
        }

        // --- Flujo 2: obra directa (sin presupuesto) ---
        if (!data.leadId) {
            return {
                success: false,
                error: 'Selecciona un cliente o crea uno nuevo para abrir la obra sin presupuesto.'
            };
        }

        const lead = await leadRepository.findById(data.leadId);
        if (!lead) {
            return { success: false, error: 'Cliente no encontrado' };
        }

        if (!data.name || !data.name.trim()) {
            return {
                success: false,
                error: 'El nombre de la obra es obligatorio cuando no hay presupuesto vinculado.'
            };
        }

        const project = await projectService.createWithoutBudget({
            leadId: lead.id,
            clientSnapshot: lead.personalInfo,
            name: data.name.trim(),
            description: data.description,
            address: data.address,
            startDate: data.startDate ? new Date(data.startDate) : undefined,
            estimatedEndDate: data.estimatedEndDate ? new Date(data.estimatedEndDate) : undefined,
            estimatedBudget: data.estimatedBudget,
        });

        revalidatePath('/dashboard/projects');
        return { success: true, projectId: project.id };
    } catch (error: any) {
        console.error('Error creating project:', error);
        return { success: false, error: error.message || 'Error al crear la obra' };
    }
}

'use server';

import { checkAdmin, unauthorizedResult } from '@/actions/_guards';

import { FirestoreProjectRepository } from '@/backend/project/infrastructure/firestore-project-repository';
import { ProjectService } from '@/backend/project/application/project-service';
import { PhaseStatus } from '@/backend/project/domain/project-phase';
import { revalidatePath } from 'next/cache';

const projectRepository = new FirestoreProjectRepository();
const projectService = new ProjectService(projectRepository);

export async function updateProjectPhaseAction(
    projectId: string,
    phaseId: string,
    updates: {
        status?: PhaseStatus;
        progress?: number;
        notes?: string;
        realCost?: number;
        estimatedCost?: number;
        actualStartDate?: string; // ISO string
        actualEndDate?: string;   // ISO string
        estimatedStartDate?: string; // ISO string
        estimatedEndDate?: string;   // ISO string
    }
): Promise<{ success: boolean; project?: any; error?: string }> {
    if (!(await checkAdmin())) return unauthorizedResult();
    try {
        const payload: any = { ...updates };

        // Convert string dates to Date objects if present
        if (updates.actualStartDate) payload.actualStartDate = new Date(updates.actualStartDate);
        if (updates.actualEndDate) payload.actualEndDate = new Date(updates.actualEndDate);
        if (updates.estimatedStartDate) payload.estimatedStartDate = new Date(updates.estimatedStartDate);
        if (updates.estimatedEndDate) payload.estimatedEndDate = new Date(updates.estimatedEndDate);

        const updatedProject = await projectService.updatePhase(projectId, phaseId, payload);
        revalidatePath('/dashboard/projects');
        return { success: true, project: updatedProject };
    } catch (error: any) {
        console.error('Error updating project phase:', error);
        return { success: false, error: error.message || 'Error al actualizar la fase' };
    }
}

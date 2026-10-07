'use server';

import { checkAdmin, unauthorizedResult } from '@/actions/_guards';

import { FirestoreProjectRepository } from '@/backend/project/infrastructure/firestore-project-repository';
import { ProjectService } from '@/backend/project/application/project-service';
import { revalidatePath } from 'next/cache';

const projectRepository = new FirestoreProjectRepository();
const projectService = new ProjectService(projectRepository);

export async function addProjectPhaseAction(
    projectId: string,
    data: { name: string; estimatedCost: number }
) {
    if (!(await checkAdmin())) return unauthorizedResult();
    try {
        await projectService.addPhase(projectId, data);
        revalidatePath(`/dashboard/projects/${projectId}`);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function removeProjectPhaseAction(
    projectId: string,
    phaseId: string
) {
    if (!(await checkAdmin())) return unauthorizedResult();
    try {
        await projectService.removePhase(projectId, phaseId);
        revalidatePath(`/dashboard/projects/${projectId}`);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function reorderProjectPhasesAction(
    projectId: string,
    phaseIds: string[]
) {
    if (!(await checkAdmin())) return unauthorizedResult();
    try {
        await projectService.reorderPhases(projectId, phaseIds);
        revalidatePath(`/dashboard/projects/${projectId}`);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

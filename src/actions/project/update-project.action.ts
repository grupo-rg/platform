'use server';

import { checkAdmin, unauthorizedResult } from '@/actions/_guards';

import { FirestoreProjectRepository } from '@/backend/project/infrastructure/firestore-project-repository';
import { ProjectService } from '@/backend/project/application/project-service';
import { revalidatePath } from 'next/cache';

const projectRepository = new FirestoreProjectRepository();
const projectService = new ProjectService(projectRepository);

export async function updateProjectAction(
    projectId: string,
    updates: {
        name?: string;
        description?: string;
        address?: string;
        startDate?: string;        // ISO string
        estimatedEndDate?: string;  // ISO string
        actualEndDate?: string;    // ISO string
    }
): Promise<{ success: boolean; project?: any; error?: string }> {
    if (!(await checkAdmin())) return unauthorizedResult();
    try {
        const payload: any = { ...updates };

        // Convert dates
        if (updates.startDate) payload.startDate = new Date(updates.startDate);
        if (updates.estimatedEndDate) payload.estimatedEndDate = new Date(updates.estimatedEndDate);
        if (updates.actualEndDate) payload.actualEndDate = new Date(updates.actualEndDate);

        const updatedProject = await projectService.update(projectId, payload);

        revalidatePath('/dashboard/projects');
        revalidatePath(`/dashboard/projects/${projectId}`);

        return { success: true, project: updatedProject };
    } catch (error: any) {
        console.error('Error updating project:', error);
        return { success: false, error: error.message || 'Error al actualizar el proyecto' };
    }
}

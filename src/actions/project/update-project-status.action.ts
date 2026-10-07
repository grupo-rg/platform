'use server';

import { checkAdmin, unauthorizedResult } from '@/actions/_guards';

import { FirestoreProjectRepository } from '@/backend/project/infrastructure/firestore-project-repository';
import { ProjectService } from '@/backend/project/application/project-service';
import { ProjectStatus } from '@/backend/project/domain/project';
import { revalidatePath } from 'next/cache';

const projectRepository = new FirestoreProjectRepository();
const projectService = new ProjectService(projectRepository);

export async function updateProjectStatusAction(projectId: string, newStatus: ProjectStatus): Promise<{ success: boolean; project?: any; error?: string }> {
    if (!(await checkAdmin())) return unauthorizedResult();
    try {
        const updatedProject = await projectService.updateStatus(projectId, newStatus);
        revalidatePath('/dashboard/projects');
        return { success: true, project: updatedProject };
    } catch (error: any) {
        console.error('Error updating project status:', error);
        return { success: false, error: error.message || 'Error al actualizar el estado' };
    }
}

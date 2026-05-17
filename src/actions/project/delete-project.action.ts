'use server';

import { FirestoreProjectRepository } from '@/backend/project/infrastructure/firestore-project-repository';
import { revalidatePath } from 'next/cache';

const projectRepository = new FirestoreProjectRepository();

export async function deleteProjectAction(projectId: string) {
    try {
        const existing = await projectRepository.findById(projectId);
        if (!existing) {
            return { success: false, error: 'Obra no encontrada.' };
        }
        await projectRepository.delete(projectId);
        revalidatePath('/dashboard/projects');
        return { success: true };
    } catch (error: any) {
        console.error('Error deleting project:', error);
        return { success: false, error: error?.message || 'Error al eliminar la obra' };
    }
}

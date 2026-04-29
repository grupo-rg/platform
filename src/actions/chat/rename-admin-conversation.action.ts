'use server';

import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';

/**
 * Renombra el título de una conversación admin (campo `metadata.title`).
 * El título se persiste para mostrarse en la lista lateral del wizard.
 *
 * No hay validación de propietario (igual que `delete-admin-conversation`):
 * el dashboard se considera trusted. Si más adelante hay multi-tenancy,
 * añadir verificación de ownership aquí.
 */
export async function renameAdminConversationAction(
    conversationId: string,
    newTitle: string,
) {
    try {
        const trimmed = (newTitle || '').trim();
        if (!conversationId) {
            return { success: false, error: 'conversationId requerido' };
        }
        if (!trimmed) {
            return { success: false, error: 'El título no puede estar vacío' };
        }
        if (trimmed.length > 120) {
            return { success: false, error: 'Título demasiado largo (máx 120 chars)' };
        }

        initFirebaseAdminApp();
        const db = getFirestore();
        await db.collection('conversations').doc(conversationId).set(
            {
                metadata: { title: trimmed },
                updatedAt: new Date().toISOString(),
            },
            { merge: true },
        );

        return { success: true, title: trimmed };
    } catch (error: any) {
        console.error('Error renaming conversation:', error);
        return { success: false, error: error.message };
    }
}

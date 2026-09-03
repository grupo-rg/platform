'use server';

import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';

/**
 * Persiste el snapshot de `requirements` (mapa estructural: specs, detectedNeeds,
 * capítulos identificados, targetBudget…) en la conversación, dentro de
 * `metadata.requirements`. Así el estado recopilado por el agente sobrevive a un
 * reload del navegador y la conversación puede continuarse.
 *
 * Usa merge-set (igual que `rename-admin-conversation`) para NO pisar
 * `metadata.title` ni otros campos. Sanea `undefined` (Firestore no lo admite).
 */
export async function persistConversationRequirementsAction(
    conversationId: string,
    requirements: any,
) {
    try {
        if (!conversationId) {
            return { success: false, error: 'conversationId requerido' };
        }

        // Firestore rechaza `undefined`; el round-trip JSON los elimina.
        const clean = requirements ? JSON.parse(JSON.stringify(requirements)) : {};

        initFirebaseAdminApp();
        const db = getFirestore();
        await db.collection('conversations').doc(conversationId).set(
            {
                metadata: { requirements: clean },
                updatedAt: new Date().toISOString(),
            },
            { merge: true },
        );

        return { success: true };
    } catch (error: any) {
        console.error('Error persisting conversation requirements:', error);
        return { success: false, error: error.message };
    }
}

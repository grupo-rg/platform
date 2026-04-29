'use server';

/**
 * Fase 6.B — server action para capturar una corrección humana del aparejador
 * como `HeuristicFragment`. Escribe en la colección `heuristic_fragments`,
 * que es la misma que lee el `FirestoreHeuristicFragmentRepository` Python en
 * 6.C.
 *
 * El motivo del dropdown y la nota libre se guardan en `humanCorrection.heuristicRule`;
 * los tags `chapter:<NAME>` + `reason:<KIND>` habilitan el retrieval en el Swarm.
 */

import { randomUUID } from 'node:crypto';

import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';
import {
    buildHeuristicFragmentPayload,
    type BuildHeuristicFragmentInput,
} from '@/backend/ai-training/domain/heuristic-fragment-builder';

export async function saveHeuristicCorrectionAction(
    input: Omit<BuildHeuristicFragmentInput, 'timestamp'>,
): Promise<{ success: boolean; fragmentId?: string; error?: string }> {
    try {
        initFirebaseAdminApp();
        const db = getFirestore();

        const fragmentId = `frag-${randomUUID()}`;
        const payload = buildHeuristicFragmentPayload({
            ...input,
            timestamp: new Date(),
        });

        // Escribimos con doc(id).set() para que el campo `id` viaje en el doc
        // (el schema Python `HeuristicFragment` lo requiere al hacer model_validate).
        await db
            .collection('heuristic_fragments')
            .doc(fragmentId)
            .set({ id: fragmentId, ...payload });

        return { success: true, fragmentId };
    } catch (error: any) {
        console.error('saveHeuristicCorrectionAction failed:', error);
        return {
            success: false,
            error: error?.message || 'Error guardando la corrección en Firestore.',
        };
    }
}

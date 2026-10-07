'use server';

import { requireAdmin } from '@/actions/_guards';

import { getFirestore } from 'firebase-admin/firestore';
import { MaterialItem } from '@/backend/material-catalog/domain/material-item';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';

initFirebaseAdminApp();

export async function getLatestMaterialsAction(limit: number = 20): Promise<MaterialItem[]> {
    await requireAdmin();
    try {
        const snapshot = await getFirestore().collection('material_catalog')
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .get();

        return snapshot.docs.map(doc => {
            const data = doc.data();
            const { embedding, ...rest } = data; // Exclude embedding from client payload
            return {
                ...rest,
                // Serialize dates/timestamps
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
                updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt),
            } as MaterialItem;
        });
    } catch (error) {
        console.error("Error fetching latest materials:", error);
        return [];
    }
}

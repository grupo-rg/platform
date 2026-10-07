'use server';

import { requireAdmin } from '@/actions/_guards';

import { getFirestore } from 'firebase-admin/firestore';
import { IngestionStatus } from '@/backend/material-catalog/domain/ingestion-status';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';
import { unstable_noStore as noStore } from 'next/cache';

// Ensure Firebase Admin is initialized
initFirebaseAdminApp();

export async function getIngestionStatusAction(jobId: string): Promise<IngestionStatus | null> {
    await requireAdmin();
    noStore(); // Opt out of static caching
    try {
        console.log(`[Action] Fetching status for JobId: ${jobId}`);
        const doc = await getFirestore().collection('ingestion_jobs').doc(jobId).get();
        if (!doc.exists) {
            console.warn(`[Action] JobId ${jobId} not found in Firestore.`);
            return null;
        }

        // Convert timestamp objects to numbers if needed, but Firestore Admin SDK usually returns Timestamp objects
        // stored as numbers in our interface. Admin SDK returns Timestamp class.
        // We need to serialize for client.
        const data = doc.data() as any;

        return {
            ...data,
            // Ensure timestamps are numbers
            createdAt: data.createdAt?.toMillis ? data.createdAt.toMillis() : data.createdAt,
            updatedAt: data.updatedAt?.toMillis ? data.updatedAt.toMillis() : data.updatedAt,
            logs: data.logs?.map((log: any) => ({
                ...log,
                timestamp: log.timestamp?.toMillis ? log.timestamp.toMillis() : log.timestamp
            })) || []
        } as IngestionStatus;

    } catch (error) {
        console.error("Error fetching ingestion status:", error);
        return null;
    }
}

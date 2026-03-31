'use server';

import { FirestoreConversationRepository } from '@/backend/chat/infrastructure/firestore-conversation-repository';
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/backend/shared/infrastructure/firebase/admin-app';

export async function getAdminConversationsAction(adminId: string = 'admin-user') {
    try {
        initFirebaseAdminApp();
        const db = getFirestore();
        const collection = db.collection('conversations');

        const snapshot = await collection
            .where('relatedEntity.type', '==', 'admin')
            .where('relatedEntity.id', '==', adminId)
            .orderBy('updatedAt', 'desc')
            .get();

        const conversations = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                title: data.metadata?.title || 'Nueva Conversación',
                updatedAt: data.updatedAt,
                status: data.status
            };
        });

        // If no conversations exist, create one automatically
        if (conversations.length === 0) {
            const { createAdminConversationAction } = await import('./create-admin-conversation.action');
            const newRes = await createAdminConversationAction(adminId);
            if (newRes.success && newRes.conversationId) {
                return {
                    success: true,
                    conversations: [{
                        id: newRes.conversationId,
                        title: 'Nueva Conversación',
                        updatedAt: new Date().toISOString(),
                        status: 'active'
                    }]
                };
            }
        }

        return {
            success: true,
            conversations
        };
    } catch (error: any) {
        console.error("Error getting admin conversations:", error);
        return { success: false, error: error.message };
    }
}

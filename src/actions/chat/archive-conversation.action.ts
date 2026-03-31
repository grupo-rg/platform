'use server';

import { FirestoreConversationRepository } from '@/backend/chat/infrastructure/firestore-conversation-repository';

export async function archiveConversationAction(conversationId: string) {
    try {
        const repo = new FirestoreConversationRepository();
        const conversation = await repo.findById(conversationId);
        
        if (!conversation) {
            return { success: false, error: 'Conversation not found' };
        }

        conversation.archive();
        await repo.save(conversation);

        return { success: true };
    } catch (error: any) {
        console.error('Error archiving conversation:', error);
        return { success: false, error: error.message };
    }
}

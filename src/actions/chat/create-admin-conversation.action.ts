'use server';

import { FirestoreConversationRepository } from '@/backend/chat/infrastructure/firestore-conversation-repository';
import { Conversation } from '@/backend/chat/domain/conversation';
import { v4 as uuidv4 } from 'uuid';

export async function createAdminConversationAction(adminId: string = 'admin-user') {
    try {
        const conversationRepo = new FirestoreConversationRepository();

        const newConversation = new Conversation(
            uuidv4(),
            [
                { id: adminId, type: 'admin', name: 'Administrador' },
                { id: 'assistant', type: 'assistant', name: 'Arquitecto IA' }
            ],
            { type: 'admin', id: adminId },
            'active',
            new Date(),
            new Date()
        );

        await conversationRepo.save(newConversation);

        return {
            success: true,
            conversationId: newConversation.id
        };
    } catch (error: any) {
        console.error("Error creating admin conversation:", error);
        return { success: false, error: error.message };
    }
}

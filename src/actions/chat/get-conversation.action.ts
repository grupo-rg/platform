'use server';

import { FirestoreConversationRepository } from '@/backend/chat/infrastructure/firestore-conversation-repository';
import { GetOrCreateConversationUseCase } from '@/backend/chat/application/get-or-create-conversation.usecase';
import { GetConversationHistoryUseCase } from '@/backend/chat/application/get-conversation-history.usecase';
import { FirestoreMessageRepository } from '@/backend/chat/infrastructure/firestore-message-repository';

export async function getConversationAction(leadId: string) {
    try {
        const conversationRepo = new FirestoreConversationRepository();
        const messageRepo = new FirestoreMessageRepository();

        const getOrCreateUseCase = new GetOrCreateConversationUseCase(conversationRepo);
        const getHistoryUseCase = new GetConversationHistoryUseCase(messageRepo);

        // 1. Get or create conversation
        const conversation = await getOrCreateUseCase.execute(leadId);

        // 2. Get history
        const messages = await getHistoryUseCase.execute(conversation.id);

        return {
            success: true,
            conversationId: conversation.id,
            // Snapshot de requirements persistido (mapa estructural) para sobrevivir a reload.
            requirements: (conversation.metadata as any)?.requirements || {},
            messages: messages.map(m => ({
                id: m.id,
                content: m.content,
                role: m.sender.type === 'lead' ? 'user' : 'assistant',
                createdAt: m.createdAt.toISOString(),
                attachments: m.attachments?.map(a => a.url) || []
            }))
        };

    } catch (error: any) {
        console.error("Error getting conversation:", error);
        return { success: false, error: error.message };
    }
}

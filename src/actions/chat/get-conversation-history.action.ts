'use server';

import { FirestoreMessageRepository } from '@/backend/chat/infrastructure/firestore-message-repository';
import { FirestoreConversationRepository } from '@/backend/chat/infrastructure/firestore-conversation-repository';
import { GetConversationHistoryUseCase } from '@/backend/chat/application/get-conversation-history.usecase';

export async function getConversationHistoryAction(conversationId: string) {
    try {
        const messageRepo = new FirestoreMessageRepository();
        const useCase = new GetConversationHistoryUseCase(messageRepo);

        const messages = await useCase.execute(conversationId);

        // Rehidratar el snapshot de requirements (mapa estructural / capítulos / specs)
        // que se persiste en la conversación, para que sobreviva a un reload del navegador.
        let requirements: any = {};
        try {
            const conversationRepo = new FirestoreConversationRepository();
            const conversation = await conversationRepo.findById(conversationId);
            requirements = conversation?.metadata?.requirements || {};
        } catch (e) {
            console.warn('No se pudieron cargar los requirements de la conversación', e);
        }

        return {
            success: true,
            requirements,
            messages: messages.map(m => ({
                id: m.id,
                content: m.content,
                // `sender` se conserva para consumidores que lo leen directo (AdminChatWindow).
                sender: m.sender,
                // `role` derivado para la UI del wizard (isUser/isSystem). Sin esto, al recargar
                // TODOS los mensajes quedaban con role=undefined y se pintaban como el agente.
                role: m.sender.type === 'admin' || m.sender.type === 'lead' ? 'user' : 'assistant',
                createdAt: m.createdAt.toISOString(),
                attachments: m.attachments || [],
                type: m.type
            }))
        };

    } catch (error: any) {
        console.error("Error getting conversation history:", error);
        return { success: false, error: error.message };
    }
}

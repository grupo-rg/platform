'use server';

import { checkAdmin, unauthorizedResult } from '@/actions/_guards';

import { FirestoreConversationRepository } from '@/backend/chat/infrastructure/firestore-conversation-repository';
import { FirestoreMessageRepository } from '@/backend/chat/infrastructure/firestore-message-repository';
import { SendMessageUseCase } from '@/backend/chat/application/send-message.usecase';
import { Participant } from '@/backend/chat/domain/conversation';

/**
 * Persiste un mensaje en una conversación del panel (chat admin / asistente).
 *
 * Seguridad: exige sesión admin. La identidad del remitente sale de la sesión,
 * NO de los argumentos del cliente:
 *   - `senderType: 'assistant'` → se guarda como `{ type: 'assistant', id: 'system' }`
 *     (el asistente del wizard privado persiste su respuesta desde el cliente).
 *   - cualquier otro valor (`'admin'`, y también `'lead'`, que ya no se acepta
 *     desde aquí para evitar suplantaciones) → `{ type: 'admin', id: <uid de sesión> }`.
 *
 * `_senderId` se mantiene en la firma por compatibilidad con los llamadores
 * existentes, pero se ignora.
 */
export async function sendMessageAction(
    conversationId: string,
    content: string,
    senderType: 'lead' | 'admin' | 'assistant',
    _senderId?: string,
    attachments: string[] = []
) {
    const auth = await checkAdmin();
    if (!auth) return unauthorizedResult();
    try {
        const conversationRepo = new FirestoreConversationRepository();
        const messageRepo = new FirestoreMessageRepository();
        const sendMessageUseCase = new SendMessageUseCase(messageRepo, conversationRepo);

        const sender: Participant = senderType === 'assistant'
            ? { id: 'system', type: 'assistant' }
            : { id: auth.userId, type: 'admin' };

        const message = await sendMessageUseCase.execute({
            conversationId,
            sender,
            content,
            attachments: attachments.map(url => ({ type: 'image', url })) // Simplifying for now
        });

        return {
            success: true,
            messageId: message.id
        };

    } catch (error: any) {
        console.error("Error sending message:", error);
        return { success: false, error: error.message };
    }
}

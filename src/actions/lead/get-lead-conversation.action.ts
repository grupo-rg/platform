'use server';

import { FirestoreConversationRepository } from '@/backend/chat/infrastructure/firestore-conversation-repository';
import { FirestoreMessageRepository } from '@/backend/chat/infrastructure/firestore-message-repository';

export interface ConversationMessageDTO {
    id: string;
    senderId: string;
    senderType: string;
    senderName?: string;
    content: string;
    type: string;
    attachments: { type: string; url: string; name?: string }[];
    createdAt: string;
}

export interface LeadConversationDTO {
    conversationId: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    messages: ConversationMessageDTO[];
    metadata: Record<string, any>;
}

/**
 * Carga la conversación del chat público vinculada a un lead (si existe)
 * con todos sus mensajes ordenados ascendentemente. Devuelve `null` cuando
 * el lead no tuvo chat (vino sólo de formulario).
 */
export async function getLeadConversationAction(leadId: string): Promise<{
    success: boolean;
    conversation?: LeadConversationDTO | null;
    error?: string;
}> {
    try {
        const convRepo = new FirestoreConversationRepository();
        const msgRepo = new FirestoreMessageRepository();

        const conversations = await convRepo.findByLeadId(leadId);
        if (conversations.length === 0) {
            return { success: true, conversation: null };
        }

        // Si hay varias, tomamos la más recientemente actualizada.
        const conv = conversations[0];
        const messages = await msgRepo.findByConversationId(conv.id);

        return {
            success: true,
            conversation: {
                conversationId: conv.id,
                status: conv.status,
                createdAt: conv.createdAt.toISOString(),
                updatedAt: conv.updatedAt.toISOString(),
                metadata: conv.metadata || {},
                messages: messages.map(m => ({
                    id: m.id,
                    senderId: m.sender.id,
                    senderType: m.sender.type,
                    senderName: m.sender.name,
                    content: m.content,
                    type: m.type,
                    attachments: (m.attachments || []).map(a => ({
                        type: a.type,
                        url: a.url,
                        name: a.name,
                    })),
                    createdAt: m.createdAt.toISOString(),
                })),
            },
        };
    } catch (error: any) {
        console.error('getLeadConversationAction Error:', error);
        return { success: false, error: error?.message || 'Error obteniendo conversación' };
    }
}

import { ConversationRepository } from '../domain/conversation-repository';
import { Conversation } from '../domain/conversation';

const ANONYMOUS_PREFIX = 'anon-';

/**
 * Convención: las conversaciones del chat público antes del handoff se
 * persisten con `relatedEntity.id = 'anon-' + sessionId`. Cuando ocurre el
 * handoff y se crea el Lead real, este use case migra la conversación
 * actualizando `relatedEntity.id` (y los participants) al `leadId` real.
 *
 * No mueve los mensajes — `Message.conversationId` no cambia, sólo cambia
 * a quién pertenece la conversación.
 */
export class LinkSessionToLeadUseCase {
    constructor(private readonly conversationRepo: ConversationRepository) {}

    static anonymousLeadId(sessionId: string): string {
        return ANONYMOUS_PREFIX + sessionId;
    }

    async execute(sessionId: string, realLeadId: string, leadName?: string): Promise<void> {
        if (!sessionId || !realLeadId) return;
        const anonymousId = LinkSessionToLeadUseCase.anonymousLeadId(sessionId);

        const conversations = await this.conversationRepo.findByLeadId(anonymousId);
        if (conversations.length === 0) {
            console.warn(`[LinkSessionToLead] No se encontró conversación anónima para sessionId=${sessionId}`);
            return;
        }

        for (const conv of conversations) {
            const updated = new Conversation(
                conv.id,
                conv.participants.map(p =>
                    p.id === anonymousId
                        ? { ...p, id: realLeadId, name: leadName || p.name }
                        : p
                ),
                { type: 'lead', id: realLeadId },
                conv.status,
                conv.createdAt,
                new Date(),
                {
                    ...conv.metadata,
                    linkedFromSessionId: sessionId,
                    linkedAt: new Date().toISOString(),
                },
                conv.unreadCount
            );
            await this.conversationRepo.save(updated);
        }

        console.log(`[LinkSessionToLead] Migradas ${conversations.length} conversaciones de ${anonymousId} → ${realLeadId}`);
    }
}

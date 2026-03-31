
export type ParticipantType = 'lead' | 'admin' | 'assistant' | 'system';

export interface Participant {
    id: string; // Lead ID, User ID (Admin), or 'system'/'assistant'
    type: ParticipantType;
    name?: string; // Optional display name snapshot
    avatar?: string; // Optional avatar URL snapshot
}

export type ConversationStatus = 'active' | 'archived' | 'waiting_for_admin' | 'waiting_for_user';

export interface RelatedEntity {
    type: 'lead' | 'budget' | 'admin';
    id: string;
}

export class Conversation {
    constructor(
        public readonly id: string,
        public readonly participants: Participant[],
        public readonly relatedEntity: RelatedEntity,
        public status: ConversationStatus,
        public readonly createdAt: Date,
        public updatedAt: Date,
        public metadata: Record<string, any> = {},
        public unreadCount: number = 0 // For admin dashboard efficiency
    ) { }

    static create(id: string, leadId: string, leadName?: string): Conversation {
        const leadParticipant: Participant = {
            id: leadId,
            type: 'lead',
            name: leadName || 'Usuario'
        };

        const systemParticipant: Participant = {
            id: 'assistant',
            type: 'assistant',
            name: 'Arquitecto IA'
        };

        return new Conversation(
            id,
            [leadParticipant, systemParticipant],
            { type: 'lead', id: leadId },
            'active',
            new Date(),
            new Date()
        );
    }

    addParticipant(participant: Participant): void {
        if (!this.participants.find(p => p.id === participant.id)) {
            this.participants.push(participant);
            this.updatedAt = new Date();
        }
    }

    markAsUpdated(): void {
        this.updatedAt = new Date();
    }

    setStatus(status: ConversationStatus): void {
        this.status = status;
        this.updatedAt = new Date();
    }

    archive(): void {
        this.setStatus('archived');
    }
}

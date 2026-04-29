import { DomainEvent } from "../../../shared/domain/domain-event";
import type { QualificationDecision, LeadIntake, LeadIntakeSource } from "../lead";

export class LeadCreatedEvent implements DomainEvent {
    readonly eventName = 'LeadCreatedEvent';
    readonly occurredOn: Date;

    constructor(
        public readonly leadId: string,
        public readonly leadName: string,
        public readonly leadEmail: string,
        public readonly source: LeadIntakeSource,
        public readonly decision: QualificationDecision,
        public readonly score: number,
        /**
         * Snapshot del intake en el momento de crear el evento. Cada solicitud
         * cualificable representa potencialmente una OBRA distinta (incluso si
         * el lead es el mismo). El listener CRM persiste este snapshot dentro
         * del Deal para que cada deal tenga su propio contexto sin que la
         * siguiente solicitud lo machaque.
         */
        public readonly intakeSnapshot?: LeadIntake,
        /**
         * Idioma del visitante (lead.preferences.language). Lo usa el
         * listener de re-engagement para elegir plantilla del email.
         */
        public readonly locale?: string
    ) {
        this.occurredOn = new Date();
    }
}

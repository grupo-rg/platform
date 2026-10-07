import { DomainEvent } from "../../../shared/domain/domain-event";
import type { QualificationDecision, LeadIntake, LeadIntakeSource } from "../lead";
import type { LeadConsent } from "../lead-consent";

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
        public readonly locale?: string,
        /**
         * true si la solicitud llegó con el email de un lead EXISTENTE sin
         * sesión verificada de ese lead. El intake NO se ha escrito en el lead;
         * sólo viaja en este evento (→ Deal marcado `identityUnverified`).
         * Los listeners de marketing/re-engagement deben ignorarla.
         */
        public readonly identityUnverified: boolean = false,
        /** Consentimientos declarados en esta solicitud (sólo informativo para el Deal). */
        public readonly submittedConsents?: LeadConsent[]
    ) {
        this.occurredOn = new Date();
    }
}

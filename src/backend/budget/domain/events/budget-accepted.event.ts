import { DomainEvent } from '../../../shared/domain/domain-event';

/**
 * Se emite cuando el cliente acepta un presupuesto desde la página pública
 * `/aceptar-presupuesto/[token]`. El listener CRM mueve el deal a
 * CLOSED_WON; el listener de marketing envía email confirmación al admin
 * y al cliente; el listener de scoring suma puntos al lead.
 */
export class BudgetAcceptedEvent implements DomainEvent {
    readonly eventName = 'BudgetAcceptedEvent';
    readonly occurredOn: Date;

    constructor(
        public readonly budgetId: string,
        public readonly leadId: string,
        public readonly clientEmail: string,
        public readonly clientName: string,
        public readonly totalEstimated: number,
        public readonly signatureName: string,
        public readonly acceptedAt: Date,
        public readonly ipAddress?: string
    ) {
        this.occurredOn = new Date();
    }
}

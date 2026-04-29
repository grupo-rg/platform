import { DomainEvent } from '../../../shared/domain/domain-event';

/**
 * Se emite cuando el admin envía un presupuesto aprobado al cliente final.
 * El listener CRM mueve la oportunidad a `PROPOSAL_SENT` y adjunta el
 * `pdfUrl` al deal para trazabilidad.
 */
export class BudgetSentEvent implements DomainEvent {
    readonly eventName = 'BudgetSentEvent';
    readonly occurredOn: Date;

    constructor(
        public readonly budgetId: string,
        public readonly leadId: string,
        public readonly clientEmail: string,
        public readonly clientName: string,
        public readonly totalEstimated: number,
        public readonly pdfUrl: string,
        public readonly version: number
    ) {
        this.occurredOn = new Date();
    }
}

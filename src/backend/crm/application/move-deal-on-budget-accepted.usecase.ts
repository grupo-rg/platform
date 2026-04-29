import { EventHandler } from '../../shared/events/event-dispatcher';
import { BudgetAcceptedEvent } from '../../budget/domain/events/budget-accepted.event';
import { DealRepository } from '../domain/deal.repository';
import { PipelineStage } from '../domain/deal';

/**
 * Listener CRM: cuando el cliente acepta un presupuesto, el deal del lead
 * se mueve a CLOSED_WON con el detalle de la aceptación (firma + valor).
 * Si hay varios deals abiertos, sólo movemos el más reciente — el budget
 * fue enviado para una oportunidad concreta.
 */
export class MoveDealOnBudgetAcceptedUseCase implements EventHandler<BudgetAcceptedEvent> {
    constructor(private readonly dealRepo: DealRepository) {}

    async handle(event: BudgetAcceptedEvent): Promise<void> {
        if (!event.leadId) return;

        const deal = await this.dealRepo.findByLeadId(event.leadId);
        if (!deal) {
            console.warn(`[CRM] BudgetAcceptedEvent recibido sin deal activo para lead ${event.leadId}.`);
            return;
        }

        deal.moveToStage(PipelineStage.CLOSED_WON);
        deal.updateEstimatedValue(event.totalEstimated || 0);

        if (!deal.metadata) deal.metadata = {};
        deal.metadata.acceptanceBudgetId = event.budgetId;
        deal.metadata.acceptanceSignatureName = event.signatureName;
        deal.metadata.acceptanceAcceptedAt = event.acceptedAt.toISOString();
        if (event.ipAddress) deal.metadata.acceptanceIpAddress = event.ipAddress;

        await this.dealRepo.save(deal);
        console.log(`[CRM] Deal ${deal.id} movido a CLOSED_WON tras aceptación del cliente (budget ${event.budgetId}).`);
    }
}

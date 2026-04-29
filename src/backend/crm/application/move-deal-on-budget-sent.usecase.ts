import { EventHandler } from '../../shared/events/event-dispatcher';
import { BudgetSentEvent } from '../../budget/domain/events/budget-sent.event';
import { DealRepository } from '../domain/deal.repository';
import { PipelineStage } from '../domain/deal';

/**
 * Listener CRM: cuando el admin envía un presupuesto al cliente, el deal
 * más reciente del lead salta a PROPOSAL_SENT y guarda el `pdfUrl` para
 * trazabilidad. Si hay varias oportunidades activas para el mismo lead,
 * actualizamos sólo la más reciente — el admin asocia el budget a una
 * oportunidad concreta cuando lo dispara desde el detalle del lead.
 */
export class MoveDealOnBudgetSentUseCase implements EventHandler<BudgetSentEvent> {
    constructor(private readonly dealRepo: DealRepository) {}

    async handle(event: BudgetSentEvent): Promise<void> {
        if (!event.leadId) return;

        const deal = await this.dealRepo.findByLeadId(event.leadId);
        if (!deal) {
            console.warn(`[CRM] BudgetSentEvent recibido pero no hay Deal activo para Lead ${event.leadId}.`);
            return;
        }

        deal.moveToStage(PipelineStage.PROPOSAL_SENT);
        deal.updateEstimatedValue(event.totalEstimated || 0);

        if (!deal.metadata) deal.metadata = {};
        deal.metadata.proposalBudgetId = event.budgetId;
        deal.metadata.proposalPdfUrl = event.pdfUrl;
        deal.metadata.proposalVersion = event.version;
        deal.metadata.proposalSentAt = event.occurredOn.toISOString();

        await this.dealRepo.save(deal);
        console.log(`[CRM] Deal ${deal.id} movido a PROPOSAL_SENT (budget ${event.budgetId}).`);
    }
}

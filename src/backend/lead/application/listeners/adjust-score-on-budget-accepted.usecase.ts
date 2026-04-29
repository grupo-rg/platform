import 'server-only';
import type { EventHandler } from '@/backend/shared/events/event-dispatcher';
import type { BudgetAcceptedEvent } from '@/backend/budget/domain/events/budget-accepted.event';
import { AdjustLeadScoreUseCase } from '../adjust-lead-score.use-case';
import type { LeadRepository } from '../../domain/lead-repository';

/**
 * Cuando el cliente acepta el presupuesto, el lead sube +30 al score —
 * señal máxima de conversión. Útil para análiticas históricas y para
 * priorizar campañas de upsell sobre clientes que ya cerraron.
 */
export class AdjustScoreOnBudgetAccepted implements EventHandler<BudgetAcceptedEvent> {
    private readonly adjustScore: AdjustLeadScoreUseCase;

    constructor(leadRepo: LeadRepository) {
        this.adjustScore = new AdjustLeadScoreUseCase(leadRepo);
    }

    async handle(event: BudgetAcceptedEvent): Promise<void> {
        if (!event.leadId) return;
        await this.adjustScore.execute({
            leadId: event.leadId,
            delta: 30,
            eventId: `budget_accepted:${event.budgetId}`,
            reason: 'Cliente aceptó el presupuesto',
        });
    }
}

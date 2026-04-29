import 'server-only';
import type { EventHandler } from '@/backend/shared/events/event-dispatcher';
import type { BudgetSentEvent } from '@/backend/budget/domain/events/budget-sent.event';
import { AdjustLeadScoreUseCase } from '../adjust-lead-score.use-case';
import type { LeadRepository } from '../../domain/lead-repository';

/**
 * Cuando se envía un presupuesto al cliente, el lead sube +10 al score —
 * indica que el admin lo consideró suficientemente serio como para invertir
 * tiempo en una propuesta formal.
 */
export class AdjustScoreOnBudgetSent implements EventHandler<BudgetSentEvent> {
    private readonly adjustScore: AdjustLeadScoreUseCase;

    constructor(leadRepo: LeadRepository) {
        this.adjustScore = new AdjustLeadScoreUseCase(leadRepo);
    }

    async handle(event: BudgetSentEvent): Promise<void> {
        if (!event.leadId) return;
        await this.adjustScore.execute({
            leadId: event.leadId,
            delta: 10,
            eventId: `budget_sent:${event.budgetId}`,
            reason: 'Presupuesto enviado al cliente',
        });
    }
}

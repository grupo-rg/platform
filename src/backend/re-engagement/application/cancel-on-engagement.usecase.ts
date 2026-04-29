import 'server-only';
import type { EventHandler } from '@/backend/shared/events/event-dispatcher';
import type { BookingConfirmedEvent } from '@/backend/agenda/domain/events/booking-confirmed.event';
import type { BudgetSentEvent } from '@/backend/budget/domain/events/budget-sent.event';
import type { BudgetAcceptedEvent } from '@/backend/budget/domain/events/budget-accepted.event';
import type { ReEngagementScheduleRepository } from '../domain/schedule-entry';

/**
 * Listener genérico que cancela todos los emails de re-engagement
 * pendientes de un lead cuando hay una señal de "engagement real":
 * booking confirmado, presupuesto enviado o aceptación.
 *
 * Idempotente: si ya estaban canceladas (o ya enviadas), `cancelAllForLead`
 * sólo toca las activas y devuelve cuántas marcó.
 */

abstract class CancelReEngagementBase {
    constructor(private readonly repo: ReEngagementScheduleRepository) {}

    protected async cancel(leadId: string, reason: string): Promise<void> {
        if (!leadId) return;
        const count = await this.repo.cancelAllForLead(leadId, reason);
        if (count > 0) {
            console.log(`[ReEngagement] Canceladas ${count} entries activas de lead ${leadId} · ${reason}`);
        }
    }
}

export class CancelReEngagementOnBookingConfirmed
    extends CancelReEngagementBase
    implements EventHandler<BookingConfirmedEvent>
{
    async handle(event: BookingConfirmedEvent): Promise<void> {
        if (!event.leadId) return;
        await this.cancel(event.leadId, 'booking_confirmed');
    }
}

export class CancelReEngagementOnBudgetSent
    extends CancelReEngagementBase
    implements EventHandler<BudgetSentEvent>
{
    async handle(event: BudgetSentEvent): Promise<void> {
        await this.cancel(event.leadId, 'budget_sent');
    }
}

export class CancelReEngagementOnBudgetAccepted
    extends CancelReEngagementBase
    implements EventHandler<BudgetAcceptedEvent>
{
    async handle(event: BudgetAcceptedEvent): Promise<void> {
        await this.cancel(event.leadId, 'budget_accepted');
    }
}

import 'server-only';
import type { EventHandler } from '@/backend/shared/events/event-dispatcher';
import type { BookingCancelledEvent } from '@/backend/agenda/domain/events/booking-cancelled.event';
import { AdjustLeadScoreUseCase } from '../adjust-lead-score.use-case';
import type { LeadRepository } from '../../domain/lead-repository';

/**
 * Cuando un lead cancela su propio booking, revierte el +20 que se aplicó
 * al confirmarlo. Si la cancelación la hizo el admin (motivo interno),
 * NO se revierte — el lead no debería ver bajar su score por una decisión
 * operativa nuestra.
 *
 * Idempotente vía `eventId` distinto al de `BookingConfirmed` — usa el
 * sufijo `:cancel` para coexistir con la entrada original en el historial.
 */
export class AdjustScoreOnBookingCancelled implements EventHandler<BookingCancelledEvent> {
    private readonly adjustScore: AdjustLeadScoreUseCase;

    constructor(leadRepo: LeadRepository) {
        this.adjustScore = new AdjustLeadScoreUseCase(leadRepo);
    }

    async handle(event: BookingCancelledEvent): Promise<void> {
        if (!event.leadId) return;
        if (event.cancelledBy !== 'lead') return;

        await this.adjustScore.execute({
            leadId: event.leadId,
            delta: -20,
            eventId: `booking_cancelled:${event.bookingId}`,
            reason: 'Lead canceló su sesión desde el chat',
        });
    }
}

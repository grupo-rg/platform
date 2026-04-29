import 'server-only';
import type { EventHandler } from '@/backend/shared/events/event-dispatcher';
import type { BookingConfirmedEvent } from '@/backend/agenda/domain/events/booking-confirmed.event';
import { AdjustLeadScoreUseCase } from '../adjust-lead-score.use-case';
import type { LeadRepository } from '../../domain/lead-repository';

/**
 * Cuando un lead confirma un booking con un asesor, sube +20 al score.
 * Es la señal más fuerte de intención real fuera del closing.
 */
export class AdjustScoreOnBookingConfirmed implements EventHandler<BookingConfirmedEvent> {
    private readonly adjustScore: AdjustLeadScoreUseCase;

    constructor(leadRepo: LeadRepository) {
        this.adjustScore = new AdjustLeadScoreUseCase(leadRepo);
    }

    async handle(event: BookingConfirmedEvent): Promise<void> {
        if (!event.leadId) return;
        await this.adjustScore.execute({
            leadId: event.leadId,
            delta: 20,
            eventId: `booking_confirmed:${event.bookingId}`,
            reason: 'Booking confirmado con un asesor',
        });
    }
}

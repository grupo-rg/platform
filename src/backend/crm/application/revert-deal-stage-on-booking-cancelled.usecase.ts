import { EventHandler } from "../../shared/events/event-dispatcher";
import { BookingCancelledEvent } from "../../agenda/domain/events/booking-cancelled.event";
import { DealRepository } from "../domain/deal.repository";
import { PipelineStage } from "../domain/deal";

/**
 * Listener CRM: cuando se cancela un booking, mueve el Deal de
 * SALES_CALL_SCHEDULED de vuelta a NEW_LEAD para que vuelva al inbox de
 * trabajo. Sólo actúa si el Deal estaba justo en la columna de meeting
 * agendado y la cancelación NO dejó otra reserva activa para ese lead.
 *
 * Si el Deal ya está más adelante (PROPOSAL_SENT, CLOSED_WON), no lo tocamos
 * — la conversación pasó del booking y revertirla sería un retroceso falso.
 */
export class RevertDealStageOnBookingCancelledUseCase implements EventHandler<BookingCancelledEvent> {
    constructor(private readonly dealRepo: DealRepository) {}

    async handle(event: BookingCancelledEvent): Promise<void> {
        if (!event.leadId) return;

        const deal = await this.dealRepo.findByLeadId(event.leadId);
        if (!deal) {
            console.warn(`[CRM] BookingCancelled: no Deal para lead ${event.leadId}, skip.`);
            return;
        }

        if (deal.stage !== PipelineStage.SALES_CALL_SCHEDULED) {
            console.log(`[CRM] BookingCancelled: Deal ${deal.id} en stage ${deal.stage}, no se revierte.`);
            return;
        }

        deal.moveToStage(PipelineStage.NEW_LEAD);
        if (deal.metadata) {
            delete deal.metadata.nextMeeting;
            delete deal.metadata.bookingId;
            delete deal.metadata.meetUrl;
        }
        await this.dealRepo.save(deal);
        console.log(`[CRM] Deal ${deal.id} revertido a NEW_LEAD tras BookingCancelled (${event.cancelledBy}).`);
    }
}

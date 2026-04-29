import { EventHandler } from "../../shared/events/event-dispatcher";
import { BookingConfirmedEvent } from "../../agenda/domain/events/booking-confirmed.event";
import { DealRepository } from "../domain/deal.repository";
import { PipelineStage } from "../domain/deal";

/**
 * Listener CRM: Reacciona al agendamiento nativo
 * Responsabilidad: Asegurar que el ticket del cliente en el Kanban salte a la columna correcta.
 */
export class MoveDealStageUseCase implements EventHandler<BookingConfirmedEvent> {
    constructor(private readonly dealRepo: DealRepository) {}

    async handle(event: BookingConfirmedEvent): Promise<void> {
        console.log(`[CRM] Interceptado BookingConfirmedEvent para Lead: ${event.leadId}`);
        if (!event.leadId) return;

        // 1. Obtener la oportunidad activa
        const deal = await this.dealRepo.findByLeadId(event.leadId);
        if (deal) {
            // Mover ficha en el tablero
            deal.moveToStage(PipelineStage.SALES_CALL_SCHEDULED);
            
            // Adjuntar metadata de agenda al deal
            if (!deal.metadata) deal.metadata = {};
            deal.metadata.nextMeeting = event.slotDateTime.toISOString();
            deal.metadata.bookingId = event.bookingId;
            if (event.meetUrl) {
                deal.metadata.meetUrl = event.meetUrl;
            }

            await this.dealRepo.save(deal);
            console.log(`[CRM] Deal \${deal.id} movido a SALES_CALL_SCHEDULED exitosamente y url guardada.`);
        } else {
            console.warn(`[CRM] No se encontró Deal activo para Lead \${event.leadId}. Ignorando Evento.`);
        }
    }
}

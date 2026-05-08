import { EventHandler } from "../../shared/events/event-dispatcher";
import { BookingCancelledEvent } from "../../agenda/domain/events/booking-cancelled.event";
import { EnrollmentRepository } from "../domain/marketing.repository";

/**
 * Listener Marketing: al cancelar un booking, apaga la secuencia de
 * recordatorios operativos (que perdería sentido sin reunión). NO
 * reanuda automáticamente las secuencias de nurturing comercial — eso
 * dependerá de si el lead vuelve a engancharse o si el admin decide
 * forzarlo manualmente.
 */
export class HandleBookingCancelledUseCase implements EventHandler<BookingCancelledEvent> {
    constructor(private readonly enrollmentRepo: EnrollmentRepository) {}

    async handle(event: BookingCancelledEvent): Promise<void> {
        if (!event.leadId) return;

        const enrollments = await this.enrollmentRepo.findByLeadId(event.leadId);
        let cancelledCount = 0;
        for (const enr of enrollments) {
            // Sólo apagamos las secuencias de recordatorios — el resto las
            // dejamos como estaban (estarán cancelled o completed según ciclo).
            if (enr.active && enr.sequenceId === 'seq_booking_reminders') {
                enr.cancel();
                await this.enrollmentRepo.save(enr);
                cancelledCount++;
            }
        }
        if (cancelledCount > 0) {
            console.log(`[Marketing] Canceladas ${cancelledCount} secuencias de reminders por BookingCancelled (lead ${event.leadId}).`);
        }
    }
}

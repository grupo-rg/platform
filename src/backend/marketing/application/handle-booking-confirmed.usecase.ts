import { EventHandler } from "../../shared/events/event-dispatcher";
import { BookingConfirmedEvent } from "../../agenda/domain/events/booking-confirmed.event";
import { EnrollmentRepository } from "../domain/marketing.repository";
import { EnrollLeadInSequenceUseCase } from "./enroll-lead-in-sequence.usecase";

/**
 * Listener Marketing: Interviene cuando ocurre la conversión (Call Booked)
 * Responsabilidad: Matar el Nurturing comercial y arrancar la Secuencia Operativa (Reminders).
 */
export class HandleBookingConfirmedUseCase implements EventHandler<BookingConfirmedEvent> {
    constructor(
        private readonly enrollmentRepo: EnrollmentRepository,
        private readonly enrollLeadUseCase: EnrollLeadInSequenceUseCase
    ) {}

    async handle(event: BookingConfirmedEvent): Promise<void> {
        console.log(`[Marketing] Reaccionando a BookingConfirmedEvent para Lead: \${event.leadId}`);
        if (!event.leadId) return;
        
        // 1. Frenazo de Emergencia (Kill Switch) para Marketing de Ruido
        const enrollments = await this.enrollmentRepo.findByLeadId(event.leadId);
        
        let nurturingCancelled = false;
        for (const enr of enrollments) {
            // Apagamos cualquier cosa que NO sea de recordatorios,
            // Principalmente las vías A y B de Cold-to-Close
            if (enr.active) {
                enr.cancel();
                await this.enrollmentRepo.save(enr);
                nurturingCancelled = true;
                console.log(`[Marketing] ❌ Cancelando (Sobreescribiendo) la Secuencia \${enr.sequenceId} del Lead \${event.leadId}.`);
            }
        }

        if (!nurturingCancelled) {
            console.log(`[Marketing] El lead no tenía secuencias comerciales activas.`)
        }

        // 2. Cambio de Riel (Subirlo al tren Transaccional de Consultoría)
        try {
            console.log(`[Marketing] 🚆 Inscribiendo Lead \${event.leadId} en vía operativa: seq_booking_reminders...`);
            await this.enrollLeadUseCase.execute(event.leadId, 'seq_booking_reminders', 'A', { meetUrl: event.meetUrl });
            // OJO: Tendremos que manejar en la UseCase la forzaduría al ID de sequence de recordatorios
            // En implementaciones nativas deberíamos exponer sequenceId pasable.
            console.log(`[Marketing] ✅ Inscripción exitosa en los Recordatorios Cronometrados.`);
        } catch(e) {
            console.error(`[Marketing] Error al reinscribir Lead \${event.leadId} en reminders:`, e);
        }
    }
}

'use server';

import { FirestoreBookingRepository } from '@/backend/agenda/infrastructure/firestore-booking-repository';
import { FirestoreAvailabilityRepository } from '@/backend/agenda/infrastructure/firestore-availability-repository';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { CreateBookingUseCase, CancelBookingUseCase } from '@/backend/agenda/application/booking-use-cases';
import { ResendEmailService } from '@/backend/shared/infrastructure/messaging/resend-email.service';

const bookingRepo = new FirestoreBookingRepository();
const availabilityRepo = new FirestoreAvailabilityRepository();
const leadRepo = new FirestoreLeadRepository();

export interface RescheduleBookingParams {
    bookingId: string;
    requesterLeadId?: string;
    actor?: 'lead' | 'admin' | 'system';
    newDate: string;        // YYYY-MM-DD
    newTimeSlot: string;    // HH:MM
}

export interface RescheduleBookingResult {
    success: boolean;
    newBookingId?: string;
    error?: string;
    errorCode?: 'not_found' | 'forbidden' | 'too_late' | 'slot_taken' | 'invalid_input' | 'internal';
    minHours?: number;
}

/**
 * Reagenda una reserva: compone un cancel + create con compensación.
 *
 * Algoritmo (orden importante):
 *   1. Lookup del booking original. Si no existe → not_found.
 *   2. Validar autorización por leadId (si requesterLeadId).
 *   3. Validar antelación mínima del slot ORIGINAL (si actor='lead').
 *      Si no se cumple → too_late con minHours.
 *   4. Crear el nuevo booking. Si el slot está tomado → slot_taken (no
 *      tocamos el viejo, el lead conserva su reserva).
 *   5. Cancelar el booking viejo. Si falla → compensar cancelando el nuevo
 *      (mejor perder ambos que tener doble reserva).
 *   6. Email único de "reagendado" + dispatch de Cancelled+Confirmed para
 *      que CRM/score/marketing converjan al estado correcto sin trabajo
 *      adicional.
 */
export async function rescheduleBookingAction(
    params: RescheduleBookingParams
): Promise<RescheduleBookingResult> {
    const actor = params.actor || 'lead';
    try {
        // 1. Lookup
        const original = await bookingRepo.findById(params.bookingId);
        if (!original) {
            return { success: false, error: 'Reserva no encontrada.', errorCode: 'not_found' };
        }

        // 2. Auth
        if (params.requesterLeadId && original.leadId !== params.requesterLeadId) {
            return { success: false, error: 'No autorizado.', errorCode: 'forbidden' };
        }

        // 3. Antelación mínima sobre el slot ORIGINAL (no el nuevo).
        if (actor === 'lead') {
            const config = await availabilityRepo.getConfig();
            const minHours = config.minCancellationHours ?? 4;
            const [hh, mm] = original.timeSlot.split(':').map(Number);
            const slotDateTime = new Date(original.date);
            slotDateTime.setHours(hh, mm, 0, 0);
            const hoursUntil = (slotDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
            if (hoursUntil < minHours) {
                return {
                    success: false,
                    error: `Para reagendar necesitas avisar con al menos ${minHours}h de antelación.`,
                    errorCode: 'too_late',
                    minHours,
                };
            }
        }

        // 4. Crear nuevo booking PRIMERO (sin tocar el viejo).
        const createUseCase = new CreateBookingUseCase(bookingRepo);
        const createRes = await createUseCase.execute({
            name: original.name,
            email: original.email,
            phone: original.phone,
            date: new Date(params.newDate),
            timeSlot: params.newTimeSlot,
            leadId: original.leadId || undefined,
        });

        if (!createRes.success || !createRes.bookingId) {
            // Si el slot está ocupado o la fecha/hora son inválidas, devolvemos
            // el error sin tocar el viejo — el lead conserva su reserva.
            const isSlotTaken = (createRes.error || '').includes('reservado');
            return {
                success: false,
                error: createRes.error || 'No se pudo crear la nueva reserva.',
                errorCode: isSlotTaken ? 'slot_taken' : 'invalid_input',
            };
        }

        // 5. Cancelar el viejo. Skipeamos validación de antelación porque
        // ya la hicimos arriba — el viejo queda CANCELLED en cualquier caso
        // a partir de aquí.
        const cancelUseCase = new CancelBookingUseCase(bookingRepo, availabilityRepo);
        const cancelRes = await cancelUseCase.execute({
            bookingId: original.id,
            skipMinHoursCheck: true,
        });

        if (!cancelRes.success) {
            // Compensación: cancelamos el nuevo para no dejar al lead con dos
            // reservas. Si esta cancelación también falla, log y devolvemos
            // error — el lead tendrá que llamar al admin.
            console.error('[reschedule] Cancel del viejo falló, compensando con cancel del nuevo:', cancelRes.error);
            try {
                await cancelUseCase.execute({
                    bookingId: createRes.bookingId,
                    skipMinHoursCheck: true,
                });
            } catch (err) {
                console.error('[reschedule] Compensación falló:', err);
            }
            return {
                success: false,
                error: 'Error reagendando. Intenta de nuevo en unos minutos.',
                errorCode: 'internal',
            };
        }

        // 6. Email único de reagendamiento (best-effort).
        try {
            if (original.leadId) {
                const lead = await leadRepo.findById(original.leadId);
                if (lead?.personalInfo.email) {
                    const oldDate = new Date(original.date);
                    const oldDateStr = oldDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
                    const newDateObj = new Date(params.newDate);
                    const newDateStr = newDateObj.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
                    const html = `
                        <div style="font-family: sans-serif; color: #333;">
                            <h2>Hola ${lead.personalInfo.name.split(' ')[0]},</h2>
                            <p>Hemos reagendado tu sesión.</p>
                            <ul>
                                <li><strong>Antes:</strong> ${oldDateStr} a las ${original.timeSlot}</li>
                                <li><strong>Ahora:</strong> ${newDateStr} a las ${params.newTimeSlot}</li>
                            </ul>
                            <p>En breve recibirás una invitación de calendario actualizada.</p>
                            <br/>
                            <p>Un saludo,<br/><strong>Equipo Grupo RG</strong></p>
                        </div>
                    `;
                    await ResendEmailService.send({
                        to: lead.personalInfo.email,
                        subject: 'Tu sesión ha sido reagendada · Grupo RG',
                        html,
                        tags: [
                            { name: 'category', value: 'booking_rescheduled' },
                            { name: 'lead_id', value: lead.id },
                        ],
                    });
                }
            }
        } catch (err) {
            console.error('[reschedule] email reschedule falló (no crítico):', err);
        }

        // 7. Dispatch de eventos: Cancelled (viejo) + Confirmed (nuevo). El
        // listener de score es idempotente por eventId, y el de CRM verá que
        // hay un nuevo booking y dejará el Deal en SALES_CALL_SCHEDULED.
        try {
            const { EventDispatcher } = await import('@/backend/shared/events/event-dispatcher');
            const { BookingCancelledEvent } = await import('@/backend/agenda/domain/events/booking-cancelled.event');
            const { BookingConfirmedEvent } = await import('@/backend/agenda/domain/events/booking-confirmed.event');
            const { registerEventListeners } = await import('@/backend/shared/events/register-listeners');
            registerEventListeners();

            const dispatcher = EventDispatcher.getInstance();

            const [oldHh, oldMm] = original.timeSlot.split(':').map(Number);
            const oldSlotDate = new Date(original.date);
            oldSlotDate.setHours(oldHh, oldMm, 0, 0);
            await dispatcher.dispatch(
                new BookingCancelledEvent(original.id, original.leadId, oldSlotDate, actor)
            );

            const newSlotDate = new Date(`${params.newDate}T${params.newTimeSlot}:00`);
            await dispatcher.dispatch(
                new BookingConfirmedEvent(createRes.bookingId, original.leadId, newSlotDate)
            );
        } catch (err) {
            console.error('[reschedule] dispatch eventos falló:', err);
        }

        return { success: true, newBookingId: createRes.bookingId };
    } catch (error: any) {
        console.error('rescheduleBookingAction Error:', error);
        return { success: false, error: error?.message || 'Error reagendando', errorCode: 'internal' };
    }
}

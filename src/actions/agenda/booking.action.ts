'use server';

import { FirestoreBookingRepository } from '@/backend/agenda/infrastructure/firestore-booking-repository';
import { CreateBookingUseCase, GetAvailabilityUseCase, CancelBookingUseCase } from '@/backend/agenda/application/booking-use-cases';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { FirestoreAvailabilityRepository } from '@/backend/agenda/infrastructure/firestore-availability-repository';
import { ResendEmailService } from '@/backend/shared/infrastructure/messaging/resend-email.service';

const bookingRepo = new FirestoreBookingRepository();
const leadRepo = new FirestoreLeadRepository();
const availabilityRepo = new FirestoreAvailabilityRepository();

/**
 * Get available time slots for a date range
 */
export async function getAvailableSlotsAction(
    startDate: string,
    endDate: string
): Promise<Record<string, { startTime: string; endTime: string; isAvailable: boolean }[]>> {
    const useCase = new GetAvailabilityUseCase(bookingRepo, availabilityRepo);
    const result = await useCase.execute({
        startDate: new Date(startDate),
        endDate: new Date(endDate)
    });

    const serialized: Record<string, { startTime: string; endTime: string; isAvailable: boolean }[]> = {};
    for (const [dateKey, slots] of Object.entries(result)) {
        serialized[dateKey] = slots.map(s => ({
            startTime: s.startTime,
            endTime: s.endTime,
            isAvailable: s.isAvailable
        }));
    }
    return serialized;
}

/**
 * Create a new booking
 */
export async function createBookingAction(params: {
    name: string;
    email: string;
    phone: string | null;
    date: string;
    timeSlot: string;
}): Promise<{ success: boolean; bookingId?: string; error?: string }> {
    const useCase = new CreateBookingUseCase(bookingRepo);
    return useCase.execute({
        ...params,
        date: new Date(params.date)
    });
}

/**
 * Cancel a booking. Acepta `requesterLeadId` para autorizar self-service del
 * chat público (sólo permite cancelar bookings propios) y `actor` para
 * decidir si se aplica la validación de antelación mínima — los admins
 * pueden cancelar fuera de plazo, los leads no.
 *
 * Side effects al cancelar OK:
 *   - Email al lead.
 *   - Despacho de BookingCancelledEvent (CRM revierte stage, score baja si
 *     cancelledBy='lead', marketing apaga reminders).
 */
export async function cancelBookingAction(
    bookingIdOrParams: string | {
        bookingId: string;
        requesterLeadId?: string;
        actor?: 'lead' | 'admin' | 'system';
    }
): Promise<{
    success: boolean;
    error?: string;
    errorCode?: 'not_found' | 'forbidden' | 'too_late' | 'already_cancelled' | 'internal';
    minHours?: number;
}> {
    const params = typeof bookingIdOrParams === 'string'
        ? { bookingId: bookingIdOrParams, actor: 'admin' as const }
        : { ...bookingIdOrParams, actor: bookingIdOrParams.actor || 'lead' as const };

    const useCase = new CancelBookingUseCase(bookingRepo, availabilityRepo);
    const result = await useCase.execute({
        bookingId: params.bookingId,
        requesterLeadId: params.requesterLeadId,
        skipMinHoursCheck: params.actor === 'admin',
    });

    if (!result.success) {
        return {
            success: false,
            error: result.error,
            errorCode: result.errorCode,
            minHours: result.minHours,
        };
    }

    // Email + evento (best-effort, no bloquean la respuesta de éxito).
    try {
        if (result.leadId) {
            const lead = await leadRepo.findById(result.leadId);
            if (lead?.personalInfo.email) {
                const dateStr = result.slotDateTime.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
                const timeStr = result.slotDateTime.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
                const html = `
                    <div style="font-family: sans-serif; color: #333;">
                        <h2>Hola ${lead.personalInfo.name.split(' ')[0]},</h2>
                        <p>Confirmamos la <strong>cancelación</strong> de tu sesión prevista para el <strong>${dateStr}</strong> a las <strong>${timeStr}</strong>.</p>
                        <p>Si quieres reagendar, vuelve al chat o contáctanos directamente.</p>
                        <br/>
                        <p>Un saludo,<br/><strong>Equipo Grupo RG</strong></p>
                    </div>
                `;
                await ResendEmailService.send({
                    to: lead.personalInfo.email,
                    subject: 'Cancelación de tu sesión · Grupo RG',
                    html,
                    tags: [
                        { name: 'category', value: 'booking_cancellation' },
                        { name: 'lead_id', value: lead.id },
                    ],
                });
            }
        }
    } catch (err) {
        console.error('[cancelBookingAction] email cancelación falló (no crítico):', err);
    }

    try {
        const { EventDispatcher } = await import('@/backend/shared/events/event-dispatcher');
        const { BookingCancelledEvent } = await import('@/backend/agenda/domain/events/booking-cancelled.event');
        const { registerEventListeners } = await import('@/backend/shared/events/register-listeners');
        registerEventListeners();
        await EventDispatcher.getInstance().dispatch(
            new BookingCancelledEvent(result.bookingId, result.leadId, result.slotDateTime, params.actor)
        );
    } catch (err) {
        console.error('[cancelBookingAction] dispatch BookingCancelledEvent falló:', err);
    }

    return { success: true };
}

/**
 * Create a new booking directly from a Lead ID
 */
export async function createBookingFromLeadAction(params: {
    leadId: string;
    date: string;
    timeSlot: string;
}): Promise<{ success: boolean; bookingId?: string; error?: string }> {
    const lead = await leadRepo.findById(params.leadId);
    if (!lead) return { success: false, error: 'Lead no encontrado' };

    const useCase = new CreateBookingUseCase(bookingRepo);
    const result = await useCase.execute({
        name: lead.personalInfo.name,
        email: lead.personalInfo.email,
        phone: lead.personalInfo.phone,
        leadId: lead.id,
        date: new Date(params.date),
        timeSlot: params.timeSlot
    });

    // Enviar email de confirmación si la reserva fue exitosa
    if (result.success && lead.personalInfo.email) {
        const html = `
            <div style="font-family: sans-serif; color: #333;">
                <h2>Hola ${lead.personalInfo.name.split(' ')[0]},</h2>
                <p>Tu sesión ha sido confirmada para el <strong>${params.date}</strong> a las <strong>${params.timeSlot}</strong>.</p>
                <p>En breve recibirás una invitación de calendario con el enlace a la videollamada.</p>
                <br/>
                <p>¿Qué veremos en la sesión?</p>
                <ul>
                    <li>Revisión detallada del proyecto que nos has compartido.</li>
                    <li>Resolución de dudas y siguientes pasos.</li>
                    <li>Hoja de ruta y propuesta de presupuesto.</li>
                </ul>
                <br/>
                <p>Un saludo,<br/><strong>Equipo Grupo RG</strong></p>
            </div>
        `;

        await ResendEmailService.send({
            to: lead.personalInfo.email,
            subject: 'Confirmación de tu sesión · Grupo RG',
            html,
            tags: [
                { name: 'category', value: 'booking_confirmation' },
                { name: 'lead_id', value: lead.id },
            ],
        });
    }

    // Despachar BookingConfirmedEvent para side-effects de CRM y Marketing
    if (result.success && (result as any).bookingId) {
        try {
            const { EventDispatcher } = await import('@/backend/shared/events/event-dispatcher');
            const { BookingConfirmedEvent } = await import('@/backend/agenda/domain/events/booking-confirmed.event');
            const { registerEventListeners } = await import('@/backend/shared/events/register-listeners');
            registerEventListeners(); // idempotente — protege cuando instrumentation.ts no hubiese corrido

            const slotDateTime = new Date(`${params.date}T${params.timeSlot}:00`);
            await EventDispatcher.getInstance().dispatch(
                new BookingConfirmedEvent((result as any).bookingId, lead.id, slotDateTime)
            );
        } catch (e) {
            console.error('[Agenda] Failed to dispatch BookingConfirmedEvent', e);
        }
    }

    return result;
}

/**
 * Get bookings for the admin calendar
 */
export async function getAdminBookingsAction(startDate: string, endDate: string): Promise<any[]> {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const bookings = await bookingRepo.findByDateRange(start, end);

    // Serialize for the client
    return bookings.map(b => ({
        id: b.id,
        leadId: b.leadId,
        name: b.name,
        email: b.email,
        phone: b.phone,
        date: b.date.toISOString(),
        timeSlot: b.timeSlot,
        status: b.status,
    }));
}

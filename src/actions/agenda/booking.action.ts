'use server';

import { FirestoreBookingRepository } from '@/backend/agenda/infrastructure/firestore-booking-repository';
import { CreateBookingUseCase, GetAvailabilityUseCase } from '@/backend/agenda/application/booking-use-cases';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { FirestoreAvailabilityRepository } from '@/backend/agenda/infrastructure/firestore-availability-repository';
import { ResendEmailService } from '@/backend/shared/infrastructure/messaging/resend-email.service';
import { verifyAuth } from '@/backend/auth/auth.middleware';
import { getLeadSession } from '@/backend/lead/infrastructure/lead-session';
import { cancelBookingWithSideEffects, type CancelErrorCode } from '@/backend/agenda/application/lead-booking-self-service';
import { escapeHtml } from '@/backend/shared/security/html-escape';
import { checkRateLimit, RATE_LIMITS } from '@/backend/shared/security/rate-limiter';
import { getClientIp } from '@/backend/shared/security/client-identity';

const bookingRepo = new FirestoreBookingRepository();
const leadRepo = new FirestoreLeadRepository();
const availabilityRepo = new FirestoreAvailabilityRepository();

type CancelResult = {
    success: boolean;
    error?: string;
    errorCode?: CancelErrorCode;
    minHours?: number;
};

/**
 * Get available time slots for a date range (público: sólo disponibilidad,
 * sin datos personales).
 */
export async function getAvailableSlotsAction(
    startDate: string,
    endDate: string
): Promise<Record<string, { startTime: string; endTime: string; isAvailable: boolean }[]>> {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return {};
    // Acotamos el rango para evitar consultas masivas (máx. 62 días).
    const maxEnd = new Date(start.getTime() + 62 * 24 * 60 * 60 * 1000);
    const useCase = new GetAvailabilityUseCase(bookingRepo, availabilityRepo);
    const result = await useCase.execute({ startDate: start, endDate: end > maxEnd ? maxEnd : end });

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
 * Create a new booking con datos arbitrarios. ADMIN: un visitante no puede
 * crear reservas a nombre de terceros (el flujo público usa
 * `confirmBookingFromChatAction`, que toma el lead de la cookie firmada).
 */
export async function createBookingAction(params: {
    name: string;
    email: string;
    phone: string | null;
    date: string;
    timeSlot: string;
}): Promise<{ success: boolean; bookingId?: string; error?: string }> {
    const auth = await verifyAuth(true);
    if (!auth) return { success: false, error: 'No autorizado' };
    const useCase = new CreateBookingUseCase(bookingRepo);
    return useCase.execute({
        ...params,
        date: new Date(params.date)
    });
}

/**
 * Cancelación SELF-SERVICE del lead (chat público).
 *
 * El lead se toma de la cookie firmada `rg_lead_session`; `actor` es siempre
 * 'lead' (antes lo decidía el cliente y la llamada con string actuaba como
 * admin, saltándose el plazo mínimo). Se respeta `minCancellationHours`.
 *
 * Se aceptan las firmas antiguas (string u objeto) pero cualquier
 * `requesterLeadId` / `actor` enviado por el cliente se ignora.
 */
export async function cancelBookingAction(
    bookingIdOrParams: string | { bookingId: string; requesterLeadId?: string; actor?: string }
): Promise<CancelResult> {
    const bookingId = typeof bookingIdOrParams === 'string' ? bookingIdOrParams : bookingIdOrParams?.bookingId;
    const session = await getLeadSession();
    if (!session) {
        return { success: false, error: 'Necesitas verificar tu email para gestionar tus reservas.', errorCode: 'forbidden' };
    }
    const rl = await checkRateLimit('publicBookingAction', await getClientIp(), RATE_LIMITS.publicBookingAction);
    if (!rl.allowed) {
        return { success: false, error: 'Demasiadas operaciones de agenda. Inténtalo más tarde.', errorCode: 'internal' };
    }
    return cancelBookingWithSideEffects({
        bookingId: String(bookingId || ''),
        actor: 'lead',
        requesterLeadId: session.leadId,
    });
}

/** Cancelación desde el dashboard: admin, sin plazo mínimo. */
export async function cancelBookingAsAdminAction(bookingId: string): Promise<CancelResult> {
    const auth = await verifyAuth(true);
    if (!auth) return { success: false, error: 'No autorizado', errorCode: 'forbidden' };
    return cancelBookingWithSideEffects({ bookingId: String(bookingId || ''), actor: 'admin' });
}

/**
 * Create a new booking directly from a Lead ID. ADMIN (dashboard).
 */
export async function createBookingFromLeadAction(params: {
    leadId: string;
    date: string;
    timeSlot: string;
}): Promise<{ success: boolean; bookingId?: string; error?: string }> {
    const auth = await verifyAuth(true);
    if (!auth) return { success: false, error: 'No autorizado' };

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
                <h2>Hola ${escapeHtml(lead.personalInfo.name.split(' ')[0])},</h2>
                <p>Tu sesión ha sido confirmada para el <strong>${escapeHtml(params.date)}</strong> a las <strong>${escapeHtml(params.timeSlot)}</strong>.</p>
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
 * Get bookings for the admin calendar. ADMIN: devuelve nombre/email/teléfono.
 */
export async function getAdminBookingsAction(startDate: string, endDate: string): Promise<any[]> {
    const auth = await verifyAuth(true);
    if (!auth) return [];

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

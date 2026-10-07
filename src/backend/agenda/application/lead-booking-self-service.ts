import 'server-only';
import { FirestoreBookingRepository } from '@/backend/agenda/infrastructure/firestore-booking-repository';
import { FirestoreAvailabilityRepository } from '@/backend/agenda/infrastructure/firestore-availability-repository';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { CreateBookingUseCase, CancelBookingUseCase } from '@/backend/agenda/application/booking-use-cases';
import { ResendEmailService } from '@/backend/shared/infrastructure/messaging/resend-email.service';
import { escapeHtml } from '@/backend/shared/security/html-escape';
import type { BookingStatus } from '@/backend/agenda/domain/booking';

/**
 * Agenda self-service del LEAD (chat público / InlineBookingPicker).
 *
 * Todas las funciones reciben un `leadId` de CONFIANZA: el que la action
 * pública obtuvo de la cookie firmada `rg_lead_session` (o el que el flow del
 * agente público recibió de esa misma action). Nunca se debe pasar aquí un
 * leadId que venga del navegador.
 *
 * Las server actions públicas (`src/actions/agenda/*`) y las tools del agente
 * comercial llaman a este módulo; las variantes admin viven en las actions
 * con `verifyAuth(true)`.
 */

export interface MyBookingDTO {
    id: string;
    /** ISO "YYYY-MM-DD" */
    date: string;
    /** "HH:MM" */
    timeSlot: string;
    status: BookingStatus;
    /** Texto amigable: "Mar 12 may, 16:00" */
    label: string;
    meetUrl?: string;
}

export type CancelErrorCode = 'not_found' | 'forbidden' | 'too_late' | 'already_cancelled' | 'internal';
export type RescheduleErrorCode = 'not_found' | 'forbidden' | 'too_late' | 'slot_taken' | 'invalid_input' | 'internal';

const SPANISH_DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const SPANISH_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function buildLabel(date: Date, timeSlot: string): string {
    return `${SPANISH_DAYS[date.getDay()]} ${date.getDate()} ${SPANISH_MONTHS[date.getMonth()]}, ${timeSlot}`;
}

function toDateKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function firstName(name: string | undefined): string {
    return escapeHtml((name || '').split(' ')[0] || '');
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

// ── Listado ────────────────────────────────────────────────────────────────

export async function listLeadBookings(
    leadId: string,
    opts: { includePast?: boolean; includeCancelled?: boolean } = {}
): Promise<{ success: boolean; bookings?: MyBookingDTO[]; error?: string }> {
    if (!leadId) return { success: false, error: 'Sesión de lead requerida' };
    try {
        const repo = new FirestoreBookingRepository();
        const all = await repo.findByLeadId(leadId);
        const now = new Date();
        const filtered = all.filter(b => {
            if (!opts.includeCancelled && b.status === 'CANCELLED') return false;
            if (!opts.includePast) {
                const [hours, minutes] = b.timeSlot.split(':').map(Number);
                const slotDateTime = new Date(b.date);
                slotDateTime.setHours(hours, minutes, 0, 0);
                if (slotDateTime < now) return false;
            }
            return true;
        });
        filtered.sort((a, b) => {
            const da = new Date(a.date).getTime();
            const db = new Date(b.date).getTime();
            if (da !== db) return da - db;
            return a.timeSlot.localeCompare(b.timeSlot);
        });
        return {
            success: true,
            bookings: filtered.map(b => ({
                id: b.id,
                date: toDateKey(b.date),
                timeSlot: b.timeSlot,
                status: b.status,
                label: buildLabel(b.date, b.timeSlot),
                meetUrl: b.meetUrl,
            })),
        };
    } catch (error: any) {
        console.error('[lead-booking] listLeadBookings error:', error);
        return { success: false, error: 'Error consultando reservas' };
    }
}

// ── Confirmar ──────────────────────────────────────────────────────────────

export async function confirmLeadBooking(params: {
    leadId: string;
    date: string;
    timeSlot: string;
    source?: string;
}): Promise<{ success: boolean; bookingId?: string; error?: string }> {
    if (!params.leadId) return { success: false, error: 'Sesión de lead requerida' };
    if (!DATE_RE.test(params.date || '') || !TIME_RE.test(params.timeSlot || '')) {
        return { success: false, error: 'Fecha u hora inválidas' };
    }
    try {
        const lead = await new FirestoreLeadRepository().findById(params.leadId);
        if (!lead) return { success: false, error: 'Lead no encontrado' };

        const result = await new CreateBookingUseCase(new FirestoreBookingRepository()).execute({
            name: lead.personalInfo.name,
            email: lead.personalInfo.email,
            phone: lead.personalInfo.phone || null,
            date: new Date(params.date),
            timeSlot: params.timeSlot,
            leadId: lead.id,
        });
        if (!result.success || !result.bookingId) {
            return { success: false, error: result.error || 'No se pudo crear la reserva' };
        }

        try {
            const html = `
                <div style="font-family: sans-serif; color: #333;">
                    <h2>Hola ${firstName(lead.personalInfo.name)},</h2>
                    <p>Tu sesión con Grupo RG está confirmada para el <strong>${escapeHtml(params.date)}</strong> a las <strong>${escapeHtml(params.timeSlot)}</strong>.</p>
                    <p>En breve recibirás una invitación de calendario con el enlace a la videollamada.</p>
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
                    { name: 'source', value: params.source || 'chat_public' },
                ],
            });
        } catch (err) {
            console.error('[lead-booking] email confirmación falló (no crítico):', err);
        }

        try {
            const { EventDispatcher } = await import('@/backend/shared/events/event-dispatcher');
            const { BookingConfirmedEvent } = await import('@/backend/agenda/domain/events/booking-confirmed.event');
            const { registerEventListeners } = await import('@/backend/shared/events/register-listeners');
            registerEventListeners();
            const slotDateTime = new Date(`${params.date}T${params.timeSlot}:00`);
            await EventDispatcher.getInstance().dispatch(
                new BookingConfirmedEvent(result.bookingId, lead.id, slotDateTime)
            );
        } catch (err) {
            console.error('[lead-booking] dispatch BookingConfirmedEvent falló:', err);
        }

        return { success: true, bookingId: result.bookingId };
    } catch (error: any) {
        console.error('[lead-booking] confirmLeadBooking error:', error);
        return { success: false, error: 'Error confirmando la reserva' };
    }
}

// ── Cancelar ───────────────────────────────────────────────────────────────

/**
 * Cancela una reserva.
 *  - actor='lead'  → exige `requesterLeadId` (propiedad) y respeta el plazo
 *                    mínimo de antelación.
 *  - actor='admin' → sólo debe usarse desde actions con `verifyAuth(true)`.
 */
export async function cancelBookingWithSideEffects(params: {
    bookingId: string;
    actor: 'lead' | 'admin';
    requesterLeadId?: string;
}): Promise<{ success: boolean; error?: string; errorCode?: CancelErrorCode; minHours?: number }> {
    if (params.actor === 'lead' && !params.requesterLeadId) {
        return { success: false, error: 'No autorizado.', errorCode: 'forbidden' };
    }
    if (!params.bookingId) return { success: false, error: 'Reserva no encontrada.', errorCode: 'not_found' };

    const bookingRepo = new FirestoreBookingRepository();
    const availabilityRepo = new FirestoreAvailabilityRepository();
    const result = await new CancelBookingUseCase(bookingRepo, availabilityRepo).execute({
        bookingId: params.bookingId,
        requesterLeadId: params.actor === 'lead' ? params.requesterLeadId : undefined,
        skipMinHoursCheck: params.actor === 'admin',
    });

    if (!result.success) {
        return { success: false, error: result.error, errorCode: result.errorCode, minHours: result.minHours };
    }

    try {
        if (result.leadId) {
            const lead = await new FirestoreLeadRepository().findById(result.leadId);
            if (lead?.personalInfo.email) {
                const dateStr = result.slotDateTime.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
                const timeStr = result.slotDateTime.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
                const html = `
                    <div style="font-family: sans-serif; color: #333;">
                        <h2>Hola ${firstName(lead.personalInfo.name)},</h2>
                        <p>Confirmamos la <strong>cancelación</strong> de tu sesión prevista para el <strong>${escapeHtml(dateStr)}</strong> a las <strong>${escapeHtml(timeStr)}</strong>.</p>
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
        console.error('[lead-booking] email cancelación falló (no crítico):', err);
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
        console.error('[lead-booking] dispatch BookingCancelledEvent falló:', err);
    }

    return { success: true };
}

// ── Reagendar ──────────────────────────────────────────────────────────────

/**
 * Reagenda una reserva: compone un cancel + create con compensación.
 *
 *   1. Lookup del booking original (not_found).
 *   2. Propiedad: actor='lead' exige booking.leadId === requesterLeadId.
 *   3. Antelación mínima del slot ORIGINAL (si actor='lead').
 *   4. Crear el nuevo booking (si el slot está tomado → slot_taken, el viejo
 *      se conserva).
 *   5. Cancelar el viejo; si falla, compensar cancelando el nuevo.
 *   6. Email único + eventos Cancelled + Confirmed.
 */
export async function rescheduleBookingWithSideEffects(params: {
    bookingId: string;
    actor: 'lead' | 'admin';
    requesterLeadId?: string;
    newDate: string;
    newTimeSlot: string;
}): Promise<{ success: boolean; newBookingId?: string; error?: string; errorCode?: RescheduleErrorCode; minHours?: number }> {
    const actor = params.actor;
    if (actor === 'lead' && !params.requesterLeadId) {
        return { success: false, error: 'No autorizado.', errorCode: 'forbidden' };
    }
    if (!DATE_RE.test(params.newDate || '') || !TIME_RE.test(params.newTimeSlot || '')) {
        return { success: false, error: 'Fecha u hora inválidas.', errorCode: 'invalid_input' };
    }

    const bookingRepo = new FirestoreBookingRepository();
    const availabilityRepo = new FirestoreAvailabilityRepository();
    const leadRepo = new FirestoreLeadRepository();

    try {
        const original = await bookingRepo.findById(params.bookingId);
        if (!original) {
            return { success: false, error: 'Reserva no encontrada.', errorCode: 'not_found' };
        }
        if (actor === 'lead' && original.leadId !== params.requesterLeadId) {
            return { success: false, error: 'No autorizado.', errorCode: 'forbidden' };
        }

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
            const isSlotTaken = (createRes.error || '').includes('reservado');
            return {
                success: false,
                error: createRes.error || 'No se pudo crear la nueva reserva.',
                errorCode: isSlotTaken ? 'slot_taken' : 'invalid_input',
            };
        }

        const cancelUseCase = new CancelBookingUseCase(bookingRepo, availabilityRepo);
        const cancelRes = await cancelUseCase.execute({ bookingId: original.id, skipMinHoursCheck: true });
        if (!cancelRes.success) {
            console.error('[reschedule] Cancel del viejo falló, compensando con cancel del nuevo:', cancelRes.error);
            try {
                await cancelUseCase.execute({ bookingId: createRes.bookingId, skipMinHoursCheck: true });
            } catch (err) {
                console.error('[reschedule] Compensación falló:', err);
            }
            return { success: false, error: 'Error reagendando. Intenta de nuevo en unos minutos.', errorCode: 'internal' };
        }

        try {
            if (original.leadId) {
                const lead = await leadRepo.findById(original.leadId);
                if (lead?.personalInfo.email) {
                    const oldDateStr = new Date(original.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
                    const newDateStr = new Date(params.newDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
                    const html = `
                        <div style="font-family: sans-serif; color: #333;">
                            <h2>Hola ${firstName(lead.personalInfo.name)},</h2>
                            <p>Hemos reagendado tu sesión.</p>
                            <ul>
                                <li><strong>Antes:</strong> ${escapeHtml(oldDateStr)} a las ${escapeHtml(original.timeSlot)}</li>
                                <li><strong>Ahora:</strong> ${escapeHtml(newDateStr)} a las ${escapeHtml(params.newTimeSlot)}</li>
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
            await dispatcher.dispatch(new BookingCancelledEvent(original.id, original.leadId, oldSlotDate, actor));
            const newSlotDate = new Date(`${params.newDate}T${params.newTimeSlot}:00`);
            await dispatcher.dispatch(new BookingConfirmedEvent(createRes.bookingId, original.leadId, newSlotDate));
        } catch (err) {
            console.error('[reschedule] dispatch eventos falló:', err);
        }

        return { success: true, newBookingId: createRes.bookingId };
    } catch (error: any) {
        console.error('rescheduleBookingWithSideEffects Error:', error);
        return { success: false, error: 'Error reagendando', errorCode: 'internal' };
    }
}

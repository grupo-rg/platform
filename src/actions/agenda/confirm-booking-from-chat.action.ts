'use server';

import { FirestoreBookingRepository } from '@/backend/agenda/infrastructure/firestore-booking-repository';
import { FirestoreLeadRepository } from '@/backend/lead/infrastructure/firestore-lead-repository';
import { CreateBookingUseCase } from '@/backend/agenda/application/booking-use-cases';
import { ResendEmailService } from '@/backend/shared/infrastructure/messaging/resend-email.service';

/**
 * Action que confirma un booking iniciado desde el chat público (InlineBookingPicker).
 * Recibe leadId + slot. Resuelve los datos personales del lead y crea el booking.
 *
 * Side-effects:
 *  - Despacha BookingConfirmedEvent → mueve Deal a SALES_CALL_SCHEDULED.
 *  - Envía email al lead con confirmación.
 */
export async function confirmBookingFromChatAction(params: {
    leadId: string;
    date: string;       // "YYYY-MM-DD"
    timeSlot: string;   // "HH:MM"
}): Promise<{ success: boolean; bookingId?: string; error?: string }> {
    try {
        const leadRepo = new FirestoreLeadRepository();
        const lead = await leadRepo.findById(params.leadId);
        if (!lead) {
            return { success: false, error: 'Lead no encontrado' };
        }

        const bookingRepo = new FirestoreBookingRepository();
        const useCase = new CreateBookingUseCase(bookingRepo);
        const result = await useCase.execute({
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

        // Email de confirmación al lead.
        try {
            const html = `
                <div style="font-family: sans-serif; color: #333;">
                    <h2>Hola ${lead.personalInfo.name.split(' ')[0]},</h2>
                    <p>Tu sesión con Grupo RG está confirmada para el <strong>${params.date}</strong> a las <strong>${params.timeSlot}</strong>.</p>
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
                    { name: 'source', value: 'chat_public' },
                ],
            });
        } catch (err) {
            console.error('[confirmBookingFromChatAction] email confirmación falló (no crítico):', err);
        }

        // Despachar BookingConfirmedEvent para CRM + marketing.
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
            console.error('[confirmBookingFromChatAction] dispatch BookingConfirmedEvent falló:', err);
        }

        return { success: true, bookingId: result.bookingId };
    } catch (error: any) {
        console.error('confirmBookingFromChatAction Error:', error);
        return { success: false, error: error?.message || 'Error confirmando la reserva' };
    }
}

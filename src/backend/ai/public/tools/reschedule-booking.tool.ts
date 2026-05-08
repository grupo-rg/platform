import { ai } from '@/backend/ai/core/config/genkit.config';
import { z } from 'zod';
import { rescheduleBookingAction } from '@/actions/agenda/reschedule-booking.action';

interface AgendaToolContext {
    leadId?: string;
}

const InputSchema = z.object({
    bookingId: z.string().min(1).describe(
        'ID de la reserva a mover. Sácalo del contexto de reservas activas o de getMyBookings — NUNCA lo inventes.'
    ),
    newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe(
        'Nueva fecha en formato YYYY-MM-DD. Convierte fechas relativas antes de llamar.'
    ),
    newTimeSlot: z.string().regex(/^\d{2}:\d{2}$/).describe(
        'Nueva hora de inicio en formato HH:MM (24h). Debe venir de listAvailableSlots.'
    ),
});

const OutputSchema = z.object({
    success: z.boolean(),
    newBookingId: z.string().optional(),
    error: z.string().optional(),
    errorCode: z.enum(['not_found', 'forbidden', 'too_late', 'slot_taken', 'invalid_input', 'internal']).optional(),
    minHours: z.number().optional(),
});

/**
 * Reagenda una reserva existente. Internamente compone un cancel + create
 * con compensación: si crear el nuevo falla, el viejo se mantiene; si
 * cancelar el viejo falla tras crear el nuevo, se cancela el nuevo para
 * no dejar al lead con doble reserva.
 */
export const rescheduleBookingTool = ai.defineTool(
    {
        name: 'rescheduleBooking',
        description:
            'Cambia la fecha/hora de una reserva del visitante. Si hay varias reservas activas y no está claro cuál mover, ' +
            'PREGUNTA al visitante antes de llamar. Si la tool devuelve errorCode="too_late", explica el plazo mínimo. ' +
            'Si devuelve "slot_taken", ofrece otras horas con listAvailableSlots.',
        inputSchema: InputSchema,
        outputSchema: OutputSchema,
    },
    async (input, toolContext) => {
        const ctx = (toolContext?.context || {}) as AgendaToolContext;
        if (!ctx.leadId) {
            return {
                success: false,
                error: 'Sólo puedo reagendar reservas de visitantes autenticados.',
                errorCode: 'forbidden' as const,
            };
        }

        return rescheduleBookingAction({
            bookingId: input.bookingId,
            requesterLeadId: ctx.leadId,
            actor: 'lead',
            newDate: input.newDate,
            newTimeSlot: input.newTimeSlot,
        });
    }
);

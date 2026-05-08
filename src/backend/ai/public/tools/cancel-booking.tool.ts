import { ai } from '@/backend/ai/core/config/genkit.config';
import { z } from 'zod';
import { cancelBookingAction } from '@/actions/agenda/booking.action';

interface AgendaToolContext {
    leadId?: string;
}

const InputSchema = z.object({
    bookingId: z.string().min(1).describe(
        'ID de la reserva a cancelar. Sácalo siempre del contexto de reservas activas o de getMyBookings — NUNCA lo inventes.'
    ),
});

const OutputSchema = z.object({
    success: z.boolean(),
    error: z.string().optional(),
    /** 'too_late' indica que se rebasó el límite de antelación. */
    errorCode: z.enum(['not_found', 'forbidden', 'too_late', 'already_cancelled', 'internal']).optional(),
    /** Plazo mínimo en horas (sólo presente si errorCode='too_late'). */
    minHours: z.number().optional(),
});

/**
 * Cancela una reserva del visitante autenticado. La autorización por
 * `leadId` se hace dentro de la action — sólo se permite cancelar bookings
 * cuyo `leadId` coincida con el del context.
 */
export const cancelBookingTool = ai.defineTool(
    {
        name: 'cancelBooking',
        description:
            'Cancela la reserva indicada. Si hay varias reservas activas y no está claro cuál cancelar, ' +
            'PREGUNTA al visitante antes de llamar. Si la tool devuelve errorCode="too_late", explica al ' +
            'visitante que necesita avisar con al menos `minHours` horas de antelación y sugiere contactar al admin.',
        inputSchema: InputSchema,
        outputSchema: OutputSchema,
    },
    async (input, toolContext) => {
        const ctx = (toolContext?.context || {}) as AgendaToolContext;
        if (!ctx.leadId) {
            return {
                success: false,
                error: 'Sólo puedo cancelar reservas de visitantes autenticados.',
                errorCode: 'forbidden' as const,
            };
        }

        return cancelBookingAction({
            bookingId: input.bookingId,
            requesterLeadId: ctx.leadId,
            actor: 'lead',
        });
    }
);

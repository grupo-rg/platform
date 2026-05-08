import { ai } from '@/backend/ai/core/config/genkit.config';
import { z } from 'zod';
import { confirmBookingFromChatAction } from '@/actions/agenda/confirm-booking-from-chat.action';

interface AgendaToolContext {
    leadId?: string;
}

const InputSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe(
        'Fecha del slot en formato YYYY-MM-DD. Convierte fechas relativas ("el martes") antes de llamar.'
    ),
    timeSlot: z.string().regex(/^\d{2}:\d{2}$/).describe(
        'Hora de inicio del slot en formato HH:MM (24h). Debe ser uno de los slots devueltos por listAvailableSlots.'
    ),
});

const OutputSchema = z.object({
    success: z.boolean(),
    bookingId: z.string().optional(),
    error: z.string().optional(),
});

/**
 * Confirma una reserva por iniciativa explícita del visitante en el chat
 * (sin pulsar el InlineBookingPicker). Sólo activa si hay leadId en el
 * context — el modelo NO puede crear reservas para visitantes anónimos.
 */
export const confirmBookingTool = ai.defineTool(
    {
        name: 'confirmBooking',
        description:
            'Crea una reserva para el visitante autenticado en la fecha y hora especificadas. ' +
            'Úsala SOLO cuando el visitante haya dicho explícitamente la hora que quiere y haya ' +
            'confirmado verbalmente. Si todavía está explorando, llama antes a listAvailableSlots.',
        inputSchema: InputSchema,
        outputSchema: OutputSchema,
    },
    async (input, toolContext) => {
        const ctx = (toolContext?.context || {}) as AgendaToolContext;
        if (!ctx.leadId) {
            return {
                success: false,
                error: 'Sólo puedo crear reservas para visitantes autenticados.',
            };
        }

        const result = await confirmBookingFromChatAction({
            leadId: ctx.leadId,
            date: input.date,
            timeSlot: input.timeSlot,
        });
        return result;
    }
);

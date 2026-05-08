import { ai } from '@/backend/ai/core/config/genkit.config';
import { z } from 'zod';
import { getMyBookingsAction } from '@/actions/agenda/get-my-bookings.action';

interface AgendaToolContext {
    /** El agente NUNCA recibe leadId del modelo — viene del context inyectado. */
    leadId?: string;
}

const InputSchema = z.object({
    includePast: z.boolean().optional().describe(
        'Si true, incluye reservas cuya fecha ya pasó. Por defecto false.'
    ),
    includeCancelled: z.boolean().optional().describe(
        'Si true, incluye reservas canceladas. Por defecto false.'
    ),
});

const OutputSchema = z.object({
    success: z.boolean(),
    bookings: z.array(
        z.object({
            id: z.string(),
            date: z.string(),
            timeSlot: z.string(),
            status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED']),
            label: z.string(),
            meetUrl: z.string().optional(),
        })
    ).optional(),
    error: z.string().optional(),
});

/**
 * Devuelve las reservas del visitante autenticado. Sólo activa cuando el
 * context lleva `leadId` (visitante OTP-verificado o post-handoff).
 *
 * El modelo NO aporta el leadId — se inyecta vía context para evitar que
 * un visitante pueda mirar reservas ajenas alucinando un id.
 */
export const getMyBookingsTool = ai.defineTool(
    {
        name: 'getMyBookings',
        description:
            'Devuelve la lista de reservas del visitante autenticado, ordenadas por fecha. ' +
            'Por defecto sólo activas y futuras. Llama a esta tool cuando el visitante ' +
            'pregunte por sus citas, quiera cancelar/reagendar y necesites desambiguar ' +
            'cuál de varias, o quiera ver el historial.',
        inputSchema: InputSchema,
        outputSchema: OutputSchema,
    },
    async (input, toolContext) => {
        const ctx = (toolContext?.context || {}) as AgendaToolContext;
        if (!ctx.leadId) {
            return {
                success: false,
                error: 'Sólo puedo consultar reservas de visitantes autenticados. Pide al usuario que verifique su identidad primero.',
            };
        }
        return getMyBookingsAction(ctx.leadId, {
            includePast: input.includePast,
            includeCancelled: input.includeCancelled,
        });
    }
);

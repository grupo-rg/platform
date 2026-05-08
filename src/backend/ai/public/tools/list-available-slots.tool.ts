import { ai } from '@/backend/ai/core/config/genkit.config';
import { z } from 'zod';
import { getNextAvailableSlotsAction } from '@/actions/agenda/get-next-slots.action';

interface SlotsToolContext {
    /** Sink mutable: la tool deja los slots aquí para que el flow los exponga al frontend. */
    slotsSink?: { slots?: Array<{ date: string; startTime: string; endTime: string; label: string }> };
}

const InputSchema = z.object({
    daysAhead: z.number().int().min(1).max(60).optional().describe(
        'Cuántos días desde hoy explorar (default 14, máximo 60).'
    ),
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe(
        'Fecha de inicio en formato YYYY-MM-DD. OMITIR para usar hoy.'
    ),
    weekday: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']).optional().describe(
        'Filtra a un día concreto de la semana. Útil cuando el visitante pregunta "¿tienes algo el viernes?".'
    ),
    periodOfDay: z.enum(['morning', 'afternoon']).optional().describe(
        'Filtra a mañana (<14:00) o tarde (≥14:00).'
    ),
    limit: z.number().int().min(1).max(20).optional().describe(
        'Cuántos slots máximo devolver (default 6).'
    ),
});

const OutputSchema = z.object({
    success: z.boolean(),
    disabled: z.boolean().optional().describe(
        'true si el admin tiene apagada la propuesta automática de booking. En ese caso slots viene vacío.'
    ),
    slots: z.array(
        z.object({
            date: z.string(),
            startTime: z.string(),
            endTime: z.string(),
            label: z.string(),
        })
    ).optional(),
    error: z.string().optional(),
});

/**
 * Tool de consulta de disponibilidad. El agente la llama cuando el visitante
 * pregunta por horarios concretos ("¿el viernes?", "otras horas?", "por la
 * tarde?") o cuando necesita re-mostrar la lista tras varios mensajes.
 *
 * No tiene efectos: sólo lee del calendario admin + bookings existentes.
 */
export const listAvailableSlotsTool = ai.defineTool(
    {
        name: 'listAvailableSlots',
        description:
            'Devuelve los próximos slots disponibles para una sesión con un asesor. ' +
            'Acepta filtros opcionales por día de la semana y franja (mañana/tarde). ' +
            'Llama a esta tool cuando el visitante pregunte por horarios o pida ver alternativas. ' +
            'NO la llames si el visitante ya recibió el InlineBookingPicker en este mismo turno.',
        inputSchema: InputSchema,
        outputSchema: OutputSchema,
    },
    async (input, toolContext) => {
        const result = await getNextAvailableSlotsAction({
            limit: input.limit,
            daysAhead: input.daysAhead,
            fromDate: input.fromDate,
            weekday: input.weekday,
            periodOfDay: input.periodOfDay,
        });

        // Volcamos los slots al sink para que el flow los exponga al frontend
        // y el chat los renderice como tarjetas clicables. Si llamadas
        // posteriores devuelven menos slots, sobreescribimos — la UI siempre
        // mostrará la última lista.
        if (result.success && result.slots && result.slots.length > 0) {
            const ctx = (toolContext?.context || {}) as SlotsToolContext;
            if (ctx.slotsSink) {
                ctx.slotsSink.slots = result.slots;
            }
        }

        return result;
    }
);

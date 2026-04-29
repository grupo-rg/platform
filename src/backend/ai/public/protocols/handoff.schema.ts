import { z } from 'zod';

/**
 * Datos que el agente comercial público debe recopilar antes de hacer handoff
 * al backend de cualificación. Nunca se llama directamente al motor de
 * presupuestos: primero se cualifica el lead y se notifica al admin.
 */
export const BudgetHandoffRequestSchema = z.object({
    leadName: z.string().min(2).max(120).describe("Nombre del cliente potencial"),
    leadEmail: z.string().email().describe("Email del lead (obligatorio)"),
    leadPhone: z.string().min(6).max(30).optional().describe("Teléfono del lead (opcional)"),
    projectDescription: z.string().min(10).max(5000).describe("Descripción detallada de la obra que el cliente quiere realizar"),
    projectType: z.enum(['bathroom', 'kitchen', 'integral', 'new_build', 'pool', 'other']).describe("Tipo de obra"),
    approxBudget: z.number().nonnegative().optional().describe("Presupuesto estimado del cliente, si lo mencionó"),
    approxSquareMeters: z.number().positive().optional().describe("Superficie aproximada en m², si se conoce"),
    postalCode: z.string().max(10).optional().describe("Código postal del proyecto"),
    city: z.string().max(80).optional().describe("Ciudad del proyecto"),
    timeline: z.enum(['asap', '1-3m', '3-6m', '6m+']).optional().describe("Plazo deseado"),
});

export type BudgetHandoffRequest = z.infer<typeof BudgetHandoffRequestSchema>;

/**
 * Slot de agenda ofrecido tras handoff cualificado.
 */
export const HandoffBookingSlotSchema = z.object({
    date: z.string().describe('YYYY-MM-DD'),
    startTime: z.string().describe('HH:MM'),
    endTime: z.string().describe('HH:MM'),
    label: z.string().describe('Texto amigable: "Mar 5 may, 10:00"'),
});

export type HandoffBookingSlot = z.infer<typeof HandoffBookingSlotSchema>;

/**
 * Respuesta sanitizada que vuelve al agente público.
 * NUNCA contiene precios ni partidas — sólo la decisión, un mensaje
 * comercial seguro y, si el lead es qualified, los próximos slots
 * disponibles para que el agente ofrezca agenda inline.
 */
export const BudgetHandoffResponseSchema = z.object({
    success: z.boolean(),
    leadId: z.string().describe("ID interno del lead creado o reusado"),
    decision: z.enum(['qualified', 'review_required', 'rejected']).describe("Resultado de la cualificación"),
    suggestedNextStep: z.string().describe(
        "Instrucción para el agente comercial sobre qué decirle al usuario a continuación. " +
        "Si decision='rejected', debe ser una despedida cortés sin prometer presupuesto."
    ),
    bookingSlots: z.array(HandoffBookingSlotSchema).optional().describe(
        "Próximos slots de reunión disponibles. Sólo presentes cuando " +
        "decision='qualified' y la auto-propuesta de booking está habilitada."
    ),
});

export type BudgetHandoffResponse = z.infer<typeof BudgetHandoffResponseSchema>;

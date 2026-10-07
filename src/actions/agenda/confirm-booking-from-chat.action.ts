'use server';

import { getLeadSession } from '@/backend/lead/infrastructure/lead-session';
import { confirmLeadBooking } from '@/backend/agenda/application/lead-booking-self-service';
import { checkRateLimit, RATE_LIMITS } from '@/backend/shared/security/rate-limiter';
import { getClientIp } from '@/backend/shared/security/client-identity';

/**
 * Confirma un booking iniciado desde el chat público (InlineBookingPicker).
 *
 * El lead se toma EXCLUSIVAMENTE de la cookie firmada `rg_lead_session`
 * (emitida tras verificar el OTP o tras un handoff que creó un lead nuevo en
 * este navegador). Cualquier `leadId` enviado por el cliente se ignora.
 */
export async function confirmBookingFromChatAction(params: {
    date: string;       // "YYYY-MM-DD"
    timeSlot: string;   // "HH:MM"
}): Promise<{ success: boolean; bookingId?: string; error?: string }> {
    const session = await getLeadSession();
    if (!session) {
        return { success: false, error: 'Necesitas verificar tu email para reservar.' };
    }
    const rl = await checkRateLimit('publicBookingAction', await getClientIp(), RATE_LIMITS.publicBookingAction);
    if (!rl.allowed) {
        return { success: false, error: 'Demasiadas operaciones de agenda. Inténtalo más tarde.' };
    }
    return confirmLeadBooking({
        leadId: session.leadId,
        date: String(params?.date || ''),
        timeSlot: String(params?.timeSlot || ''),
        source: 'chat_public',
    });
}

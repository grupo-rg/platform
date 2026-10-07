'use server';

import { getLeadSession } from '@/backend/lead/infrastructure/lead-session';
import { verifyAuth } from '@/backend/auth/auth.middleware';
import { rescheduleBookingWithSideEffects } from '@/backend/agenda/application/lead-booking-self-service';
import { checkRateLimit, RATE_LIMITS } from '@/backend/shared/security/rate-limiter';
import { getClientIp } from '@/backend/shared/security/client-identity';

export interface RescheduleBookingParams {
    bookingId: string;
    newDate: string;        // YYYY-MM-DD
    newTimeSlot: string;    // HH:MM
}

export interface RescheduleBookingResult {
    success: boolean;
    newBookingId?: string;
    error?: string;
    errorCode?: 'not_found' | 'forbidden' | 'too_late' | 'slot_taken' | 'invalid_input' | 'internal';
    minHours?: number;
}

/**
 * Reagenda una reserva del lead de la SESIÓN (cookie firmada). Siempre como
 * actor='lead': exige propiedad y respeta la antelación mínima. El cliente ya
 * no puede elegir `actor` ni `requesterLeadId`.
 */
export async function rescheduleBookingAction(params: RescheduleBookingParams): Promise<RescheduleBookingResult> {
    const session = await getLeadSession();
    if (!session) {
        return { success: false, error: 'Necesitas verificar tu email para gestionar tus reservas.', errorCode: 'forbidden' };
    }
    const rl = await checkRateLimit('publicBookingAction', await getClientIp(), RATE_LIMITS.publicBookingAction);
    if (!rl.allowed) {
        return { success: false, error: 'Demasiadas operaciones de agenda. Inténtalo más tarde.', errorCode: 'internal' };
    }
    return rescheduleBookingWithSideEffects({
        bookingId: String(params?.bookingId || ''),
        newDate: String(params?.newDate || ''),
        newTimeSlot: String(params?.newTimeSlot || ''),
        actor: 'lead',
        requesterLeadId: session.leadId,
    });
}

/** Variante admin (dashboard): sin restricción de antelación. */
export async function rescheduleBookingAsAdminAction(params: RescheduleBookingParams): Promise<RescheduleBookingResult> {
    const auth = await verifyAuth(true);
    if (!auth) return { success: false, error: 'No autorizado.', errorCode: 'forbidden' };
    return rescheduleBookingWithSideEffects({
        bookingId: String(params?.bookingId || ''),
        newDate: String(params?.newDate || ''),
        newTimeSlot: String(params?.newTimeSlot || ''),
        actor: 'admin',
    });
}

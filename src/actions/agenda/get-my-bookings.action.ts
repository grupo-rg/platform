'use server';

import { getLeadSession } from '@/backend/lead/infrastructure/lead-session';
import { listLeadBookings, type MyBookingDTO } from '@/backend/agenda/application/lead-booking-self-service';

export type { MyBookingDTO } from '@/backend/agenda/application/lead-booking-self-service';

/**
 * Reservas del lead de la SESIÓN (cookie firmada). Ya no acepta `leadId` del
 * navegador: antes cualquiera podía listar reservas de cualquier lead.
 */
export async function getMyBookingsAction(
    opts: { includePast?: boolean; includeCancelled?: boolean } = {}
): Promise<{ success: boolean; bookings?: MyBookingDTO[]; error?: string }> {
    const session = await getLeadSession();
    if (!session) return { success: false, error: 'Necesitas verificar tu email para ver tus reservas.' };
    return listLeadBookings(session.leadId, {
        includePast: !!opts?.includePast,
        includeCancelled: !!opts?.includeCancelled,
    });
}

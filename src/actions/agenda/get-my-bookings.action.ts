'use server';

import { FirestoreBookingRepository } from '@/backend/agenda/infrastructure/firestore-booking-repository';
import type { BookingStatus } from '@/backend/agenda/domain/booking';

export interface MyBookingDTO {
    id: string;
    /** ISO "YYYY-MM-DD" */
    date: string;
    /** "HH:MM" */
    timeSlot: string;
    status: BookingStatus;
    /** Texto amigable: "Mar 12 may, 16:00" */
    label: string;
    meetUrl?: string;
}

const SPANISH_DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const SPANISH_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function buildLabel(date: Date, timeSlot: string): string {
    return `${SPANISH_DAYS[date.getDay()]} ${date.getDate()} ${SPANISH_MONTHS[date.getMonth()]}, ${timeSlot}`;
}

function toDateKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Devuelve las reservas del lead, ordenadas por fecha ascendente, filtradas
 * por defecto a estados activos (PENDING/CONFIRMED) y futuros. Útil para que
 * el agente conversacional responda "¿cuándo era mi reunión?" o desambigüe
 * cuando el visitante quiere cancelar/reagendar y tiene varias activas.
 */
export async function getMyBookingsAction(
    leadId: string,
    opts: { includePast?: boolean; includeCancelled?: boolean } = {}
): Promise<{ success: boolean; bookings?: MyBookingDTO[]; error?: string }> {
    if (!leadId) {
        return { success: false, error: 'leadId requerido' };
    }
    try {
        const repo = new FirestoreBookingRepository();
        const all = await repo.findByLeadId(leadId);

        const now = new Date();
        const filtered = all.filter(b => {
            if (!opts.includeCancelled && b.status === 'CANCELLED') return false;
            if (!opts.includePast) {
                // Si la fecha+timeSlot es pasada, descartamos.
                const [hours, minutes] = b.timeSlot.split(':').map(Number);
                const slotDateTime = new Date(b.date);
                slotDateTime.setHours(hours, minutes, 0, 0);
                if (slotDateTime < now) return false;
            }
            return true;
        });

        // Orden ascendente por fecha+slot.
        filtered.sort((a, b) => {
            const da = new Date(a.date).getTime();
            const db = new Date(b.date).getTime();
            if (da !== db) return da - db;
            return a.timeSlot.localeCompare(b.timeSlot);
        });

        const bookings: MyBookingDTO[] = filtered.map(b => ({
            id: b.id,
            date: toDateKey(b.date),
            timeSlot: b.timeSlot,
            status: b.status,
            label: buildLabel(b.date, b.timeSlot),
            meetUrl: b.meetUrl,
        }));

        return { success: true, bookings };
    } catch (error: any) {
        console.error('getMyBookingsAction Error:', error);
        return { success: false, error: error?.message || 'Error consultando reservas' };
    }
}

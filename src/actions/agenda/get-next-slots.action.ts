'use server';

import { FirestoreBookingRepository } from '@/backend/agenda/infrastructure/firestore-booking-repository';
import { FirestoreAvailabilityRepository } from '@/backend/agenda/infrastructure/firestore-availability-repository';
import { GetAvailabilityUseCase } from '@/backend/agenda/application/booking-use-cases';

export interface NextSlotDTO {
    /** ISO date "YYYY-MM-DD" */
    date: string;
    /** "HH:MM" */
    startTime: string;
    /** "HH:MM" */
    endTime: string;
    /** Combinación legible: "Mar 5 may, 10:00" — para mostrar al usuario. */
    label: string;
}

const SPANISH_DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const SPANISH_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function buildLabel(date: Date, startTime: string): string {
    return `${SPANISH_DAYS[date.getDay()]} ${date.getDate()} ${SPANISH_MONTHS[date.getMonth()]}, ${startTime}`;
}

/**
 * Devuelve los próximos N slots disponibles desde hoy (o `fromDate`) hasta
 * `daysAhead` días en adelante. Útil para ofrecer slots inline en el chat
 * público o en emails post-handoff.
 *
 * Sólo retorna slots con `isAvailable=true` (futuros y no reservados).
 */
export async function getNextAvailableSlotsAction(
    limit: number = 6,
    daysAhead: number = 14
): Promise<{ success: boolean; slots?: NextSlotDTO[]; error?: string; disabled?: boolean }> {
    try {
        const availabilityRepo = new FirestoreAvailabilityRepository();
        // Respeta el toggle del admin: si autoProposeBooking=false, no devolvemos slots.
        const config = await availabilityRepo.getConfig();
        if (!config.autoProposeBooking) {
            return { success: true, slots: [], disabled: true };
        }

        const useCase = new GetAvailabilityUseCase(
            new FirestoreBookingRepository(),
            availabilityRepo
        );

        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + daysAhead);

        const dayMap = await useCase.execute({ startDate, endDate });

        const flat: NextSlotDTO[] = [];
        // Iteramos por fecha en orden ascendente.
        const sortedKeys = Object.keys(dayMap).sort();
        for (const dateKey of sortedKeys) {
            const slots = dayMap[dateKey] || [];
            for (const slot of slots) {
                if (!slot.isAvailable) continue;
                const dateObj = new Date(slot.date);
                flat.push({
                    date: dateKey,
                    startTime: slot.startTime,
                    endTime: slot.endTime,
                    label: buildLabel(dateObj, slot.startTime),
                });
                if (flat.length >= limit) break;
            }
            if (flat.length >= limit) break;
        }

        return { success: true, slots: flat };
    } catch (error: any) {
        console.error('getNextAvailableSlotsAction Error:', error);
        return { success: false, error: error?.message || 'Error obteniendo slots' };
    }
}

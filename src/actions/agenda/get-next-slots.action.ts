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

export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type PeriodOfDay = 'morning' | 'afternoon';

const SPANISH_DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const SPANISH_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const WEEKDAY_TO_INDEX: Record<WeekdayKey, number> = {
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function buildLabel(date: Date, startTime: string): string {
    return `${SPANISH_DAYS[date.getDay()]} ${date.getDate()} ${SPANISH_MONTHS[date.getMonth()]}, ${startTime}`;
}

/** Heurística simple: < 14:00 → mañana, ≥ 14:00 → tarde. */
function matchesPeriod(startTime: string, period: PeriodOfDay): boolean {
    const hour = parseInt(startTime.split(':')[0], 10);
    if (period === 'morning') return hour < 14;
    return hour >= 14;
}

export interface GetNextSlotsParams {
    limit?: number;
    daysAhead?: number;
    /** Si se especifica, sólo devuelve slots que caigan en ese día de la semana. */
    weekday?: WeekdayKey;
    /** Si se especifica, filtra a mañana (<14:00) o tarde (≥14:00). */
    periodOfDay?: PeriodOfDay;
    /** ISO "YYYY-MM-DD". Si no, parte de hoy. */
    fromDate?: string;
}

/**
 * Devuelve los próximos N slots disponibles desde `fromDate` (o hoy) hasta
 * `daysAhead` días en adelante, opcionalmente filtrados por día de la
 * semana y/o franja del día. Útil tanto para el InlineBookingPicker
 * post-handoff (sin filtros) como para que el agente conversacional
 * responda preguntas tipo "¿tienes hueco el viernes por la tarde?".
 *
 * Sólo retorna slots con `isAvailable=true` (futuros y no reservados).
 */
export async function getNextAvailableSlotsAction(
    limitOrParams: number | GetNextSlotsParams = 6,
    daysAheadLegacy: number = 14
): Promise<{ success: boolean; slots?: NextSlotDTO[]; error?: string; disabled?: boolean }> {
    // Compat: el call site pre-existente (`getNextAvailableSlotsAction(6, 14)`) sigue funcionando.
    const params: GetNextSlotsParams = typeof limitOrParams === 'number'
        ? { limit: limitOrParams, daysAhead: daysAheadLegacy }
        : limitOrParams;

    const limit = params.limit ?? 6;
    const daysAhead = params.daysAhead ?? 14;

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

        const startDate = params.fromDate ? new Date(params.fromDate) : new Date();
        if (isNaN(startDate.getTime())) {
            return { success: false, error: `fromDate inválido: ${params.fromDate}` };
        }
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + daysAhead);

        const dayMap = await useCase.execute({ startDate, endDate });

        const targetWeekdayIdx = params.weekday ? WEEKDAY_TO_INDEX[params.weekday] : null;

        const flat: NextSlotDTO[] = [];
        const sortedKeys = Object.keys(dayMap).sort();
        for (const dateKey of sortedKeys) {
            const slots = dayMap[dateKey] || [];
            for (const slot of slots) {
                if (!slot.isAvailable) continue;
                const dateObj = new Date(slot.date);

                if (targetWeekdayIdx !== null && dateObj.getDay() !== targetWeekdayIdx) continue;
                if (params.periodOfDay && !matchesPeriod(slot.startTime, params.periodOfDay)) continue;

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

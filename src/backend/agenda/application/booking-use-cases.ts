import { BookingRepository, TimeSlot } from '../domain/booking-repository';
import { Booking } from '../domain/booking';
import { AvailabilityRepository } from '../domain/availability-repository';
import { AvailabilityConfig } from '../domain/availability-config';

/**
 * CreateBookingUseCase
 * Validates slot availability, prevents double-booking, and creates a new booking.
 */
export class CreateBookingUseCase {
    constructor(private bookingRepo: BookingRepository) { }

    async execute(params: {
        name: string;
        email: string;
        phone: string | null;
        date: Date;
        timeSlot: string;
        leadId?: string;
    }): Promise<{ success: boolean; bookingId?: string; error?: string }> {
        try {
            // Check for double-booking
            const existingBookings = await this.bookingRepo.findByDate(params.date);
            const slotTaken = existingBookings.some(b => b.timeSlot === params.timeSlot);

            if (slotTaken) {
                return { success: false, error: 'Este horario ya está reservado. Por favor, elige otro.' };
            }

            const id = `bk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const booking = Booking.create(
                id,
                params.name,
                params.email,
                params.phone,
                params.date,
                params.timeSlot,
                params.leadId
            );

            await this.bookingRepo.save(booking);

            return { success: true, bookingId: id };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }
}

/**
 * GetAvailabilityUseCase
 * Returns available time slots dynamically generated from AvailabilityConfig.
 */
export class GetAvailabilityUseCase {
    constructor(
        private bookingRepo: BookingRepository,
        private availabilityRepo: AvailabilityRepository
    ) { }

    private generateSlotsForDay(date: Date, config: AvailabilityConfig): { startTime: string; endTime: string }[] {
        const dayOfWeek = date.getDay();
        const schedule = config.weekSchedule[dayOfWeek];

        if (!schedule || !schedule.enabled) {
            return [];
        }

        const slots: { startTime: string; endTime: string }[] = [];
        const slotDuration = config.slotDurationMinutes;
        const buffer = config.bufferMinutes;

        for (const range of schedule.slots) {
            let current = this.parseTime(range.start);
            const end = this.parseTime(range.end);

            while (current + slotDuration <= end) {
                slots.push({
                    startTime: this.formatTime(current),
                    endTime: this.formatTime(current + slotDuration)
                });
                current += slotDuration + buffer;
            }
        }

        return slots;
    }

    private parseTime(time: string): number {
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    }

    private formatTime(minutesTotal: number): string {
        const h = Math.floor(minutesTotal / 60);
        const m = minutesTotal % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    private toLocalFormat(date: Date): string {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    async execute(params: { startDate: Date; endDate: Date }): Promise<Record<string, TimeSlot[]>> {
        const result: Record<string, TimeSlot[]> = {};
        const config = await this.availabilityRepo.getConfig();

        const current = new Date(params.startDate);
        current.setHours(0, 0, 0, 0);
        const end = new Date(params.endDate);
        end.setHours(23, 59, 59, 999);

        while (current <= end) {
            const dateKey = this.toLocalFormat(current);
            const dynamicSlots = this.generateSlotsForDay(current, config);

            if (dynamicSlots.length > 0) {
                const existingBookings = await this.bookingRepo.findByDate(current);
                const bookedSlots = new Set(existingBookings.map(b => b.timeSlot));

                result[dateKey] = dynamicSlots.map(slot => {
                    return {
                        date: new Date(current),
                        startTime: slot.startTime,
                        endTime: slot.endTime,
                        isAvailable: !bookedSlots.has(slot.startTime) && Booking.isInFuture(current, slot.startTime)
                    };
                });
            } else {
                result[dateKey] = [];
            }

            current.setDate(current.getDate() + 1);
        }

        return result;
    }
}

/**
 * Resultado tipado de cancelación. El error semántico permite a la action
 * y a la tool del agente diferenciar errores de UX (too_late, forbidden)
 * de errores reales (not_found, internal).
 */
export type CancelBookingResult =
    | { success: true; bookingId: string; slotDateTime: Date; leadId: string | null }
    | { success: false; error: string; errorCode?: 'not_found' | 'forbidden' | 'too_late' | 'already_cancelled' | 'internal'; minHours?: number };

export interface CancelBookingInput {
    bookingId: string;
    /** Si está presente, autorizamos sólo si el booking pertenece al leadId. */
    requesterLeadId?: string;
    /** Si true, se omite la validación de antelación mínima (uso admin). */
    skipMinHoursCheck?: boolean;
}

/**
 * CancelBookingUseCase
 *
 * Por defecto valida antelación mínima leyendo `AvailabilityConfig.minCancellationHours`.
 * Para self-service desde el chat público se pasa `requesterLeadId` para
 * evitar que un lead cancele booking de otro. Para uso admin se pasa
 * `skipMinHoursCheck: true`.
 */
export class CancelBookingUseCase {
    constructor(
        private bookingRepo: BookingRepository,
        private availabilityRepo?: AvailabilityRepository
    ) { }

    async execute(input: string | CancelBookingInput): Promise<CancelBookingResult> {
        const params: CancelBookingInput = typeof input === 'string' ? { bookingId: input } : input;

        const booking = await this.bookingRepo.findById(params.bookingId);
        if (!booking) {
            return { success: false, error: 'Reserva no encontrada.', errorCode: 'not_found' };
        }

        if (params.requesterLeadId && booking.leadId !== params.requesterLeadId) {
            return { success: false, error: 'No autorizado para cancelar esta reserva.', errorCode: 'forbidden' };
        }

        if (booking.status === 'CANCELLED') {
            return { success: false, error: 'La reserva ya estaba cancelada.', errorCode: 'already_cancelled' };
        }

        // Validación de antelación mínima (sólo si tenemos availabilityRepo y no se skippea).
        if (this.availabilityRepo && !params.skipMinHoursCheck) {
            const config = await this.availabilityRepo.getConfig();
            const minHours = config.minCancellationHours ?? 4;
            const [hh, mm] = booking.timeSlot.split(':').map(Number);
            const slotDateTime = new Date(booking.date);
            slotDateTime.setHours(hh, mm, 0, 0);
            const hoursUntil = (slotDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
            if (hoursUntil < minHours) {
                return {
                    success: false,
                    error: `Las reservas sólo pueden cancelarse con al menos ${minHours}h de antelación.`,
                    errorCode: 'too_late',
                    minHours,
                };
            }
        }

        try {
            booking.cancel();
            await this.bookingRepo.save(booking);

            const [hh, mm] = booking.timeSlot.split(':').map(Number);
            const slotDateTime = new Date(booking.date);
            slotDateTime.setHours(hh, mm, 0, 0);

            return {
                success: true,
                bookingId: booking.id,
                slotDateTime,
                leadId: booking.leadId,
            };
        } catch (err: any) {
            return { success: false, error: err.message, errorCode: 'internal' };
        }
    }
}

/**
 * Booking Status
 */
export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';

/**
 * Booking Aggregate Root
 * Represents a scheduled consultation/demo booking.
 */
export class Booking {
    constructor(
        public readonly id: string,
        public readonly leadId: string | null,
        public readonly name: string,
        public readonly email: string,
        public readonly phone: string | null,
        public readonly date: Date,
        public readonly timeSlot: string, // e.g. "09:00"
        public status: BookingStatus,
        public notes: string | null,
        public readonly createdAt: Date,
        public updatedAt: Date,
        public meetUrl?: string
    ) { }

    static create(
        id: string,
        name: string,
        email: string,
        phone: string | null,
        date: Date,
        timeSlot: string,
        leadId?: string
    ): Booking {
        if (!Booking.isValidSlot(timeSlot)) {
            throw new Error(`Invalid time slot: ${timeSlot}`);
        }
        if (!Booking.isInFuture(date, timeSlot)) {
            throw new Error('Cannot book a slot in the past');
        }

        return new Booking(
            id,
            leadId ?? null,
            name,
            email,
            phone,
            date,
            timeSlot,
            'PENDING',
            null,
            new Date(),
            new Date()
        );
    }

    confirm(): void {
        if (this.status === 'CANCELLED') {
            throw new Error('Cannot confirm a cancelled booking');
        }
        this.status = 'CONFIRMED';
        this.updatedAt = new Date();
    }

    cancel(): void {
        if (this.status === 'COMPLETED') {
            throw new Error('Cannot cancel a completed booking');
        }
        this.status = 'CANCELLED';
        this.updatedAt = new Date();
    }

    complete(): void {
        this.status = 'COMPLETED';
        this.updatedAt = new Date();
    }

    static isValidSlot(slot: string): boolean {
        const validSlots = [
            '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
            '12:00', '12:30', '16:00', '16:30', '17:00', '17:30',
            '18:00', '18:30', '19:00', '19:30'
        ];
        return validSlots.includes(slot);
    }

    static isInFuture(date: Date, slot: string): boolean {
        const [hours, minutes] = slot.split(':').map(Number);
        const slotDate = new Date(date);
        slotDate.setHours(hours, minutes, 0, 0);
        return slotDate > new Date();
    }

    static isWeekday(date: Date): boolean {
        const day = date.getDay();
        return day !== 0 && day !== 6;
    }
}

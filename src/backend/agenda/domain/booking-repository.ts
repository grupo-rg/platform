import { Booking } from './booking';

/**
 * Booking Repository Port
 */
export interface BookingRepository {
    save(booking: Booking): Promise<void>;
    findById(id: string): Promise<Booking | null>;
    findByDate(date: Date): Promise<Booking[]>;
    findByEmail(email: string): Promise<Booking[]>;
    findUpcoming(limit: number): Promise<Booking[]>;
    findByDateRange(start: Date, end: Date): Promise<Booking[]>;
}

/**
 * TimeSlot Value Object — represents an available time block.
 */
export interface TimeSlot {
    date: Date;
    startTime: string;
    endTime: string;
    isAvailable: boolean;
}

import { BookingRepository } from '../domain/booking-repository';
import { Booking, BookingStatus } from '../domain/booking';
import { getFirestore } from 'firebase-admin/firestore';

const db = () => getFirestore();

export class FirestoreBookingRepository implements BookingRepository {
    private collection = 'bookings';

    async save(booking: Booking): Promise<void> {
        await db().collection(this.collection).doc(booking.id).set({
            leadId: booking.leadId,
            name: booking.name,
            email: booking.email,
            phone: booking.phone,
            date: booking.date,
            timeSlot: booking.timeSlot,
            status: booking.status,
            notes: booking.notes,
            createdAt: booking.createdAt,
            updatedAt: booking.updatedAt,
            meetUrl: booking.meetUrl || null
        });
    }

    async findById(id: string): Promise<Booking | null> {
        const doc = await db().collection(this.collection).doc(id).get();
        if (!doc.exists) return null;
        return this.toBooking(doc.id, doc.data()!);
    }

    async findByDate(date: Date): Promise<Booking[]> {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const snap = await db().collection(this.collection)
            .where('date', '>=', startOfDay)
            .where('date', '<=', endOfDay)
            .where('status', 'in', ['PENDING', 'CONFIRMED'])
            .get();

        return snap.docs.map(doc => this.toBooking(doc.id, doc.data()));
    }

    async findByEmail(email: string): Promise<Booking[]> {
        const snap = await db().collection(this.collection)
            .where('email', '==', email)
            .orderBy('date', 'desc')
            .limit(10)
            .get();

        return snap.docs.map(doc => this.toBooking(doc.id, doc.data()));
    }

    async findUpcoming(limit: number): Promise<Booking[]> {
        const now = new Date();
        const snap = await db().collection(this.collection)
            .where('date', '>=', now)
            .where('status', 'in', ['PENDING', 'CONFIRMED'])
            .orderBy('date', 'asc')
            .limit(limit)
            .get();

        return snap.docs.map(doc => this.toBooking(doc.id, doc.data()));
    }

    async findByDateRange(start: Date, end: Date): Promise<Booking[]> {
        const snap = await db().collection(this.collection)
            .where('date', '>=', start)
            .where('date', '<=', end)
            .get();

        return snap.docs.map(doc => this.toBooking(doc.id, doc.data()));
    }

    private toBooking(id: string, data: any): Booking {
        return new Booking(
            id,
            data.leadId ?? null,
            data.name,
            data.email,
            data.phone ?? null,
            data.date?.toDate?.() ?? new Date(data.date),
            data.timeSlot,
            data.status as BookingStatus,
            data.notes ?? null,
            data.createdAt?.toDate?.() ?? new Date(data.createdAt),
            data.updatedAt?.toDate?.() ?? new Date(data.updatedAt),
            data.meetUrl ?? undefined
        );
    }
}

import { Booking } from "../domain/booking";
import { BookingRepository } from "../domain/booking-repository";
import { AvailabilityRepository } from "../domain/availability-repository";
import { EventDispatcher } from "../../shared/events/event-dispatcher";
import { BookingConfirmedEvent } from "../domain/events/booking-confirmed.event";
import { GoogleCalendarService } from "../../shared/infrastructure/google/google-calendar.service";

interface CreateBookingRequest {
    name: string;
    email: string;
    phone: string | null;
    dateISO: string;
    timeSlot: string; // "14:30"
    leadId?: string;
}

export class CreateBookingUseCase {
    constructor(
        private readonly bookingRepo: BookingRepository,
        private readonly availabilityRepo: AvailabilityRepository,
        private readonly eventBus: EventDispatcher,
        private readonly meetService: GoogleCalendarService
    ) {}

    async execute(req: CreateBookingRequest): Promise<Booking> {
        const targetDate = new Date(req.dateISO);

        // 1. Domain Validation
        const isAvailable = await this.availabilityRepo.isSlotAvailable(targetDate, req.timeSlot);
        if (!isAvailable) {
            throw new Error(`The slot \${req.timeSlot} is already booked or unvailable.`);
        }

        const id = `book_\${Date.now()}_\${Math.floor(Math.random() * 1000)}`;

        const newBooking = Booking.create(
            id,
            req.name,
            req.email,
            req.phone,
            targetDate,
            req.timeSlot,
            req.leadId
        );

        newBooking.confirm();

        // [NUEVO] Inyectar Google Meet Dinámicamente
        // Calculamos la hora exacta basándonos en dateISO + timeSlot
        const [hours, mins] = req.timeSlot.split(':').map(Number);
        const startDateTime = new Date(targetDate);
        startDateTime.setHours(hours, mins, 0, 0);

        const summary = `Consultoría Basis: \${req.name}`;
        const description = `Revisión Técnica con \${req.name} (\${req.email} / \${req.phone || 'Sin telf'}). Lead ID: \${req.leadId || 'N/A'}`;
        
        console.log(`[Agenda] Solicitando enlace a Google Meet para: \${summary}`);
        const meetUrl = await this.meetService.generateMeetLink(summary, description, startDateTime, 45, [req.email, 'info@consultoria.systems']);
        
        // Asociamos el link de la sala a la reserva nativa
        newBooking.meetUrl = meetUrl;

        // Persistencia
        await this.bookingRepo.save(newBooking);

        // Side Effects Orchestration
        if (newBooking.leadId) {
            const domainEvent = new BookingConfirmedEvent(newBooking.id, newBooking.leadId, startDateTime, newBooking.meetUrl);
            await this.eventBus.dispatch(domainEvent);
        }

        return newBooking;
    }
}

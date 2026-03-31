import { DomainEvent } from "../../../shared/domain/domain-event";

export class BookingConfirmedEvent implements DomainEvent {
    readonly eventName = 'BookingConfirmedEvent';
    readonly occurredOn: Date;

    constructor(
        public readonly bookingId: string,
        public readonly leadId: string | null,
        public readonly slotDateTime: Date,
        public readonly meetUrl?: string
    ) {
        this.occurredOn = new Date();
    }
}

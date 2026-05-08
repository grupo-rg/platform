import { DomainEvent } from "../../../shared/domain/domain-event";

/**
 * Disparado cuando una reserva pasa a estado CANCELLED, ya sea por
 * iniciativa del lead (chat self-service) o del admin.
 *
 * `cancelledBy` distingue el origen para que los listeners puedan reaccionar
 * de forma diferenciada — p. ej. el ajuste de score sólo se revierte cuando
 * el lead se cancela a sí mismo, no cuando es el admin quien cancela por
 * conflicto interno.
 */
export class BookingCancelledEvent implements DomainEvent {
    readonly eventName = 'BookingCancelledEvent';
    readonly occurredOn: Date;

    constructor(
        public readonly bookingId: string,
        public readonly leadId: string | null,
        public readonly slotDateTime: Date,
        public readonly cancelledBy: 'lead' | 'admin' | 'system'
    ) {
        this.occurredOn = new Date();
    }
}

export interface DomainEvent {
    // Nombre único del evento (ej: 'BookingConfirmed')
    readonly eventName: string;
    // Fecha en la que ocurrió el evento
    readonly occurredOn: Date;
}

import { DomainEvent } from "../domain/domain-event";

export interface EventHandler<T extends DomainEvent> {
    handle(event: T): Promise<void>;
}

/**
 * EventDispatcher en memoria.
 * Especial para orquestar efectos secundarios (Side-Effects) dentro del mismo hilo
 * y entorno Request/Response en aplicaciones Serverless/Vercel.
 */
export class EventDispatcher {
    private handlers: Map<string, EventHandler<any>[]> = new Map();

    // Singleton simplificado para inyección de dependencias rápida
    private static instance: EventDispatcher;

    private constructor() {}

    static getInstance(): EventDispatcher {
        if (!EventDispatcher.instance) {
            EventDispatcher.instance = new EventDispatcher();
        }
        return EventDispatcher.instance;
    }

    /**
     * Registra un Handler para un evento específico
     */
    register<T extends DomainEvent>(eventName: string, handler: EventHandler<T>): void {
        const currentHandlers = this.handlers.get(eventName) || [];
        currentHandlers.push(handler);
        this.handlers.set(eventName, currentHandlers);
    }

    /**
     * Dispara el evento y ejecuta todos los listener registrados.
     * Al funcionar en Serverless, se espera que el despachador sea invocado 
     * con \`await\` por el Use Case core para garantizar que los Eventos se computen
     * antes de que el Worker/Vercel destruya el ciclo de vida de la request.
     */
    async dispatch(event: DomainEvent): Promise<void> {
        const eventHandlers = this.handlers.get(event.eventName);
        if (eventHandlers && eventHandlers.length > 0) {
            console.log(`[EventDispatcher] Ocurrió Evento \${event.eventName}. Ejecutando \${eventHandlers.length} Handlers asociados.`);
            
            // Promise.all(Settled) para aislar fallos de un dominio respecto al flujo de otro
            const globalResults = await Promise.allSettled(
                eventHandlers.map(handler => handler.handle(event))
            );

            globalResults.forEach((result, i) => {
                if (result.status === 'rejected') {
                    console.error(`[EventDispatcher] Handler \${i} falló silenciosamente para \${event.eventName}:`, result.reason);
                }
            });
        } else {
            console.log(`[EventDispatcher] Ocurrió Evento \${event.eventName} pero nadie lo está escuchando.`);
        }
    }
}

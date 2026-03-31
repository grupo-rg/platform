import { EventHandler } from "../../shared/events/event-dispatcher";
import { BookingConfirmedEvent } from "../../agenda/domain/events/booking-confirmed.event";
import { EmailProviderPort } from "../../marketing/domain/marketing.repository";

/**
 * Listener CRM/Admin: Dispara una alerta interna por Email al equipo de Ventas
 * cuando ocurre una agenda exitosa para que no pase desapercibida.
 */
export class NotifyAdminOnBookingUseCase implements EventHandler<BookingConfirmedEvent> {
    constructor(
        private readonly emailProvider: EmailProviderPort,
        private readonly adminEmailDest: string = process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'info@consultoria.systems'
    ) {}

    async handle(event: BookingConfirmedEvent): Promise<void> {
        console.log(`[CRM Alert] Preparando notificación a Administrador por nueva Cita del Lead: \${event.leadId}`);
        
        const subject = `🔥 NUEVA CITA AGENDADA EN BASIS: \${event.leadId}`;
        const bodyContent = `
<h2>¡Entró un nuevo Deal al Calendario!</h2>
<p>El prospecto con ID <strong>\${event.leadId || 'N/A'}</strong> ha terminado el embudo y agendó exitosamente una reunión a través del portal de Consultoría In-House.</p>

<p>Míralo en el Tablero Kanban: <strong>SALES_CALL_SCHEDULED</strong>.</p>
<ul>
    <li>Fecha de Reunión: \${event.slotDateTime.toLocaleString()}</li>
    <li>ID de Booking: \${event.bookingId}</li>
    <li>Enlace Automático Meet Creado: <a href="\${event.meetUrl || '#'}">\${event.meetUrl || 'No se generó enlace'}</a></li>
</ul>
<p>Revisa la tarjeta en Basis CRM para ver sus respuestas de diagnóstico y stack técnico antes de entrar a la llamada.</p>
        `;

        try {
            await this.emailProvider.sendEmail(this.adminEmailDest, subject, bodyContent);
            console.log(`[CRM Alert] ✅ Alerta de Email enviada exitosamente a ventas (\${this.adminEmailDest}).`);
        } catch (e) {
            console.error(`[CRM Alert] Error notificando al admin de ventas:`, e);
        }
    }
}

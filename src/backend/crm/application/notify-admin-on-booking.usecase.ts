import { EventHandler } from "../../shared/events/event-dispatcher";
import { BookingConfirmedEvent } from "../../agenda/domain/events/booking-confirmed.event";
import { EmailProviderPort } from "../../marketing/domain/marketing.repository";
import { companyConfigService } from "../../platform/application/company-config-service";

/**
 * Listener CRM/Admin: Dispara una alerta interna por Email al equipo de Ventas
 * cuando ocurre una agenda exitosa para que no pase desapercibida.
 */
export class NotifyAdminOnBookingUseCase implements EventHandler<BookingConfirmedEvent> {
    constructor(
        private readonly emailProvider: EmailProviderPort,
        /** Destino fijo opcional; por defecto, el buzón de Ajustes › Empresa. */
        private readonly adminEmailDest?: string
    ) {}

    async handle(event: BookingConfirmedEvent): Promise<void> {
        console.log(`[CRM Alert] Preparando notificación a Administrador por nueva Cita del Lead: ${event.leadId}`);

        const subject = `🔥 NUEVA CITA AGENDADA: ${event.leadId}`;
        const bodyContent = `
<h2>¡Entró un nuevo Deal al Calendario!</h2>
<p>El prospecto con ID <strong>${event.leadId || 'N/A'}</strong> ha terminado el embudo y agendó exitosamente una reunión.</p>

<p>Míralo en el Tablero Kanban: <strong>SALES_CALL_SCHEDULED</strong>.</p>
<ul>
    <li>Fecha de Reunión: ${event.slotDateTime.toLocaleString()}</li>
    <li>ID de Booking: ${event.bookingId}</li>
</ul>
<p>Revisa la tarjeta en el CRM para ver el contexto del cliente antes de entrar a la llamada.</p>
        `;

        try {
            const dest = this.adminEmailDest || (await companyConfigService.notificationEmail());
            if (!dest) {
                console.warn('[CRM Alert] Sin email de empresa configurado (Ajustes › Empresa): aviso de cita no enviado.');
                return;
            }
            await this.emailProvider.sendDirectEmail(dest, subject, bodyContent);
            console.log(`[CRM Alert] ✅ Alerta de Email enviada exitosamente a ventas (${dest}).`);
        } catch (e) {
            console.error(`[CRM Alert] Error notificando al admin de ventas:`, e);
        }
    }
}

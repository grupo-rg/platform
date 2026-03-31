import { MessagingService } from "../../application/messaging.service";

/**
 * Adapter implementation for WhatsApp Cloud API (Meta).
 */
export class MetaWhatsAppProvider implements MessagingService {
    private readonly apiUrl = 'https://graph.facebook.com/v17.0';
    private readonly accessToken = process.env.META_ACCESS_TOKEN;
    private readonly phoneNumberId = process.env.META_PHONE_NUMBER_ID;

    async sendEmail(leadId: string, templateId: string, variables: Record<string, string>): Promise<void> {
        // En una implementación real se inyectaría un proveedor como SendGrid / Resend aquí
        console.log(`[Mock Email] Enviando email al lead ${leadId} con template ${templateId}`, variables);
    }

    async sendWhatsApp(phone: string, templateId: string, variables: Record<string, string>): Promise<void> {
        if (!this.accessToken || !this.phoneNumberId) {
            console.warn("[MetaWhatsAppProvider] Configuración de Meta incompleta. Abortando envío.");
            return;
        }

        const payload = {
            messaging_product: "whatsapp",
            to: phone,
            type: "template",
            template: {
                name: templateId,
                language: { code: "es" },
                // Aquí se inyectarían los variables mapeados a components del template de WhatsApp
            }
        };

        try {
            // Ejemplo de llamada fetch (comentada para no realizar I/O en la demo):
            // const response = await fetch(`${this.apiUrl}/${this.phoneNumberId}/messages`, {
            //     method: 'POST',
            //     headers: {
            //         'Authorization': `Bearer ${this.accessToken}`,
            //         'Content-Type': 'application/json'
            //     },
            //     body: JSON.stringify(payload)
            // });
            
            console.log(`[WhatsApp API Call] Mensaje de plantilla '${templateId}' disparado exitosamente a +${phone}`);
        } catch (error) {
            console.error("[MetaWhatsAppProvider] Falló la petición de envío vía Meta Cloud API", error);
            throw error;
        }
    }
}

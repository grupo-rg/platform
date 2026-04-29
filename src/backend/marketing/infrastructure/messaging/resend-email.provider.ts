import 'server-only';
import { getFirestore } from 'firebase-admin/firestore';
import { MessagingService } from '../../application/messaging.service';
import { ResendEmailService } from '@/backend/shared/infrastructure/messaging/resend-email.service';

/**
 * Implementación de MessagingService basada en Resend.
 * Reemplaza al antiguo FirebaseEmailProvider (que escribía a mail/* y dependía
 * de la extensión Firebase Trigger Email, no instalada en este proyecto).
 *
 * Mantiene la misma firma para no romper el worker de marketing.
 */
export class ResendEmailProvider implements MessagingService {
    async sendWhatsApp(phone: string, templateId: string, _variables: Record<string, string>): Promise<void> {
        // Pendiente de integrar Twilio / Meta Business API en F7
        console.log(`[ResendEmailProvider - Mock WhatsApp] phone=${phone} template=${templateId}`);
    }

    async sendEmail(leadId: string, templateId: string, variables: Record<string, string>): Promise<void> {
        const db = getFirestore();

        // Resolver email del lead (test o prod)
        const testDoc = await db.collection('test_leads').doc(leadId).get();
        let email: string | undefined =
            testDoc.data()?.personalInfo?.email || testDoc.data()?.email;

        if (!email) {
            const prodDoc = await db.collection('leads').doc(leadId).get();
            email = prodDoc.data()?.personalInfo?.email || prodDoc.data()?.email;
        }

        if (!email) {
            console.warn(`[ResendEmailProvider] No se encontró email para el lead ${leadId}`);
            return;
        }

        const textContent = variables.textBody || `Mensaje de Grupo RG (plantilla ${templateId})`;
        const htmlInner = variables.htmlBody || `<p>${textContent.replace(/\n/g, '<br>')}</p>`;

        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:9002';
        const trackingPixel = variables.enrollmentId
            ? `<img src="${baseUrl}/api/tracking/pixel?eid=${variables.enrollmentId}" width="1" height="1" style="display:none;" alt="" />`
            : '';

        const html = `
            <div style="font-family:'Helvetica Neue',Arial,sans-serif;color:#1a1a1a;max-width:600px;line-height:1.6;">
                ${htmlInner}
                <hr style="border:none;border-top:1px solid #eaeaea;margin:20px 0;" />
                <p style="color:#666;font-size:12px;"><strong>Grupo RG</strong> · Aviso automático.</p>
                ${trackingPixel}
            </div>
        `;

        await ResendEmailService.send({
            to: email,
            subject: variables.subject || 'Siguientes pasos · Grupo RG',
            html,
            text: textContent,
            tags: [
                { name: 'category', value: 'marketing_sequence' },
                { name: 'template', value: templateId },
                { name: 'lead_id', value: leadId },
            ],
        });
    }
}

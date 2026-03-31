import { MessagingService } from "../../application/messaging.service";
import { getFirestore } from 'firebase-admin/firestore';

export class FirebaseEmailProvider implements MessagingService {
    async sendWhatsApp(phone: string, templateId: string, variables: Record<string, string>): Promise<void> {
        // En modo pruebas E2E solo usaremos Email. WhatsApp se simula.
        console.log(`[FirebaseEmailProvider - Mock WhatsApp] Enviaría a ${phone} usando plantilla ${templateId}`);
    }

    async sendEmail(leadId: string, templateId: string, variables: Record<string, string>): Promise<void> {
        const db = getFirestore();
        
        // El Decorador de IA inyecta el HTML renderizado (via marked) en htmlBody
        const textContent = variables.textBody || `Mensaje estático de Basis (Plantilla: ${templateId})`;
        const htmlContent = variables.htmlBody || `<p>${textContent.replace(/\n/g, '<br>')}</p>`;

        // 1. Buscamos el email real del Lead (incluso si está en la DB de prueba, lo resolverá)
        // Buscamos primero en leads normales, pero si estamos en test, en la vida real buscará en la colección activa.
        // Aquí simplificaremos para buscar en la colección que contenga al Lead
        const testLeadDoc = await db.collection('test_leads').doc(leadId).get();
        let email = testLeadDoc.data()?.personalInfo?.email || testLeadDoc.data()?.email;

        if (!email) {
            const prodLeadDoc = await db.collection('leads').doc(leadId).get();
            email = prodLeadDoc.data()?.personalInfo?.email || prodLeadDoc.data()?.email;
        }

        if (!email) {
            console.warn(`[FirebaseEmailProvider] Error: No se encontró email para el lead ${leadId}`);
            return;
        }

        // Si el Decorador de IA pasó el ID del enrollment, inyectamos pixel
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
        const trackingPixel = variables.enrollmentId 
            ? `<img src="${baseUrl}/api/tracking/pixel?eid=${variables.enrollmentId}" width="1" height="1" style="display:none; visibility:hidden;" alt="" />`
            : '';

        // 2. Inserción directa en la colección "mail" (Firebase Trigger Email Extension)
        await db.collection('mail').add({
            to: email,
            message: {
                subject: 'Siguientes pasos con Basis CRM',
                text: textContent,
                html: `<div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; max-width: 600px; line-height: 1.6;">
                         ${htmlContent}
                         <br>
                         <hr style="border: none; border-top: 1px solid #eaeaea; margin: 20px 0;">
                         <p style="color: #666; font-size: 12px;"><small><strong>Basis CRM</strong> - Este es un aviso de nuestro sistema de IA.</small></p>
                         ${trackingPixel}
                       </div>`
            },

            status: 'pending',
            createdAt: new Date().toISOString()
        });

        console.log(`[FirebaseEmailProvider] ✅ Email encolado en Firebase ("mail" collection) para el destinatario: ${email}`);
    }
}

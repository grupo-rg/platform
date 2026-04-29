import { EventHandler } from '../../shared/events/event-dispatcher';
import { LeadCreatedEvent } from '../domain/events/lead-created.event';
import { LeadRepository } from '../domain/lead-repository';
import { ResendEmailService } from '@/backend/shared/infrastructure/messaging/resend-email.service';

const SOURCE_LABELS: Record<string, string> = {
    chat_public: 'Chat público',
    wizard: 'Wizard de presupuesto',
    quick_form: 'Formulario rápido',
    detailed_form: 'Formulario detallado',
    new_build_form: 'Formulario obra nueva',
    demo: 'Demo',
};

const DECISION_LABELS: Record<string, string> = {
    qualified: 'Cualificado ✅',
    review_required: 'Requiere revisión ⚠️',
    rejected: 'Rechazado ❌',
};

/**
 * Listener: encola un email al admin cada vez que se registra un lead nuevo
 * (excepto los rechazados, que se archivan sin notificar).
 *
 * Variables de entorno:
 *   - ADMIN_NOTIFICATION_EMAIL: destinatario obligatorio.
 *   - NEXT_PUBLIC_SITE_URL: base para el link al detalle del lead.
 */
export class NotifyAdminOnLeadCreatedUseCase implements EventHandler<LeadCreatedEvent> {
    constructor(private readonly leadRepository: LeadRepository) {}

    async handle(event: LeadCreatedEvent): Promise<void> {
        if (event.decision === 'rejected') {
            console.log(`[NotifyAdminOnLeadCreated] Lead ${event.leadId} rechazado, no se notifica.`);
            return;
        }

        const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
        if (!adminEmail) {
            console.warn('[NotifyAdminOnLeadCreated] ADMIN_NOTIFICATION_EMAIL no configurado, se omite notificación.');
            return;
        }

        const lead = await this.leadRepository.findById(event.leadId);
        if (!lead) {
            console.warn(`[NotifyAdminOnLeadCreated] Lead ${event.leadId} no encontrado.`);
            return;
        }

        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:9002';
        const detailUrl = `${baseUrl}/dashboard/leads/${lead.id}`;

        const sourceLabel = SOURCE_LABELS[event.source] || event.source;
        const decisionLabel = DECISION_LABELS[event.decision] || event.decision;
        const intake = lead.intake;

        const imagesBlock = intake?.imageUrls?.length
            ? `<p><strong>Archivos adjuntos:</strong></p>
               <ul>${intake.imageUrls.map(url => `<li><a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a></li>`).join('')}</ul>`
            : '';

        const suspiciousBlock = intake?.suspicious
            ? `<p style="background:#fff4d4;padding:8px;border-left:3px solid #f0a800;">
                 ⚠️ <strong>Atención:</strong> el sanitizer detectó patrones de prompt injection en este mensaje.
               </p>`
            : '';

        const subject = `[Grupo RG] Nuevo lead — ${decisionLabel} — ${event.leadName}`;
        const html = `
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; max-width: 640px; line-height: 1.6;">
                <h2 style="margin-bottom: 4px;">Nuevo lead capturado</h2>
                <p style="color:#666;margin-top:0;">Origen: ${sourceLabel} · Score: ${event.score}/100</p>
                ${suspiciousBlock}
                <h3>Cliente</h3>
                <ul>
                    <li><strong>Nombre:</strong> ${lead.personalInfo.name}</li>
                    <li><strong>Email:</strong> ${lead.personalInfo.email}</li>
                    <li><strong>Teléfono:</strong> ${lead.personalInfo.phone || '—'}</li>
                    ${lead.personalInfo.address ? `<li><strong>Dirección:</strong> ${lead.personalInfo.address}</li>` : ''}
                </ul>
                ${intake ? `
                <h3>Solicitud</h3>
                <ul>
                    <li><strong>Tipo de obra:</strong> ${intake.projectType}</li>
                    ${intake.approxSquareMeters ? `<li><strong>Superficie aprox.:</strong> ${intake.approxSquareMeters} m²</li>` : ''}
                    ${intake.qualityLevel ? `<li><strong>Calidad:</strong> ${intake.qualityLevel}</li>` : ''}
                    ${intake.postalCode ? `<li><strong>Código postal:</strong> ${intake.postalCode}</li>` : ''}
                    ${intake.city ? `<li><strong>Ciudad:</strong> ${intake.city}</li>` : ''}
                    ${intake.timeline ? `<li><strong>Plazo:</strong> ${intake.timeline}</li>` : ''}
                    ${intake.approxBudget ? `<li><strong>Presupuesto cliente:</strong> ${intake.approxBudget} €</li>` : ''}
                </ul>
                <p><strong>Descripción:</strong></p>
                <blockquote style="border-left:3px solid #ddd;padding-left:12px;color:#444;">${escapeHtml(intake.description)}</blockquote>
                ${imagesBlock}
                ` : ''}
                <hr style="border:none;border-top:1px solid #eaeaea;margin:20px 0;" />
                <p>
                    <a href="${detailUrl}" style="background:#1a1a1a;color:#fff;padding:10px 18px;text-decoration:none;border-radius:6px;display:inline-block;">
                        Ver lead en el dashboard
                    </a>
                </p>
                <p style="color:#888;font-size:12px;">Lead ID: <code>${lead.id}</code></p>
            </div>
        `;

        const { id: resendId } = await ResendEmailService.send({
            to: adminEmail,
            subject,
            html,
            tags: [
                { name: 'category', value: 'admin_lead_notification' },
                { name: 'decision', value: event.decision },
                { name: 'source', value: event.source },
            ],
        });
        if (resendId) {
            console.log(`[NotifyAdminOnLeadCreated] Email enviado al admin (resend id=${resendId}) sobre lead ${lead.id}`);
        }
    }
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

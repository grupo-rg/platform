import { EventHandler } from '../../shared/events/event-dispatcher';
import { LeadCreatedEvent } from '../domain/events/lead-created.event';
import { LeadRepository } from '../domain/lead-repository';
import type { LeadIntake } from '../domain/lead';
import { ResendEmailService } from '@/backend/shared/infrastructure/messaging/resend-email.service';
import { escapeHtml } from '@/backend/shared/security/html-escape';

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

export interface AdminLeadEmailData {
    leadId: string;
    name: string;
    email: string;
    phone?: string;
    address?: string;
    source: string;
    decision: string;
    score: number;
    intake: LeadIntake | null;
    identityUnverified?: boolean;
    detailUrl: string;
}

/**
 * Render puro del email al admin. TODOS los campos procedentes del visitante
 * se escapan (antes nombre, email, teléfono, ciudad… se interpolaban en
 * crudo → inyección HTML en el buzón del admin).
 *
 * Los adjuntos ya no se enlazan (son privados): se indica cuántos hay y se
 * remite al dashboard, que genera URLs firmadas de corta duración.
 */
export function renderAdminLeadEmail(d: AdminLeadEmailData): { subject: string; html: string } {
    const e = escapeHtml;
    const sourceLabel = SOURCE_LABELS[d.source] || d.source;
    const decisionLabel = DECISION_LABELS[d.decision] || d.decision;
    const intake = d.intake;
    const attachmentsCount = intake?.imageUrls?.length || 0;

    const imagesBlock = attachmentsCount
        ? `<p><strong>Archivos adjuntos:</strong> ${attachmentsCount} (consúltalos en el dashboard).</p>`
        : '';

    const suspiciousBlock = intake?.suspicious
        ? `<p style="background:#fff4d4;padding:8px;border-left:3px solid #f0a800;">
             ⚠️ <strong>Atención:</strong> el sanitizer detectó patrones de prompt injection en este mensaje.
           </p>`
        : '';

    const unverifiedBlock = d.identityUnverified
        ? `<p style="background:#fde8e8;padding:8px;border-left:3px solid #d93025;">
             ⚠️ <strong>Identidad NO verificada:</strong> la solicitud usa el email de un lead existente pero el
             visitante no tenía sesión verificada. No se ha modificado el lead; se ha creado un Deal marcado
             como no verificado. Confirma la identidad antes de tratarla como del mismo cliente.
           </p>`
        : '';

    const subject = `[Grupo RG] Nuevo lead — ${decisionLabel} — ${d.name}`.replace(/[\r\n]+/g, ' ').slice(0, 200);
    const html = `
        <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; max-width: 640px; line-height: 1.6;">
            <h2 style="margin-bottom: 4px;">Nuevo lead capturado</h2>
            <p style="color:#666;margin-top:0;">Origen: ${e(sourceLabel)} · Score: ${e(d.score)}/100</p>
            ${unverifiedBlock}
            ${suspiciousBlock}
            <h3>Cliente${d.identityUnverified ? ' (datos declarados)' : ''}</h3>
            <ul>
                <li><strong>Nombre:</strong> ${e(d.name)}</li>
                <li><strong>Email:</strong> ${e(d.email)}</li>
                <li><strong>Teléfono:</strong> ${d.phone ? e(d.phone) : '—'}</li>
                ${d.address ? `<li><strong>Dirección:</strong> ${e(d.address)}</li>` : ''}
            </ul>
            ${intake ? `
            <h3>Solicitud</h3>
            <ul>
                <li><strong>Tipo de obra:</strong> ${e(intake.projectType)}</li>
                ${intake.approxSquareMeters ? `<li><strong>Superficie aprox.:</strong> ${e(intake.approxSquareMeters)} m²</li>` : ''}
                ${intake.qualityLevel ? `<li><strong>Calidad:</strong> ${e(intake.qualityLevel)}</li>` : ''}
                ${intake.postalCode ? `<li><strong>Código postal:</strong> ${e(intake.postalCode)}</li>` : ''}
                ${intake.city ? `<li><strong>Ciudad:</strong> ${e(intake.city)}</li>` : ''}
                ${intake.timeline ? `<li><strong>Plazo:</strong> ${e(intake.timeline)}</li>` : ''}
                ${intake.approxBudget ? `<li><strong>Presupuesto cliente:</strong> ${e(intake.approxBudget)} €</li>` : ''}
            </ul>
            <p><strong>Descripción:</strong></p>
            <blockquote style="border-left:3px solid #ddd;padding-left:12px;color:#444;white-space:pre-wrap;">${e(intake.description)}</blockquote>
            ${imagesBlock}
            ` : ''}
            <hr style="border:none;border-top:1px solid #eaeaea;margin:20px 0;" />
            <p>
                <a href="${e(d.detailUrl)}" style="background:#1a1a1a;color:#fff;padding:10px 18px;text-decoration:none;border-radius:6px;display:inline-block;">
                    Ver lead en el dashboard
                </a>
            </p>
            <p style="color:#888;font-size:12px;">Lead ID: <code>${e(d.leadId)}</code></p>
        </div>
    `;
    return { subject, html };
}

/**
 * Listener: envía un email al admin cada vez que se registra un lead nuevo
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
        const unverified = event.identityUnverified === true;

        const { subject, html } = renderAdminLeadEmail({
            leadId: lead.id,
            // Caso no verificado: mostramos lo DECLARADO y el intake del evento,
            // no los datos del lead existente.
            name: unverified ? event.leadName : lead.personalInfo.name,
            email: unverified ? event.leadEmail : lead.personalInfo.email,
            phone: unverified ? undefined : lead.personalInfo.phone,
            address: unverified ? undefined : lead.personalInfo.address,
            source: event.source,
            decision: event.decision,
            score: event.score,
            intake: event.intakeSnapshot || lead.intake,
            identityUnverified: unverified,
            detailUrl: `${baseUrl}/dashboard/leads/${encodeURIComponent(lead.id)}`,
        });

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

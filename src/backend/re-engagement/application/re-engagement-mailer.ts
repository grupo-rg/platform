import 'server-only';
import { ResendEmailService } from '@/backend/shared/infrastructure/messaging/resend-email.service';
import type { ReEngagementScheduleEntry, ReEngagementAttempt } from '../domain/schedule-entry';

/**
 * Plantillas de re-engagement por intento. Tono progresivo:
 *  - Attempt 1 (día 2): recordatorio amistoso "¿necesitas ayuda?"
 *  - Attempt 2 (día 5): aporta valor (caso de obra similar) + CTA agenda
 *  - Attempt 3 (día 10): última llamada antes de archivar
 *
 * El locale por ahora es ES; dejamos hooks para EN/CA fáciles de añadir.
 */

interface Template {
    subject: string;
    intro: string;
    body: string;
    ctaLabel: string;
    closing: string;
}

const TEMPLATES_ES: Record<ReEngagementAttempt, Template> = {
    1: {
        subject: '¿Pudiste revisar tu solicitud de presupuesto?',
        intro: 'Hace un par de días recibimos tu solicitud y queríamos asegurarnos de que ha llegado bien.',
        body: 'Si necesitas que repasemos algún detalle, ajustar el alcance, o simplemente quieres comentar el proyecto antes de avanzar, agenda 15 minutos con un asesor sin compromiso.',
        ctaLabel: 'Agendar una llamada',
        closing: 'Estamos aquí para ayudarte a decidir lo que mejor encaja con tu obra.',
    },
    2: {
        subject: 'Cómo trabajamos las reformas en Mallorca',
        intro: 'Te escribo para compartirte cómo abordamos cada obra en Grupo RG.',
        body:
            'Cada proyecto empieza con una visita técnica para entender la propiedad, su estado y tus prioridades. ' +
            'Tras esa visita preparamos un presupuesto detallado por capítulos (demoliciones, instalaciones, acabados…) y un calendario realista. ' +
            'Si tu obra encaja en nuestro alcance, podemos avanzar siempre con el mismo equipo y la mano de obra cualificada local.',
        ctaLabel: 'Hablar con un asesor',
        closing: 'Si quieres que revisemos juntos tu solicitud, responde a este email o agenda directamente.',
    },
    3: {
        subject: '¿Seguimos adelante con tu reforma?',
        intro: 'Han pasado un par de semanas desde tu solicitud y aún no nos hemos puesto en contacto contigo de forma directa.',
        body:
            'Si tu proyecto sigue activo y quieres que avancemos juntos, basta con responder a este email indicando un buen momento para hablar — o agendar tú mismo el horario que prefieras. ' +
            'Si por el contrario ya no necesitas presupuesto, también nos puedes responder con un "no procede" para liberarte de futuros recordatorios.',
        ctaLabel: 'Reservar un hueco',
        closing: 'Gracias por considerar a Grupo RG para tu obra.',
    },
};

function getTemplate(locale: string, attempt: ReEngagementAttempt): Template {
    // Por ahora todos los locales caen a ES. Cuando se añadan EN/CA/DE/NL,
    // pasar `TEMPLATES_<LOCALE>` aquí en función del locale.
    return TEMPLATES_ES[attempt];
}

function buildBaseUrl(): string {
    return (
        process.env.NEXT_PUBLIC_SITE_URL || 'https://constructoresenmallorca.com'
    ).replace(/\/$/, '');
}

function renderHtml(name: string, locale: string, template: Template): string {
    const ctaUrl = `${buildBaseUrl()}/${locale}/contacto`;
    const safeName = escapeHtml(name || 'hola');
    return `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"></head>
<body style="margin:0; padding:24px; background:#f5f5f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color:#1f2937;">
  <div style="max-width:560px; margin:0 auto; background:white; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="padding:24px 28px; background:linear-gradient(135deg, #0f172a 0%, #334155 100%); color:white;">
      <p style="margin:0; font-size:12px; letter-spacing:0.06em; text-transform:uppercase; opacity:0.7;">Grupo RG · Constructores en Mallorca</p>
    </div>
    <div style="padding:28px;">
      <p style="margin:0 0 14px;">Hola ${safeName},</p>
      <p style="margin:0 0 14px; line-height:1.55;">${escapeHtml(template.intro)}</p>
      <p style="margin:0 0 20px; line-height:1.55;">${escapeHtml(template.body)}</p>
      <p style="margin:24px 0;">
        <a href="${ctaUrl}" style="display:inline-block; padding:12px 22px; background:#0f172a; color:white; text-decoration:none; border-radius:8px; font-weight:600;">${escapeHtml(template.ctaLabel)}</a>
      </p>
      <p style="margin:0; line-height:1.55; color:#475569;">${escapeHtml(template.closing)}</p>
    </div>
    <div style="padding:16px 28px; background:#f8fafc; border-top:1px solid #e2e8f0; font-size:12px; color:#64748b;">
      Grupo RG · Mallorca · constructoresenmallorca.com
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export class ReEngagementMailer {
    /**
     * Envía la plantilla correspondiente al `attempt` de la entry.
     * Devuelve true si Resend aceptó el envío (o lo intentó); false si
     * NOT_CONFIGURED o error duro. Los errores transitorios ya tienen
     * retry interno en `ResendEmailService`.
     */
    async send(entry: ReEngagementScheduleEntry): Promise<boolean> {
        const template = getTemplate(entry.locale, entry.attempt);
        const html = renderHtml(entry.leadName, entry.locale, template);
        const result = await ResendEmailService.send({
            to: entry.leadEmail,
            subject: template.subject,
            html,
            tags: [
                { name: 'lead_id', value: entry.leadId },
                { name: 'event', value: 're_engagement' },
                { name: 'attempt', value: String(entry.attempt) },
            ],
        });
        if (result.error) {
            console.error(
                `[ReEngagement] Email attempt=${entry.attempt} a ${entry.leadEmail} falló: ${result.error}`
            );
            return result.error === 'NOT_CONFIGURED' ? false : false;
        }
        return true;
    }
}

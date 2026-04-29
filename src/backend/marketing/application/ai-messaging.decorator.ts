import { MessagingService } from "./messaging.service";
import { MARKETING_TEMPLATES } from "../domain/marketing-templates";
import { marked } from "marked";

/**
 * Decorator (Interceptor Pattern) para reescribir mensajes usando Gemini
 */
export class AIMessagingDecorator implements MessagingService {
    constructor(private readonly innerService: MessagingService) {}

    async sendEmail(leadId: string, templateId: string, variables: Record<string, string>): Promise<void> {
        // En lugar de enviar un prompt ciego, reescribimos sobre la plantilla maestra institucional
        const dynamicCopy = await this.rewriteWithGemini(templateId, variables);
        
        // Transformar la respuesta (que suele venir en Markdown de Gemini) a HTML robusto
        const parsedHtml = await marked.parse(dynamicCopy);
        
        await this.innerService.sendEmail(leadId, templateId, { 
            textBody: dynamicCopy,
            htmlBody: parsedHtml 
        });
    }

    async sendWhatsApp(phone: string, templateId: string, variables: Record<string, string>): Promise<void> {
        const dynamicCopy = await this.rewriteWithGemini(templateId, variables);
        await this.innerService.sendWhatsApp(phone, 'ai_dynamic_body', { body_text: dynamicCopy });
    }

    private async rewriteWithGemini(templateId: string, leadVariables: Record<string, string>): Promise<string> {
        // Fallback robusto al Diccionario de Plantillas Maestras
        let baseTemplate = MARKETING_TEMPLATES[templateId] || MARKETING_TEMPLATES['nurturing_pain_budget'];
        
        // 1. Interpolación manual base antes de inyectar a la IA
        baseTemplate = baseTemplate.replace('{{name}}', leadVariables.name || 'Cliente');
        
        // Inyectar Rutas y Enlaces Críticos (Pre-procesamiento Determinista)
        const urlParams = leadVariables.email ? `?email=\${encodeURIComponent(leadVariables.email)}&name=\${encodeURIComponent(leadVariables.name || '')}` : '';
        const agendaLink = `https://basis.consultoria.systems/es\${urlParams}#agenda`;
        const demoPath = 'https://basis.consultoria.systems/es/dashboard/asistente';
        
        const agendaBtnHtml = `\\n<a href="\${agendaLink}" style="display:inline-block; padding:12px 24px; background-color:#2563EB; color:#ffffff; font-weight:800; border-radius:6px; text-decoration:none; margin-top:8px;" target="_blank">Agendar Evaluación Gratis</a>\\n`;
        
        baseTemplate = baseTemplate.replaceAll('[ENLACE A TU EVALUACIÓN TÉCNICA GRATUITA]', agendaBtnHtml);
        baseTemplate = baseTemplate.replaceAll('[ENLACE A LA AUDITORÍA TÉCNICA GRATUITA]', agendaBtnHtml);
        baseTemplate = baseTemplate.replaceAll('[ENLACE A AGENDA]', agendaBtnHtml);
        baseTemplate = baseTemplate.replaceAll('[ENLACE AL MODO EDITOR COMPLETO]', demoPath);
        
        // Meet URL proveniente del Evento de Calendar u otros metadatos inyectados vía Enrollment.context
        if (leadVariables.meetUrl) {
            baseTemplate = baseTemplate.replaceAll('[ENLACE A LA REUNIÓN ZOOM/MEET]', leadVariables.meetUrl);
        } else {
            baseTemplate = baseTemplate.replaceAll('[ENLACE A LA REUNIÓN ZOOM/MEET]', 'https://meet.google.com/fallback-link'); // fallback
        }

        const systemInstruction = `Eres un experto consultor B2B empresarial de Inteligencia Artificial (Basis). 
Tu misión es ADAPTAR LIGERAMENTE la siguiente [PLANTILLA COMPLETA] basándote en la radiografía del cliente.
Debes reescribir y DEVOLVER TODO EL CORREO COMPLETO, de principio a fin, manteniendo la estructura pero ajustando los dolores al perfil del cliente.

[RADIOGRAFÍA DEL CLIENTE]: 
${JSON.stringify(leadVariables)}

[PLANTILLA COMPLETA A REESCRIBIR]:
${baseTemplate}

REGLAS ESTRICTAS E INQUEBRANTABLES:
1. TU RESPUESTA DEBE SER TODO EL CORREO ELECTRÓNICO COMPLETO. No cortes el mensaje a la mitad.
2. NUNCA respondas cosas como "Aquí tienes la adaptación". Empieza directamente con el saludo "Hola [Nombre]".
3. INCLUYE SIEMPRE EL ENLACE o la invitación final a la "Evaluación Técnica Gratuita". Si omites esto, el sistema fallará.
4. Nunca ofrezcas "SaaS" o "Módulos". La venta es "Desarrollo de Capa a Medida" o "Infraestructura IA".
5. Mantén la longitud estrictamente similar a la plantilla original (aprox 100-150 palabras). Usa Markdown (Negritas, cursivas).`;

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.warn("[AI Decorator] GEMINI_API_KEY no encontrada. Redirigiendo fallback estático.");
            return baseTemplate;
        }

        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `Reescribe y devuelve el EMAIL COMPLETO de principio a fin adaptado a mi perfil ahora mismo.` }] }],
                    systemInstruction: { parts: [{ text: systemInstruction }] },
                    generationConfig: { temperature: 0.35 } // Eliminado el maxOutputTokens limitante
                })
            });
            
            if (!res.ok) {
                throw new Error(`Error en la request de IA: ${res.statusText}`);
            }

            const raw = await res.json();
            return raw.candidates?.[0]?.content?.parts?.[0]?.text || baseTemplate;
        } catch (error) {
            console.error("[AI Decorator] Fallo severo durante Inference con Gemini:", error);
            return baseTemplate;
        }
    }
}

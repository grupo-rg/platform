import 'server-only';
import type { Lead } from '../domain/lead';

const PROJECT_TYPE_LABEL: Record<string, string> = {
    bathroom: 'reforma de baño',
    kitchen: 'reforma de cocina',
    integral: 'reforma integral',
    new_build: 'obra nueva',
    pool: 'piscina',
    other: 'proyecto a definir',
};

const TIMELINE_LABEL: Record<string, string> = {
    asap: 'lo antes posible',
    '1-3m': '1-3 meses',
    '3-6m': '3-6 meses',
    '6m+': 'más de 6 meses',
};

/**
 * Convierte el intake del lead (incluida la rawFormData del wizard si existe)
 * en un brief narrativo en lenguaje natural que el agente Arquitecto del
 * `BudgetWizardChat` puede entender como punto de partida para refinar.
 *
 * El brief se inyecta como `initialPrompt` del widget context y el wizard lo
 * envía como primer mensaje. El agente lo procesa y empieza la conversación
 * para completar lagunas (m² por estancia, calidades, materiales, etc.).
 */
export function buildLeadBrief(lead: Lead): string {
    const intake = lead.intake;
    if (!intake) {
        return `Quiero generar un presupuesto para ${lead.personalInfo.name}. ` +
               `No tengo datos de la obra todavía — vamos a recopilarlos.`;
    }

    const lines: string[] = [];
    const projectLabel = PROJECT_TYPE_LABEL[intake.projectType] || intake.projectType;

    lines.push(
        `Soy admin de Grupo RG y voy a refinar contigo la solicitud de un cliente real. ` +
        `Te paso el contexto que ya tenemos del lead y vamos a iterarlo hasta tener un brief listo para presupuestar.`
    );
    lines.push('');
    lines.push(`**Cliente:** ${lead.personalInfo.name} <${lead.personalInfo.email}>` +
        (lead.personalInfo.phone ? ` · ${lead.personalInfo.phone}` : ''));
    lines.push('');
    lines.push(`**Tipo de obra:** ${projectLabel}`);

    if (intake.approxSquareMeters) {
        lines.push(`**Superficie aprox.:** ${intake.approxSquareMeters} m²`);
    }
    if (intake.qualityLevel) {
        lines.push(`**Calidad solicitada:** ${intake.qualityLevel}`);
    }
    const location = [intake.postalCode, intake.city].filter(Boolean).join(' · ');
    if (location) {
        lines.push(`**Ubicación:** ${location}`);
    }
    if (intake.timeline) {
        lines.push(`**Plazo:** ${TIMELINE_LABEL[intake.timeline] || intake.timeline}`);
    }
    if (intake.approxBudget) {
        lines.push(`**Presupuesto declarado:** ${intake.approxBudget.toLocaleString('es-ES')} €`);
    }
    if ((intake.imageUrls || []).length > 0) {
        lines.push(`**Adjuntos:** ${intake.imageUrls.length} imagen(es) — disponibles en el detalle del lead.`);
    }

    if (intake.description?.trim()) {
        lines.push('');
        lines.push(`**Descripción del cliente:**`);
        lines.push(`> ${intake.description.trim()}`);
    }

    // Si el lead vino de un formulario detallado, añadimos los campos crudos
    // para que el agente pueda usar specs concretos (m² por estancia, flags…).
    if (intake.rawFormData && Object.keys(intake.rawFormData).length > 0) {
        const interesting = Object.entries(intake.rawFormData).filter(([k, v]) => {
            if (['name', 'email', 'phone', 'address', 'description', 'files', 'visualizations', 'testEmail'].includes(k)) return false;
            if (v === null || v === undefined || v === '') return false;
            if (Array.isArray(v) && v.length === 0) return false;
            if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return false;
            return true;
        });
        if (interesting.length > 0) {
            lines.push('');
            lines.push(`**Datos del formulario (en bruto):**`);
            for (const [k, v] of interesting) {
                const valueStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
                lines.push(`- ${k}: ${valueStr.length > 120 ? valueStr.slice(0, 117) + '…' : valueStr}`);
            }
        }
    }

    lines.push('');
    lines.push(
        `Por favor, **resume lo que entiendes del proyecto** y dime qué información ` +
        `crítica nos falta para arrancar el presupuesto (m² por estancia, materiales, ` +
        `calidades específicas, demoliciones, instalaciones a renovar, etc.).`
    );

    return lines.join('\n');
}

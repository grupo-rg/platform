/**
 * Consentimientos RGPD de un Lead.
 *
 * Cada vez que el visitante marca (o desmarca) una casilla de consentimiento
 * en un formulario público / chat / verificación OTP se añade una entrada al
 * array `lead.consents`. Es un LOG append-only: nunca se borra una entrada,
 * la última entrada de cada `type` es la que manda.
 *
 *  - `privacy`   → "He leído la política de privacidad". Obligatorio para
 *                  registrar una solicitud (base: medidas precontractuales,
 *                  pero dejamos constancia de que se informó — art. 13 RGPD).
 *  - `marketing` → Comunicaciones comerciales (LSSI art. 21 + RGPD art. 6.1.a).
 *                  OPCIONAL y nunca premarcado.
 */

export type LeadConsentType = 'privacy' | 'marketing';

export type LeadConsentSource =
    | 'quick_form'
    | 'detailed_form'
    | 'new_build_form'
    | 'chat_public'
    | 'identity_form'
    | 'admin';

export interface LeadConsent {
    type: LeadConsentType;
    granted: boolean;
    at: Date;
    source: LeadConsentSource;
    /** Versión del texto mostrado al usuario (ver CONSENT_TEXT_VERSIONS). */
    textVersion: string;
    /** IP desde la que se otorgó (si se pudo determinar). */
    ip?: string;
}

/**
 * Versión de los textos legales que se muestran junto a las casillas. Si el
 * texto de la política o de la casilla cambia de forma sustancial, sube la
 * versión: los consentimientos antiguos quedan registrados con la anterior.
 *
 * Fuente de verdad: el SERVIDOR. El cliente nunca envía la versión.
 */
export const CONSENT_TEXT_VERSIONS: Record<LeadConsentType, string> = {
    privacy: 'privacy-2026-10-07',
    marketing: 'marketing-2026-10-07',
};

/** Lo que el cliente declara (casillas marcadas). */
export interface ConsentDeclaration {
    privacyAccepted: boolean;
    marketingAccepted?: boolean;
}

export function buildConsents(
    declaration: ConsentDeclaration,
    source: LeadConsentSource,
    ip?: string,
    now: Date = new Date()
): LeadConsent[] {
    const out: LeadConsent[] = [
        {
            type: 'privacy',
            granted: declaration.privacyAccepted === true,
            at: now,
            source,
            textVersion: CONSENT_TEXT_VERSIONS.privacy,
            ...(ip ? { ip } : {}),
        },
    ];
    // La casilla de marketing siempre se registra (granted true/false) para
    // poder demostrar que NO se otorgó si alguien lo cuestiona.
    out.push({
        type: 'marketing',
        granted: declaration.marketingAccepted === true,
        at: now,
        source,
        textVersion: CONSENT_TEXT_VERSIONS.marketing,
        ...(ip ? { ip } : {}),
    });
    return out;
}

/** Última entrada registrada de un tipo (o null). */
export function latestConsent(consents: LeadConsent[] | undefined, type: LeadConsentType): LeadConsent | null {
    if (!consents || consents.length === 0) return null;
    let latest: LeadConsent | null = null;
    for (const c of consents) {
        if (c.type !== type) continue;
        if (!latest || c.at.getTime() >= latest.at.getTime()) latest = c;
    }
    return latest;
}

/**
 * Añade consentimientos a la lista evitando entradas redundantes: si la
 * última entrada del mismo tipo tiene el mismo `granted` y `textVersion`, no
 * se duplica (el log registra CAMBIOS, no cada envío de formulario).
 */
export function mergeConsents(existing: LeadConsent[] | undefined, incoming: LeadConsent[]): LeadConsent[] {
    const result = [...(existing || [])];
    for (const c of incoming) {
        const last = latestConsent(result, c.type);
        if (last && last.granted === c.granted && last.textVersion === c.textVersion) continue;
        result.push(c);
    }
    return result;
}

/**
 * ¿Puede este lead recibir comunicaciones comerciales?
 *
 * Aplicar ANTES de enrolar a un lead en cualquier secuencia de marketing /
 * nurturing (no en emails transaccionales: OTP, confirmación de cita,
 * envío de presupuesto solicitado). Puntos de aplicación pendientes:
 *   - src/backend/marketing/application/enroll-lead-in-sequence.usecase.ts
 *     (secuencias de nurturing)
 *   - src/backend/marketing/application/trigger-sequences.usecase.ts
 *   - src/backend/re-engagement/application/schedule-on-lead-created.usecase.ts
 *     (si los emails de re-engagement se consideran comerciales — revisar
 *     con asesoría legal; con LSSI art. 21.2 sólo cabe sin consentimiento
 *     si hay relación contractual previa).
 */
export function hasMarketingConsent(lead: { consents?: LeadConsent[] } | null | undefined): boolean {
    const last = latestConsent(lead?.consents, 'marketing');
    return !!last && last.granted === true;
}

export function hasPrivacyConsent(lead: { consents?: LeadConsent[] } | null | undefined): boolean {
    const last = latestConsent(lead?.consents, 'privacy');
    return !!last && last.granted === true;
}

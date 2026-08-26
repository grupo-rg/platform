/**
 * Datos de contacto públicos de la empresa.
 *
 * La fuente canónica sigue siendo `CompanyConfig` (Firestore → Ajustes > Empresa).
 * Estas constantes son el *fallback* de código: se usan cuando ese valor aún no
 * está configurado y en componentes cliente, que no pueden leer Firestore.
 *
 * Cualquier teléfono público debe salir de aquí — no hardcodear números en las
 * páginas / componentes.
 */

/** Formato E.164, apto para `tel:`, `wa.me` y JSON-LD. */
export const CONTACT_PHONE_E164 = '+34663955854';

/** Formato legible para mostrar en pantalla. */
export const CONTACT_PHONE_DISPLAY = '+34 663 955 854';

/** `href` listo para un enlace de llamada. */
export const CONTACT_PHONE_HREF = `tel:${CONTACT_PHONE_E164}`;

/** Número sin `+` ni espacios, tal y como lo espera wa.me. */
export const CONTACT_WHATSAPP_NUMBER = CONTACT_PHONE_E164.replace(/[^0-9]/g, '');

/** Enlace directo a WhatsApp. */
export const CONTACT_WHATSAPP_URL = `https://wa.me/${CONTACT_WHATSAPP_NUMBER}`;

/**
 * Enlace a WhatsApp con mensaje pre-rellenado.
 */
export function buildWhatsappUrl(message?: string): string {
    if (!message) return CONTACT_WHATSAPP_URL;
    return `${CONTACT_WHATSAPP_URL}?text=${encodeURIComponent(message)}`;
}

/**
 * Convierte un teléfono en cualquier formato ("+34 663 955 854") en un `href`
 * válido de llamada. Si no se pasa nada, devuelve el teléfono corporativo.
 */
export function telHref(phone?: string | null): string {
    const raw = (phone ?? CONTACT_PHONE_E164).trim();
    if (!raw) return CONTACT_PHONE_HREF;
    const normalized = raw.replace(/[^\d+]/g, '');
    return `tel:${normalized}`;
}

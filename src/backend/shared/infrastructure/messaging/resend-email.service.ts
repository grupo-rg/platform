import 'server-only';
import { Resend } from 'resend';

export interface ResendSendInput {
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
    from?: string;
    replyTo?: string;
    /** Cabeceras para tracking idempotente (e.g. lead-id, booking-id). */
    tags?: { name: string; value: string }[];
}

/**
 * Punto único de envío de email de toda la app. Usa Resend API (no SMTP),
 * ideal para Vercel y compatible con dominios propios verificados.
 *
 * Variables de entorno requeridas:
 *   - RESEND_API_KEY        (e.g. "re_xxx")
 *   - RESEND_FROM_EMAIL     (e.g. "Grupo RG <noreply@constructoresenmallorca.com>")
 *                            — el dominio debe estar verificado en Resend.
 */
export class ResendEmailService {
    private static _client: Resend | null = null;

    private static getClient(): Resend {
        if (!ResendEmailService._client) {
            const key = process.env.RESEND_API_KEY;
            if (!key) {
                throw new Error('RESEND_API_KEY no configurado');
            }
            ResendEmailService._client = new Resend(key);
        }
        return ResendEmailService._client;
    }

    static getDefaultFrom(): string {
        return (
            process.env.RESEND_FROM_EMAIL ||
            'Grupo RG <onboarding@resend.dev>'
        );
    }

    /**
     * Envía un email con reintentos automáticos para errores transitorios
     * (NETWORK_ERROR, PROVIDER_ERROR, RATE_LIMITED suave). Errores
     * permanentes (clave inválida, dominio no verificado, validación) no se
     * reintentan — fallarían igual.
     *
     * Retries: 3 intentos máximos con backoff 0ms / 600ms / 1800ms. Total
     * peor caso ~3 × timeout SDK ≈ 30s, pero típicamente el segundo o tercer
     * intento sí completa cuando el problema es DNS lento o un microcorte.
     */
    static async send(input: ResendSendInput): Promise<{ id: string | null; error: ResendSendError | null }> {
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
            console.warn('[ResendEmailService] RESEND_API_KEY ausente — email NO enviado:', input.subject);
            return { id: null, error: 'NOT_CONFIGURED' };
        }

        const maxAttempts = 3;
        const backoffsMs = [0, 600, 1800];
        let lastError: ResendSendError | null = null;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (backoffsMs[attempt]! > 0) {
                await sleep(backoffsMs[attempt]!);
            }

            const result = await this.tryOnce(input);
            if (result.id) {
                if (attempt > 0) {
                    console.log(`[ResendEmailService] Email enviado en el intento ${attempt + 1}/${maxAttempts}`);
                }
                return result;
            }

            lastError = result.error;
            // Sólo reintentamos errores transitorios.
            if (lastError !== 'NETWORK_ERROR' && lastError !== 'PROVIDER_ERROR') {
                return result;
            }
            console.warn(`[ResendEmailService] Intento ${attempt + 1}/${maxAttempts} falló con ${lastError} — reintentando…`);
        }

        return { id: null, error: lastError };
    }

    private static async tryOnce(input: ResendSendInput): Promise<{ id: string | null; error: ResendSendError | null }> {
        try {
            const client = this.getClient();
            const result = await client.emails.send({
                from: input.from || this.getDefaultFrom(),
                to: input.to,
                subject: input.subject,
                html: input.html,
                ...(input.text ? { text: input.text } : {}),
                ...(input.replyTo ? { replyTo: input.replyTo } : {}),
                ...(input.tags ? { tags: input.tags } : {}),
            });

            if (result.error) {
                console.error('[ResendEmailService] Error de Resend:', result.error);
                return { id: null, error: classifyResendError(result.error) };
            }
            return { id: result.data?.id || null, error: null };
        } catch (err) {
            console.error('[ResendEmailService] Excepción enviando email:', err);
            return { id: null, error: 'NETWORK_ERROR' };
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export type ResendSendError =
    | 'NOT_CONFIGURED'        // RESEND_API_KEY no está en env
    | 'NETWORK_ERROR'         // No se pudo alcanzar api.resend.com (firewall, DNS, VPN)
    | 'INVALID_API_KEY'       // 401/403
    | 'DOMAIN_NOT_VERIFIED'   // El FROM usa un subdominio no verificado en Resend
    | 'VALIDATION_ERROR'      // Otros 4xx
    | 'RATE_LIMITED'          // 429
    | 'PROVIDER_ERROR';       // 5xx u otros

function classifyResendError(err: any): ResendSendError {
    const msg = String(err?.message || '').toLowerCase();
    const code = err?.statusCode;
    if (code === 401 || code === 403 || /api[ _-]?key/.test(msg)) return 'INVALID_API_KEY';
    if (code === 422 && /domain|verified/.test(msg)) return 'DOMAIN_NOT_VERIFIED';
    if (code === 429) return 'RATE_LIMITED';
    // Resend devuelve `statusCode: null` cuando ni siquiera pudo hacer el fetch
    // (problemas de red local, DNS, firewall, antivirus haciendo MITM).
    if (code === null || code === undefined) return 'NETWORK_ERROR';
    if (typeof code === 'number' && code >= 500) return 'PROVIDER_ERROR';
    return 'VALIDATION_ERROR';
}

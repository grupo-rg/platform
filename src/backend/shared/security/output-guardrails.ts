import 'server-only';

const MAX_REPLY_LENGTH = 4000;
const REJECTION_MARKER = '[REJECTED_INJECTION]';
const CANNED_REJECTION_REPLY =
    'Sólo puedo ayudarte con presupuestos de reforma y construcción. ¿En qué obra estás pensando?';

export interface GuardrailResult {
    reply: string;
    triggered: boolean;
    reason?: 'rejection_marker' | 'length_exceeded';
}

/**
 * Última línea de defensa antes de devolver la respuesta del agente al
 * usuario. Detecta:
 *  - Token `[REJECTED_INJECTION]` que el system prompt instruye al modelo
 *    devolver cuando detecta intento de jailbreak.
 *  - Respuestas que exceden la longitud razonable (truncado defensivo).
 */
export function applyOutputGuardrails(rawReply: string): GuardrailResult {
    if (!rawReply) {
        return { reply: '', triggered: false };
    }

    if (rawReply.includes(REJECTION_MARKER)) {
        return {
            reply: CANNED_REJECTION_REPLY,
            triggered: true,
            reason: 'rejection_marker',
        };
    }

    if (rawReply.length > MAX_REPLY_LENGTH) {
        return {
            reply: rawReply.slice(0, MAX_REPLY_LENGTH - 3) + '…',
            triggered: true,
            reason: 'length_exceeded',
        };
    }

    return { reply: rawReply, triggered: false };
}

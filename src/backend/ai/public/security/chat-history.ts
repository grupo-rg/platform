/**
 * Saneado del historial del chat público ANTES de pasarlo al modelo.
 *
 * El historial lo envía el navegador, así que es input no confiable:
 *  - Sólo se aceptan roles `user` y `model` (`assistant` se normaliza a
 *    `model`). Cualquier `system`, `tool` u otro rol se DESCARTA: antes un
 *    visitante podía inyectar mensajes `system` con instrucciones.
 *  - Sólo partes de texto (nada de `media`, `toolRequest`, `toolResponse`…).
 *  - Longitud máxima por mensaje, nº máximo de mensajes y presupuesto total.
 *  - Se eliminan los delimitadores `<user_input>` que el agente usa para
 *    separar datos de instrucciones, y los mensajes de usuario se vuelven a
 *    envolver en ellos.
 */

export const MAX_HISTORY_MESSAGES = 30;
export const MAX_HISTORY_MESSAGE_CHARS = 2000;
export const MAX_HISTORY_TOTAL_CHARS = 24_000;

export interface SafeHistoryMessage {
    role: 'user' | 'model';
    content: { text: string }[];
}

const DELIMITER_RE = /<\s*\/?\s*user_input\s*>/gi;

export function stripInputDelimiters(text: string): string {
    return text.replace(DELIMITER_RE, '');
}

export function wrapUserInput(text: string): string {
    return `<user_input>\n${stripInputDelimiters(text)}\n</user_input>`;
}

function extractText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    const parts: string[] = [];
    for (const part of content) {
        if (part && typeof part === 'object' && typeof (part as any).text === 'string') {
            parts.push((part as any).text);
        }
    }
    return parts.join('\n');
}

export function sanitizeChatHistory(raw: unknown): SafeHistoryMessage[] {
    if (!Array.isArray(raw)) return [];

    const cleaned: SafeHistoryMessage[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const rawRole = (item as any).role;
        const role: 'user' | 'model' | null =
            rawRole === 'user' ? 'user' : rawRole === 'model' || rawRole === 'assistant' ? 'model' : null;
        if (!role) continue;

        let text = stripInputDelimiters(extractText((item as any).content)).trim();
        if (!text) continue;
        if (text.length > MAX_HISTORY_MESSAGE_CHARS) text = text.slice(0, MAX_HISTORY_MESSAGE_CHARS);

        cleaned.push({ role, content: [{ text: role === 'user' ? wrapUserInput(text) : text }] });
    }

    // Últimos N mensajes y presupuesto total (descartando los más antiguos).
    let recent = cleaned.slice(-MAX_HISTORY_MESSAGES);
    let total = recent.reduce((acc, m) => acc + m.content[0].text.length, 0);
    while (recent.length > 0 && total > MAX_HISTORY_TOTAL_CHARS) {
        total -= recent[0].content[0].text.length;
        recent = recent.slice(1);
    }
    return recent;
}

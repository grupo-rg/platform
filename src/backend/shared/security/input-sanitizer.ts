import 'server-only';

/**
 * Patrones comunes de prompt injection. Se detectan y se marca `suspicious=true`
 * (no se bloquea: el agente sigue respondiendo, pero el lead llega al admin
 * con bandera para revisión y el system prompt usa delimitadores defensivos).
 */
const INJECTION_PATTERNS: RegExp[] = [
    /ignore (all |the )?(previous|above|prior) (instructions|prompts?|rules)/i,
    /disregard (all |the )?(previous|above|prior)/i,
    /you are now\b/i,
    /act as (?:a |an )?(?:dan|developer|admin|root)/i,
    /system\s*:/i,
    /<\s*\/?\s*sys(?:tem)?\s*>/i,
    /<\|im_(?:start|end)\|>/i,
    /jailbreak/i,
    /reveal (?:your )?(?:system )?prompt/i,
    /tu prompt del sistema/i,
    /olvida (?:todo lo |las )?(?:anterior|instrucciones)/i,
    /ign[oó]ralo todo/i,
];

// Caracteres de control ASCII y DEL
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;
// Zero-width / formatting (ZWSP, ZWNJ, ZWJ, LRM/RLM, LRE/RLE/PDF/LRO/RLO, BOM)
const ZERO_WIDTH = /[​-‏‪-‮﻿]/g;

export interface SanitizedText {
    text: string;
    suspicious: boolean;
    matchedPatterns: string[];
}

/**
 * Limpia texto de control/zero-width chars, recorta a maxLength y marca como
 * sospechoso si detecta patrones de prompt injection.
 */
export function sanitizeUserText(raw: string, maxLength: number = 5000): SanitizedText {
    const cleaned = (raw || '')
        .replace(CONTROL_CHARS, ' ')
        .replace(ZERO_WIDTH, '')
        .trim()
        .slice(0, maxLength);

    const matched: string[] = [];
    for (const re of INJECTION_PATTERNS) {
        if (re.test(cleaned)) matched.push(re.source);
    }

    return {
        text: cleaned,
        suspicious: matched.length > 0,
        matchedPatterns: matched,
    };
}

/**
 * Ids de modelo Gemini + configuración de generación POR FAMILIA (2.5 vs 3.x).
 *
 * Punto único para que Genkit (`ai.generate`) y `@google/genai`
 * (`client.models.generateContent`) manden la config correcta según el modelo.
 * Ambos usan los mismos nombres de campo (`temperature`, `maxOutputTokens`,
 * `thinkingConfig.thinkingLevel`), así que un único helper sirve para los dos.
 *
 * Reparto aprobado (migración Gemini 3.x, 2026-09):
 *  - PRO  `gemini-3.1-pro-preview` → lo que razona (arquitecto / orquestador).
 *  - FLASH `gemini-3.5-flash`      → volumen (chat, extracción, transcripción,
 *                                     marketing, SEO, triage...).
 *  - IMAGE `gemini-3.1-flash-image` (render). Embeddings SIN cambio.
 *
 * Gemini 3.x — recomendaciones oficiales aplicadas
 * (https://ai.google.dev/gemini-api/docs/gemini-3 , /thinking):
 *  - Temperatura: "we strongly recommend keeping the temperature parameter at its
 *    default value of 1.0"; bajarla "may lead to unexpected behavior, such as
 *    looping or degraded performance" → en 3.x NO se envía `temperature`
 *    (override de emergencia: env `GEMINI3_TEMPERATURE`).
 *  - Thinking: se controla con `thinkingLevel` (NO `thinkingBudget`: enviar ambos
 *    → 400, verificado). No se puede apagar del todo. Defaults: Flash → `LOW`
 *    (env `GEMINI_FLASH_THINKING_LEVEL`), Pro → `MEDIUM` (env
 *    `GEMINI_PRO_THINKING_LEVEL`). El plugin Genkit 1.27 solo acepta
 *    LOW/MEDIUM/HIGH, así que `minimal` se mapea a `LOW`.
 *  - `maxOutputTokens` INCLUYE el thinking en 3.x → se suma margen por nivel.
 *  - 2.5: config INTACTA (rollback = volver a un id `gemini-2.5-*`).
 */

export const GEMINI_FLASH_MODEL = 'gemini-3.5-flash';
export const GEMINI_PRO_MODEL = 'gemini-3.1-pro-preview';
export const GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image';
/** Embeddings: sin cambio (cambiarlo exige re-vectorizar Firestore @768). */
export const EMBEDDING_MODEL_ID = 'gemini-embedding-001';
export const EMBEDDING_DIMENSIONS = 768;

export type GeminiThinkingLevel = 'LOW' | 'MEDIUM' | 'HIGH';

type ModelLike = string | { name?: string } | null | undefined;

/** Id "desnudo" (`gemini-3.5-flash`) a partir de un id, `vertexai/...` o un ModelReference. */
export function bareModelId(model: ModelLike): string {
    const raw = typeof model === 'string' ? model : model?.name ?? '';
    return raw.replace(/^(vertexai|googleai)\//, '').replace(/^models\//, '').trim().toLowerCase();
}

export function isGemini3Family(model: ModelLike): boolean {
    return bareModelId(model).startsWith('gemini-3');
}

export function isProModel(model: ModelLike): boolean {
    return bareModelId(model).includes('-pro');
}

export function isImageModel(model: ModelLike): boolean {
    return bareModelId(model).includes('-image');
}

function envLevel(name: string, fallback: GeminiThinkingLevel): GeminiThinkingLevel {
    const raw = (process.env[name] || '').trim().toUpperCase();
    if (raw === 'LOW' || raw === 'MEDIUM' || raw === 'HIGH') return raw;
    if (raw === 'MINIMAL') return 'LOW';
    return fallback;
}

/** `thinkingLevel` por defecto para un modelo 3.x (undefined si no aplica). */
export function defaultThinkingLevel(model: ModelLike): GeminiThinkingLevel | undefined {
    if (!isGemini3Family(model) || isImageModel(model)) return undefined;
    return isProModel(model)
        ? envLevel('GEMINI_PRO_THINKING_LEVEL', 'MEDIUM')
        : envLevel('GEMINI_FLASH_THINKING_LEVEL', 'LOW');
}

export interface GeminiConfigInput {
    temperature?: number | null;
    maxOutputTokens?: number | null;
    /** Fuerza un nivel (p.ej. `HIGH` para una tarea concreta). Ignorado en 2.5. */
    thinkingLevel?: GeminiThinkingLevel;
    [key: string]: unknown;
}

/**
 * Config de generación para `model`, partiendo de la config "histórica" del
 * call site (`base`). 2.5 → `base` tal cual (sin `thinkingLevel`). 3.x → quita
 * `temperature` (rige 1.0) y añade `thinkingConfig.thinkingLevel`.
 * Los `null` se eliminan (vienen de `params` del registry).
 */
export function geminiConfig(model: ModelLike, base: GeminiConfigInput = {}): Record<string, any> {
    const { thinkingLevel, temperature, ...rest } = base;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(rest)) {
        if (v !== null && v !== undefined) out[k] = v;
    }

    if (!isGemini3Family(model)) {
        if (temperature !== null && temperature !== undefined) out.temperature = temperature;
        return out;
    }

    const override = Number.parseFloat(process.env.GEMINI3_TEMPERATURE || '');
    if (Number.isFinite(override)) out.temperature = override;

    const level = isImageModel(model) ? undefined : thinkingLevel ?? defaultThinkingLevel(model);
    if (level && !out.thinkingConfig) {
        out.thinkingConfig = { thinkingLevel: level };
    }
    // En 3.x `maxOutputTokens` INCLUYE el thinking (verificado: 3.5-flash LOW con
    // max=64 → MAX_TOKENS sin texto). El límite del call site se trata como
    // presupuesto de RESPUESTA y se le suma margen de thinking.
    const effectiveLevel = (out.thinkingConfig?.thinkingLevel as GeminiThinkingLevel | undefined) ?? level;
    if (typeof out.maxOutputTokens === 'number' && effectiveLevel) {
        out.maxOutputTokens = Math.min(
            MAX_OUTPUT_TOKENS_CAP,
            out.maxOutputTokens + (THINKING_HEADROOM[effectiveLevel] ?? 8192),
        );
    }
    return out;
}

const THINKING_HEADROOM: Record<GeminiThinkingLevel, number> = { LOW: 2048, MEDIUM: 8192, HIGH: 16384 };
const MAX_OUTPUT_TOKENS_CAP = 65536;

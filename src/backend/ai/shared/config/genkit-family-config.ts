import type { Genkit } from 'genkit';
import { geminiConfig } from './gemini-models';

/**
 * Aplica la config POR FAMILIA de Gemini (ver `geminiConfig`) a TODAS las
 * llamadas `ai.generate` / `ai.generateStream` de una instancia Genkit.
 *
 * Por qué centralizarlo aquí: hay ~40 call sites que pasan configs pensadas
 * para 2.5 (`temperature: 0.1`, sin thinking). En Gemini 3.x Google desaconseja
 * bajar la temperatura (riesgo de bucles) y el thinking se controla con
 * `thinkingLevel`. En vez de tocar cada call site (y olvidar alguno), la
 * instancia normaliza la config según el modelo efectivo de la petición:
 *   - 2.5 → config intacta (rollback trivial).
 *   - 3.x → sin `temperature` + `thinkingConfig.thinkingLevel` por defecto
 *     (salvo que el call site ya pase `thinkingConfig`).
 *
 * No cubre `ai.prompt()`/dotprompt (usan otra ruta interna): los `.prompt`
 * llevan su config 3.x en el frontmatter.
 */
export function withGeminiFamilyConfig<T extends Genkit>(ai: T, defaultModel?: string): T {
    const normalize = (opts: any) => {
        if (!opts || typeof opts !== 'object' || Array.isArray(opts) || typeof opts.then === 'function') {
            return opts;
        }
        const model = opts.model ?? defaultModel;
        if (!model) return opts;
        return { ...opts, config: geminiConfig(model, opts.config ?? {}) };
    };
    const originalGenerate = ai.generate.bind(ai);
    const originalGenerateStream = ai.generateStream.bind(ai);
    (ai as any).generate = (opts: any) => originalGenerate(normalize(opts));
    (ai as any).generateStream = (opts: any) => originalGenerateStream(normalize(opts));
    return ai;
}

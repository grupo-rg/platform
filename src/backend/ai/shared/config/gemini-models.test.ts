import { afterEach, describe, expect, it } from 'vitest';
import {
    bareModelId,
    defaultThinkingLevel,
    geminiConfig,
    isGemini3Family,
} from './gemini-models';

const ENV_KEYS = ['GEMINI_FLASH_THINKING_LEVEL', 'GEMINI_PRO_THINKING_LEVEL', 'GEMINI3_TEMPERATURE'];

afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
});

describe('gemini-models — config por familia', () => {
    it('normaliza ids y detecta la familia 3.x', () => {
        expect(bareModelId('vertexai/gemini-3.5-flash')).toBe('gemini-3.5-flash');
        expect(bareModelId({ name: 'vertexai/gemini-3.1-pro-preview' })).toBe('gemini-3.1-pro-preview');
        expect(isGemini3Family('models/gemini-3.5-flash')).toBe(true);
        expect(isGemini3Family('gemini-2.5-flash')).toBe(false);
    });

    it('2.5: la config histórica queda intacta (rollback)', () => {
        expect(geminiConfig('vertexai/gemini-2.5-flash', { temperature: 0.1, maxOutputTokens: 10 })).toEqual({
            temperature: 0.1,
            maxOutputTokens: 10,
        });
    });

    it('3.x: sin temperatura, con thinkingLevel por rol y margen de thinking en maxOutputTokens', () => {
        expect(geminiConfig('gemini-3.5-flash', { temperature: 0.1 })).toEqual({
            thinkingConfig: { thinkingLevel: 'LOW' },
        });
        expect(geminiConfig('gemini-3.1-pro-preview', { temperature: 0.1, maxOutputTokens: 1000 })).toEqual({
            maxOutputTokens: 1000 + 8192,
            thinkingConfig: { thinkingLevel: 'MEDIUM' },
        });
    });

    it('respeta thinkingConfig explícito, safetySettings y quita nulls del registry', () => {
        const safety = [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }];
        expect(
            geminiConfig('gemini-3.5-flash', {
                temperature: null,
                maxOutputTokens: null,
                safetySettings: safety,
                thinkingConfig: { thinkingLevel: 'HIGH' },
            }),
        ).toEqual({ safetySettings: safety, thinkingConfig: { thinkingLevel: 'HIGH' } });
    });

    it('imagen 3.x: sin thinking', () => {
        expect(geminiConfig('gemini-3.1-flash-image', { temperature: 0.4 })).toEqual({});
    });

    it('overrides por env (MINIMAL → LOW por el enum de Genkit 1.27; temperatura de emergencia)', () => {
        process.env.GEMINI_FLASH_THINKING_LEVEL = 'minimal';
        process.env.GEMINI_PRO_THINKING_LEVEL = 'high';
        process.env.GEMINI3_TEMPERATURE = '0.8';
        expect(defaultThinkingLevel('gemini-3.5-flash')).toBe('LOW');
        expect(defaultThinkingLevel('gemini-3.1-pro-preview')).toBe('HIGH');
        expect(geminiConfig('gemini-3.5-flash', { temperature: 0 }).temperature).toBe(0.8);
    });
});

/**
 * Sprint 3 — S3-09 — tests del helper `chapterFromCode`.
 *
 * `chapterFromCode` agrupa correction_pairs por capítulo del catálogo. Si la
 * heurística rompe, el heatmap del dashboard sale sucio. Cubrimos:
 *   - Codes con `.` (formato COAATMCA típico, e.g. "EDM01.05").
 *   - Codes con `-` (placeholders como "GENERIC-EXPLICIT").
 *   - Codes sin separador.
 *   - Codes vacíos / null / undefined → "UNKNOWN".
 *   - Codes puramente numéricos → "UNKNOWN" (no son códigos válidos).
 */
import { describe, it, expect } from 'vitest';

import { chapterFromCode } from './get-model-health.action';

describe('chapterFromCode', () => {
    it('extracts chapter from COAATMCA-style code with dot', () => {
        expect(chapterFromCode('EDM01.05')).toBe('EDM01');
        expect(chapterFromCode('D01.05')).toBe('D01');
        expect(chapterFromCode('REV03.12.04')).toBe('REV03');
    });

    it('extracts prefix from dashed placeholder codes', () => {
        expect(chapterFromCode('GENERIC-EXPLICIT')).toBe('GENERIC');
        expect(chapterFromCode('FROM-SCRATCH')).toBe('FROM');
    });

    it('returns whole code (uppercased) when there is no separator', () => {
        expect(chapterFromCode('ED')).toBe('ED');
        expect(chapterFromCode('edm')).toBe('EDM');
    });

    it('returns UNKNOWN for empty / null / undefined', () => {
        expect(chapterFromCode('')).toBe('UNKNOWN');
        expect(chapterFromCode('   ')).toBe('UNKNOWN');
        expect(chapterFromCode(null)).toBe('UNKNOWN');
        expect(chapterFromCode(undefined)).toBe('UNKNOWN');
    });

    it('returns UNKNOWN when prefix is purely numeric', () => {
        expect(chapterFromCode('123.45')).toBe('UNKNOWN');
        expect(chapterFromCode('9999')).toBe('UNKNOWN');
    });

    it('uppercases lowercase codes', () => {
        expect(chapterFromCode('edm01.05')).toBe('EDM01');
    });
});

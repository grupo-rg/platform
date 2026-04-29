/**
 * Fase 5.F — tests de los sub-componentes del panel de auditoría v005.
 *
 * Ejecutan en Node puro vía `react-dom/server.renderToStaticMarkup` — sin jsdom,
 * sin testing-library. Usamos `React.createElement` en lugar de JSX porque la
 * config actual de Vitest 4 + rolldown no tiene un loader JSX configurado y
 * añadir uno excede el alcance de esta fase.
 *
 * Invariantes cubiertos:
 *   1. Los tres sub-componentes devuelven `null` cuando los datos v005 faltan
 *      (retrocompatibilidad con presupuestos históricos, cero-regresión).
 *   2. Cuando los datos están, el HTML contiene los testids + labels esperados.
 *   3. La fórmula de conversión respeta el orden `valor unidad × bridge = resultado`.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';

import {
    MatchKindChip,
    UnitConversionApplied,
    CandidateMetaBadges,
    formatBridge,
    AppliedFragmentsBadge,
} from './audit-v005';

const h = React.createElement;

describe('MatchKindChip', () => {
    it('returns null when matchKind is undefined (legacy partida)', () => {
        const html = renderToStaticMarkup(h(MatchKindChip, { matchKind: undefined }));
        expect(html).toBe('');
    });

    it.each([
        ['1:1', '1:1 exacto'],
        ['1:N', '1:N compuesto'],
        ['from_scratch', 'Desde cero'],
    ] as const)('renders chip for matchKind=%s with label %s', (kind, label) => {
        const html = renderToStaticMarkup(h(MatchKindChip, { matchKind: kind }));
        expect(html).toContain('data-testid="match-kind-chip"');
        expect(html).toContain(`data-match-kind="${kind}"`);
        expect(html).toContain(label);
    });
});

describe('UnitConversionApplied', () => {
    it('returns null when record is undefined', () => {
        const html = renderToStaticMarkup(h(UnitConversionApplied, { record: undefined }));
        expect(html).toBe('');
    });

    it('renders thickness bridge formula', () => {
        const html = renderToStaticMarkup(
            h(UnitConversionApplied, {
                record: {
                    value: 50,
                    from_unit: 'm2',
                    to_unit: 'm3',
                    bridge: { thickness_m: 0.1 },
                    result: 5,
                },
            })
        );
        expect(html).toContain('data-testid="unit-conversion-applied"');
        expect(html).toContain('Conversión de unidad aplicada');
        expect(html).toContain('50 m2');
        expect(html).toContain('espesor 0.1 m');
        expect(html).toContain('5 m3');
    });

    it('renders density bridge formula', () => {
        const html = renderToStaticMarkup(
            h(UnitConversionApplied, {
                record: {
                    value: 2,
                    from_unit: 'm3',
                    to_unit: 'kg',
                    bridge: { density_kg_m3: 2400 },
                    result: 4800,
                },
            })
        );
        expect(html).toContain('densidad 2400 kg/m³');
        expect(html).toContain('4800 kg');
    });

    it('falls back gracefully for unknown bridge keys', () => {
        const formula = formatBridge({ unknown_key: 0.5 });
        expect(formula).toContain('unknown_key');
        expect(formula).toContain('0.5');
    });
});

describe('CandidateMetaBadges', () => {
    it('returns null when candidate has no v005 meta', () => {
        const html = renderToStaticMarkup(h(CandidateMetaBadges, { candidate: {} }));
        expect(html).toBe('');
    });

    it('renders score as "score 0.87" with 2 decimals', () => {
        const html = renderToStaticMarkup(
            h(CandidateMetaBadges, { candidate: { matchScore: 0.872 } })
        );
        expect(html).toContain('data-testid="candidate-score"');
        expect(html).toContain('score 0.87');
    });

    it('falls back to `score` field when `matchScore` is absent', () => {
        const html = renderToStaticMarkup(
            h(CandidateMetaBadges, { candidate: { score: 0.55 } })
        );
        expect(html).toContain('score 0.55');
    });

    it('renders the rejected_reason badge', () => {
        const html = renderToStaticMarkup(
            h(CandidateMetaBadges, {
                candidate: { rejected_reason: 'unidad incompatible m2/m3 sin bridge' },
            })
        );
        expect(html).toContain('data-testid="candidate-rejected-reason"');
        expect(html).toContain('unidad incompatible m2/m3 sin bridge');
    });

    it('renders kind badge (item vs breakdown)', () => {
        const htmlItem = renderToStaticMarkup(
            h(CandidateMetaBadges, { candidate: { kind: 'item' } })
        );
        expect(htmlItem).toContain('data-testid="candidate-kind"');
        expect(htmlItem).toContain('>item<');

        const htmlBreakdown = renderToStaticMarkup(
            h(CandidateMetaBadges, { candidate: { kind: 'breakdown' } })
        );
        expect(htmlBreakdown).toContain('>breakdown<');
    });

    it('renders all three badges together', () => {
        const html = renderToStaticMarkup(
            h(CandidateMetaBadges, {
                candidate: {
                    kind: 'breakdown',
                    matchScore: 0.92,
                    rejected_reason: 'descartado por precio fuera de rango',
                },
            })
        );
        expect(html).toContain('data-testid="candidate-kind"');
        expect(html).toContain('data-testid="candidate-score"');
        expect(html).toContain('data-testid="candidate-rejected-reason"');
    });
});

describe('AppliedFragmentsBadge', () => {
    it('returns null when fragments prop is undefined', () => {
        const html = renderToStaticMarkup(
            h(AppliedFragmentsBadge, { fragments: undefined })
        );
        expect(html).toBe('');
    });

    it('returns null when fragments is an empty list', () => {
        const html = renderToStaticMarkup(h(AppliedFragmentsBadge, { fragments: [] }));
        expect(html).toBe('');
    });

    it('renders singular phrasing when exactly one fragment', () => {
        const html = renderToStaticMarkup(
            h(AppliedFragmentsBadge, { fragments: ['frag-abc'] })
        );
        expect(html).toContain('data-testid="applied-fragments-badge"');
        expect(html).toContain('1 corrección previa');
    });

    it('renders plural phrasing when 2+ fragments', () => {
        const html = renderToStaticMarkup(
            h(AppliedFragmentsBadge, { fragments: ['frag-a', 'frag-b', 'frag-c'] })
        );
        expect(html).toContain('3 correcciones previas');
    });

    it('surfaces fragment ids in the title attribute for auditability', () => {
        const html = renderToStaticMarkup(
            h(AppliedFragmentsBadge, { fragments: ['frag-a', 'frag-b'] })
        );
        expect(html).toContain('frag-a');
        expect(html).toContain('frag-b');
    });
});

/**
 * Fase 10.2 — helper puro `computeBudgetStats(subEvents)`.
 *
 * Deriva contadores/PEM agregados a partir del array de SubEvent acumulado
 * por `BudgetGenerationProgress` durante la generación. Permite que el
 * `BudgetSummaryBar` los muestre en vivo (incremental) y al cerrar (final).
 */
import { describe, it, expect } from 'vitest';
import { computeBudgetStats } from './budget-summary-stats';
import type { SubEvent } from '@/components/budget/budget-generation-events';

function _ev(partial: Partial<SubEvent> & { id: string; title: string }): SubEvent {
    return { kind: 'info', ts: 0, ...partial };
}

describe('computeBudgetStats', () => {
    it('returns zeros when no events', () => {
        const s = computeBudgetStats([]);
        expect(s.partidasCount).toBe(0);
        expect(s.chaptersCount).toBe(0);
        expect(s.pemTotal).toBe(0);
        expect(s.anomaliesCount).toBe(0);
    });

    it('counts partidas resolved across multiple events', () => {
        const subs: SubEvent[] = [
            _ev({ id: '1', kind: 'resolved', title: 'C01.01 Demolición', detail: '✓ €120' }),
            _ev({ id: '2', kind: 'resolved', title: 'C01.02 Otra', detail: '✓ €450' }),
            _ev({ id: '3', kind: 'resolved', title: 'C02.01 Albañilería', detail: '✓ €1.200' }),
        ];
        const s = computeBudgetStats(subs);
        expect(s.partidasCount).toBe(3);
    });

    it('extracts chapter prefix from resolved title and counts distinct', () => {
        const subs: SubEvent[] = [
            _ev({ id: '1', kind: 'resolved', title: 'C01.01 X', detail: '✓ €1' }),
            _ev({ id: '2', kind: 'resolved', title: 'C01.02 Y', detail: '✓ €2' }),
            _ev({ id: '3', kind: 'resolved', title: 'C02.01 Z', detail: '✓ €3' }),
            _ev({ id: '4', kind: 'resolved', title: 'C04.05 W', detail: '✓ €4' }),
        ];
        const s = computeBudgetStats(subs);
        expect(s.chaptersCount).toBe(3); // C01, C02, C04
    });

    it('aggregates pemTotal from price detail strings (es-ES locale)', () => {
        const subs: SubEvent[] = [
            _ev({ id: '1', kind: 'resolved', title: 'A', detail: '✓ 1.200,50 €' }),
            _ev({ id: '2', kind: 'resolved', title: 'B', detail: '✓ 350 €' }),
            _ev({ id: '3', kind: 'resolved', title: 'C', detail: '✓ 50.000,00 €' }),
        ];
        const s = computeBudgetStats(subs);
        expect(s.pemTotal).toBeCloseTo(51550.50, 2);
    });

    it('counts anomalies from kind=error events', () => {
        const subs: SubEvent[] = [
            _ev({ id: '1', kind: 'resolved', title: 'A', detail: '✓ €100' }),
            _ev({ id: '2', kind: 'error', title: '⚠ Precio anómalo: X' }),
            _ev({ id: '3', kind: 'error', title: 'Descripción corta: Y' }),
            _ev({ id: '4', kind: 'error', title: 'Página fallida' }),
        ];
        const s = computeBudgetStats(subs);
        expect(s.anomaliesCount).toBe(3);
    });

    it('formats pemTotal with es-ES currency formatter', () => {
        const subs: SubEvent[] = [
            _ev({ id: '1', kind: 'resolved', title: 'A', detail: '✓ 12.345,67 €' }),
        ];
        const s = computeBudgetStats(subs);
        // El Intl formatter con maximumFractionDigits=0 redondea a 12.346 €.
        expect(s.formattedPem).toMatch(/12\.?34[56]/);
        expect(s.formattedPem).toMatch(/€/);
    });

    it('parses es-ES thousands without decimals correctly (regression)', () => {
        // El Intl formatter es-ES con maximumFractionDigits=0 emite "1.500 €",
        // "12.345 €", "95.980 €" etc. — el punto es thousands separator, NO decimal.
        // Si lo parseamos con parseFloat directo, 1.500 → 1.5 (perdemos factor 1000).
        const subs: SubEvent[] = [
            _ev({ id: '1', kind: 'resolved', title: 'A', detail: '✓ 1.500 €' }),
            _ev({ id: '2', kind: 'resolved', title: 'B', detail: '✓ 12.345 €' }),
            _ev({ id: '3', kind: 'resolved', title: 'C', detail: '✓ 95.980 €' }),
        ];
        const s = computeBudgetStats(subs);
        expect(s.pemTotal).toBeCloseTo(1500 + 12345 + 95980, 2);
    });

    it('handles missing detail gracefully', () => {
        const subs: SubEvent[] = [
            _ev({ id: '1', kind: 'resolved', title: 'C01.01 Sin precio' }),
            // El Intl formatter es-ES emite "100 €" (número primero, € al final).
            _ev({ id: '2', kind: 'resolved', title: 'C01.02 X', detail: '✓ 100 €' }),
        ];
        const s = computeBudgetStats(subs);
        expect(s.partidasCount).toBe(2);
        expect(s.pemTotal).toBeCloseTo(100, 2);
    });
});

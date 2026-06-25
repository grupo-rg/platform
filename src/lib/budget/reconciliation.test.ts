import { describe, it, expect } from 'vitest';
import {
    mapCatalogToBreakdown,
    scaleBreakdownToUnitPrice,
    buildRepairedBreakdown,
    detectDivergence,
    type NormalizedCatalogComponent,
} from './reconciliation';

// Subconjunto representativo del descompuesto de RSG010h (COAATMCA), incluido
// el componente `%` (medios auxiliares) cuyo total de línea NO es unitPrice×qty.
const RSG010H: NormalizedCatalogComponent[] = [
    { code: 'mt09mcr021h', description: 'Adhesivo cementoso', quantity: 6, unitPrice: 0.7, lineTotal: 4.2 },
    { code: 'mt18bcp010ah', description: 'Baldosa cerámica', quantity: 1.05, unitPrice: 42.35, lineTotal: 44.47, is_variable: true },
    { code: 'mt08cem040a', description: 'Cemento blanco', quantity: 1, unitPrice: 0.33, lineTotal: 0.33 },
    { code: 'mo023', description: 'Oficial 1ª solador', quantity: 0.9, unitPrice: 19.11, lineTotal: 17.2 },
    { code: 'mo061', description: 'Ayudante solador', quantity: 0.449, unitPrice: 18.39, lineTotal: 8.26 },
    { code: '%', description: 'Medios auxiliares', quantity: 2, unitPrice: 74.46, lineTotal: 1.49 },
];

const sumTotals = (comps: { total?: number }[]) => comps.reduce((s, c) => s + (c.total || 0), 0);

describe('mapCatalogToBreakdown', () => {
    it('usa el total de línea del catálogo (clave para `%`)', () => {
        const mapped = mapCatalogToBreakdown(RSG010H);
        const pct = mapped.find((c) => c.code === '%');
        // `%` = 1.49 (total de línea), NO unitPrice×qty (74.46×2 = 148.92).
        expect(pct?.total).toBe(1.49);
    });

    it('clasifica el tipo por prefijo de código', () => {
        const mapped = mapCatalogToBreakdown(RSG010H);
        expect(mapped.find((c) => c.code === 'mo023')?.type).toBe('LABOR');
        expect(mapped.find((c) => c.code === 'mt08cem040a')?.type).toBe('MATERIAL');
        expect(mapped.find((c) => c.code === '%')?.type).toBe('OTHER');
    });
});

describe('buildRepairedBreakdown', () => {
    it('escala el descompuesto del catálogo para que sume el unitPrice baked', () => {
        const unitPrice = 122.51; // baked = raw 98.01 × ~1.25
        const repaired = buildRepairedBreakdown(RSG010H, unitPrice);
        // Suma ~= unitPrice (tolerancia de céntimo por redondeo).
        expect(Math.abs(sumTotals(repaired) - unitPrice)).toBeLessThanOrEqual(0.05);
    });

    it('preserva las proporciones entre componentes', () => {
        const rawSum = RSG010H.reduce((s, c) => s + c.lineTotal, 0);
        const repaired = buildRepairedBreakdown(RSG010H, 122.51);
        const baldosa = repaired.find((c) => c.code === 'mt18bcp010ah')!;
        // La baldosa sigue siendo ~44.47/rawSum del total tras escalar.
        const expectedShare = (44.47 / rawSum) * 122.51;
        expect(Math.abs(baldosa.total! - expectedShare)).toBeLessThanOrEqual(0.05);
    });

    it('el descompuesto reparado ya no genera divergencia', () => {
        const unitPrice = 122.51;
        const repaired = buildRepairedBreakdown(RSG010H, unitPrice);
        const line: any = { id: 'x', item: { unitPrice, quantity: 10, breakdown: repaired } };
        expect(detectDivergence(line).hasDivergence).toBe(false);
    });
});

describe('scaleBreakdownToUnitPrice', () => {
    it('escala un descompuesto existente no-cero al unitPrice', () => {
        const comps = mapCatalogToBreakdown(RSG010H); // sum ~75.95
        const scaled = scaleBreakdownToUnitPrice(comps, 100);
        expect(Math.abs(sumTotals(scaled) - 100)).toBeLessThanOrEqual(0.05);
    });

    it('no toca un descompuesto que suma 0 (no se puede escalar)', () => {
        const zero = [{ code: 'mt1', concept: 'x', type: 'MATERIAL' as const, price: 0, total: 0, yield: 1 }];
        const scaled = scaleBreakdownToUnitPrice(zero as any, 100);
        expect(sumTotals(scaled)).toBe(0);
    });
});

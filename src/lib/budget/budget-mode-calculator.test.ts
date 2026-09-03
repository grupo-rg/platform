/**
 * Fase 11.D — Tests vitest del helper de modos (espejo del test Python).
 */
import { describe, it, expect } from 'vitest';
import {
    BreakdownCategory,
    categorizeComponent,
} from './breakdown-category';
import {
    BudgetMode,
    computePartidaTotalForMode,
    computePartidaTotalForModeDetailed,
    computeUnitPriceForMode,
    computeUnitPriceForModeDetailed,
    executionModeToBudgetMode,
} from './budget-mode-calculator';

describe('categorizeComponent — 3 señales', () => {
    it('prevalece code prefix sobre type LLM-erróneo', () => {
        expect(categorizeComponent('mo123', 'MATERIAL', true)).toBe(BreakdownCategory.LABOR);
    });

    it('cae a type cuando no hay code prefix conocido', () => {
        expect(categorizeComponent('ABC123', 'LABOR', false)).toBe(BreakdownCategory.LABOR);
    });

    it('mt* + is_variable=true → MATERIAL_VARIABLE', () => {
        expect(categorizeComponent('mt51grout', null, true)).toBe(BreakdownCategory.MATERIAL_VARIABLE);
    });

    it('mt* + is_variable=false/null → MATERIAL_FIXED', () => {
        expect(categorizeComponent('mt51grout', null, false)).toBe(BreakdownCategory.MATERIAL_FIXED);
        expect(categorizeComponent('mt51grout', null, null)).toBe(BreakdownCategory.MATERIAL_FIXED);
    });

    it('% y ci* → INDIRECT', () => {
        expect(categorizeComponent('%01', null, null)).toBe(BreakdownCategory.INDIRECT);
        expect(categorizeComponent('ci-001', null, null)).toBe(BreakdownCategory.INDIRECT);
    });

    it('señales totalmente desconocidas → OTHER', () => {
        expect(categorizeComponent(null, null, null)).toBe(BreakdownCategory.OTHER);
        expect(categorizeComponent('XYZ', 'WEIRD', null)).toBe(BreakdownCategory.OTHER);
    });
});

const REPRESENTATIVE_BREAKDOWN = [
    { code: 'mo112', type: 'LABOR', is_variable: false, total: 50.0 },
    { code: 'mt51grout', type: 'MATERIAL', is_variable: true, total: 100.0 },
    { code: 'mq05pdm', type: 'MACHINERY', is_variable: false, total: 20.0 },
];

describe('computeUnitPriceForMode', () => {
    it('LABOR_ONLY filtra solo mo*', () => {
        expect(computeUnitPriceForMode(REPRESENTATIVE_BREAKDOWN, 170, BudgetMode.LABOR_ONLY)).toBe(50);
    });

    it('LABOR_AND_FIXED excluye solo MATERIAL_VARIABLE', () => {
        expect(computeUnitPriceForMode(REPRESENTATIVE_BREAKDOWN, 170, BudgetMode.LABOR_AND_FIXED)).toBe(70);
    });

    it('COMPLETE incluye todo', () => {
        expect(computeUnitPriceForMode(REPRESENTATIVE_BREAKDOWN, 170, BudgetMode.COMPLETE)).toBe(170);
    });

    it('breakdown vacío + COMPLETE → fallbackUnitPrice', () => {
        expect(computeUnitPriceForMode(null, 42, BudgetMode.COMPLETE)).toBe(42);
        expect(computeUnitPriceForMode([], 42, BudgetMode.COMPLETE)).toBe(42);
    });

    it('breakdown vacío + modos parciales → 0', () => {
        expect(computeUnitPriceForMode(null, 42, BudgetMode.LABOR_ONLY)).toBe(0);
        expect(computeUnitPriceForMode([], 42, BudgetMode.LABOR_AND_FIXED)).toBe(0);
    });

    it('respeta totalPrice/price+yield aliases', () => {
        const breakdown = [
            { code: 'mo112', totalPrice: 25, type: 'LABOR' },
            { code: 'mt51', price: 10, yield: 3, type: 'MATERIAL', is_variable: false },
        ];
        const result = computeUnitPriceForMode(breakdown, 999, BudgetMode.LABOR_AND_FIXED);
        expect(result).toBe(55);  // 25 + 10*3
    });
});

describe('computePartidaTotalForMode', () => {
    it('multiplica unit_price por quantity', () => {
        const total = computePartidaTotalForMode(REPRESENTATIVE_BREAKDOWN, 170, 10, BudgetMode.LABOR_ONLY);
        expect(total).toBe(500);
    });
});

describe('unidad % (medios auxiliares) — ×qty/100', () => {
    it('sin total guardado, unit "%" aplica price × qty/100', () => {
        // % medios auxiliares → categoría INDIRECT (incluida en COMPLETE y LABOR_AND_FIXED).
        const breakdown = [
            { code: 'mo112', total: 100, type: 'LABOR', is_variable: false },
            { code: '%0201', unit: '%', price: 100, quantity: 3, type: 'OTHER' }, // 100 × 3/100 = 3
        ];
        // LABOR_AND_FIXED incluye INDIRECT → 100 + 3 = 103 (NO 100 + 300).
        expect(computeUnitPriceForMode(breakdown, 999, BudgetMode.LABOR_AND_FIXED)).toBe(103);
    });

    it('unit "%" con total guardado usa el total (autoritativo, sin /100)', () => {
        const breakdown = [
            { code: '%0201', unit: '%', price: 100, quantity: 3, total: 2.5, type: 'OTHER' },
        ];
        expect(computeUnitPriceForMode(breakdown, 999, BudgetMode.COMPLETE)).toBe(2.5);
    });

    it('sin unit "%" mantiene price × qty', () => {
        const breakdown = [{ code: 'mt51', price: 10, quantity: 3, type: 'MATERIAL', is_variable: false }];
        expect(computeUnitPriceForMode(breakdown, 999, BudgetMode.LABOR_AND_FIXED)).toBe(30);
    });
});

describe('isApproximate — nunca infravalorar en silencio', () => {
    const BASIC_ONLY = [
        { code: 'mo112', type: 'LABOR', total: 50, is_variable: false },
        { code: 'mt51', type: 'MATERIAL', total: 100, is_variable: false },
    ];
    // Partida compuesta (DRA010) sin prefijo básico y type OTHER → categoría OTHER.
    const WITH_COMPOSITE = [
        { code: 'mo112', type: 'LABOR', total: 50, is_variable: false },
        { code: 'DRA010', type: 'OTHER', total: 200 },
    ];

    it('descompuesto de básicos NO es aproximado en modos parciales', () => {
        expect(computeUnitPriceForModeDetailed(BASIC_ONLY, 150, BudgetMode.LABOR_ONLY).isApproximate).toBe(false);
        expect(computeUnitPriceForModeDetailed(BASIC_ONLY, 150, BudgetMode.LABOR_AND_FIXED).isApproximate).toBe(false);
    });

    it('COMPLETE nunca es aproximado (suma todo)', () => {
        expect(computeUnitPriceForModeDetailed(WITH_COMPOSITE, 250, BudgetMode.COMPLETE).isApproximate).toBe(false);
    });

    it('partida compuesta (OTHER) marca aproximado en modos parciales', () => {
        expect(computeUnitPriceForModeDetailed(WITH_COMPOSITE, 250, BudgetMode.LABOR_ONLY).isApproximate).toBe(true);
        expect(computeUnitPriceForModeDetailed(WITH_COMPOSITE, 250, BudgetMode.LABOR_AND_FIXED).isApproximate).toBe(true);
    });

    it('compuesta con mano de obra un nivel abajo: LABOR_ONLY no da 0 silencioso → aproximado', () => {
        const detailed = computePartidaTotalForModeDetailed(WITH_COMPOSITE, 250, 2, BudgetMode.LABOR_ONLY);
        // Solo el mo112 (50) se cuenta; el compuesto queda fuera pero se marca aproximado.
        expect(detailed.total).toBe(100); // 50 × 2
        expect(detailed.isApproximate).toBe(true);
    });

    it('sin descompuesto + modo parcial + precio real → aproximado (agregado no desglosable)', () => {
        expect(computeUnitPriceForModeDetailed(null, 300, BudgetMode.LABOR_ONLY).isApproximate).toBe(true);
        expect(computeUnitPriceForModeDetailed([], 300, BudgetMode.LABOR_AND_FIXED).isApproximate).toBe(true);
    });

    it('sin descompuesto + COMPLETE → exacto (fallbackUnitPrice)', () => {
        const detailed = computePartidaTotalForModeDetailed(null, 300, 2, BudgetMode.COMPLETE);
        expect(detailed.total).toBe(600);
        expect(detailed.isApproximate).toBe(false);
    });
});

describe('executionModeToBudgetMode', () => {
    it('mapea los nombres legacy del editor', () => {
        expect(executionModeToBudgetMode('complete')).toBe(BudgetMode.COMPLETE);
        expect(executionModeToBudgetMode('execution')).toBe(BudgetMode.LABOR_AND_FIXED);
        expect(executionModeToBudgetMode('labor')).toBe(BudgetMode.LABOR_ONLY);
    });

    it('valores desconocidos caen a COMPLETE por defecto', () => {
        expect(executionModeToBudgetMode(null)).toBe(BudgetMode.COMPLETE);
        expect(executionModeToBudgetMode('xyz')).toBe(BudgetMode.COMPLETE);
    });
});

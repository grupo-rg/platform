import { describe, it, expect } from 'vitest';
import { resolveMaterialFactor } from './material-price-resolver';
import type { MaterialPriceRule } from '@/backend/material-catalog/domain/material-price-rule';

/**
 * Paridad con el lado Python: estos 8 casos deben coincidir exactamente con la
 * suite del resolver Python. No cambiar los valores esperados sin coordinar.
 */

function makeRule(partial: Partial<MaterialPriceRule> & Pick<MaterialPriceRule, 'id' | 'scope' | 'adjustmentPct'>): MaterialPriceRule {
    return {
        target: {},
        active: true,
        createdBy: 'test',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedBy: 'test',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...partial,
    };
}

// Reglas base (todas active salvo donde el caso lo indique).
const r1 = makeRule({ id: 'r1', scope: 'global', adjustmentPct: 5 });
const r2 = makeRule({ id: 'r2', scope: 'category', adjustmentPct: 10, target: { category: 'Materiales de construcción' } });
const r3 = makeRule({ id: 'r3', scope: 'material', adjustmentPct: 20, target: { sku: '104562' } });
const r4 = makeRule({ id: 'r4', scope: 'client', adjustmentPct: 8, target: { leadId: 'L1' } });
const r5 = makeRule({ id: 'r5', scope: 'budget', adjustmentPct: 3, target: { budgetId: 'B1' } });

const baseRules: MaterialPriceRule[] = [r1, r2, r3, r4, r5];

describe('resolveMaterialFactor', () => {
    it('1. sin coincidencia específica → regla global (+5)', () => {
        const res = resolveMaterialFactor({ sku: '999', category: 'Pinturas' }, baseRules);
        expect(res.appliedRule?.id).toBe('r1');
        expect(res.factor).toBeCloseTo(1.05, 10);
    });

    it('2. categoría hija coincide con la categoría padre (+10)', () => {
        const res = resolveMaterialFactor(
            { sku: '999', category: 'Materiales de construcción > Ladrillos' },
            baseRules,
        );
        expect(res.appliedRule?.id).toBe('r2');
        expect(res.factor).toBeCloseTo(1.1, 10);
    });

    it('3. material gana a categoría (+20)', () => {
        const res = resolveMaterialFactor(
            { sku: '104562', category: 'Materiales de construcción > Ladrillos' },
            baseRules,
        );
        expect(res.appliedRule?.id).toBe('r3');
        expect(res.factor).toBeCloseTo(1.2, 10);
    });

    it('4. cliente gana a material/categoría (+8)', () => {
        const res = resolveMaterialFactor(
            { sku: '104562', category: 'Materiales de construcción', leadId: 'L1' },
            baseRules,
        );
        expect(res.appliedRule?.id).toBe('r4');
        expect(res.factor).toBeCloseTo(1.08, 10);
    });

    it('5. presupuesto es el más específico (+3)', () => {
        const res = resolveMaterialFactor(
            { sku: '104562', category: 'X', leadId: 'L1', budgetId: 'B1' },
            baseRules,
        );
        expect(res.appliedRule?.id).toBe('r5');
        expect(res.factor).toBeCloseTo(1.03, 10);
    });

    it('6. leadId sin regla de cliente → cae a global (+5)', () => {
        const res = resolveMaterialFactor(
            { sku: '999', category: 'Pinturas', leadId: 'L2' },
            baseRules,
        );
        expect(res.appliedRule?.id).toBe('r1');
        expect(res.factor).toBeCloseTo(1.05, 10);
    });

    it('7. sin reglas → factor 1.0 y appliedRule null', () => {
        const res = resolveMaterialFactor({ sku: '104562', category: 'X' }, []);
        expect(res.appliedRule).toBeNull();
        expect(res.factor).toBe(1);
    });

    it('8. regla de material inactiva → cae a categoría (+10)', () => {
        const r3Inactive = makeRule({ id: 'r3', scope: 'material', adjustmentPct: 20, target: { sku: '104562' }, active: false });
        const rules = [r1, r2, r3Inactive, r4, r5];
        const res = resolveMaterialFactor(
            { sku: '104562', category: 'Materiales de construcción' },
            rules,
        );
        expect(res.appliedRule?.id).toBe('r2');
        expect(res.factor).toBeCloseTo(1.1, 10);
    });
});

import { describe, it, expect } from 'vitest';
import { toStoredScale, isPriceOverride, isManualOverBc3 } from './bc3-price';

describe('toStoredScale', () => {
    it('hornea GG+BI igual que bake_markup (round a céntimos)', () => {
        expect(toStoredScale(0.88, 1.25)).toBe(1.1);
        expect(toStoredScale(43.57, 1.25)).toBe(54.46);
    });
    it('sin markup horneado deja el precio tal cual', () => {
        expect(toStoredScale(6.2, 1)).toBe(6.2);
    });
    it('null / no numérico → null', () => {
        expect(toStoredScale(null, 1.25)).toBeNull();
        expect(toStoredScale(undefined, 1.25)).toBeNull();
    });
});

describe('isPriceOverride', () => {
    it('igual al precio de la fuente (±redondeo) → no es override', () => {
        expect(isPriceOverride(1.1, 1.1)).toBe(false);
        expect(isPriceOverride(1.105, 1.1)).toBe(false);
    });
    it('precio movido → override', () => {
        expect(isPriceOverride(1.5, 1.1)).toBe(true);
    });
    it('sin precio de fuente no hay con qué comparar', () => {
        expect(isPriceOverride(3, null)).toBe(false);
    });
});

describe('isManualOverBc3', () => {
    it('precio BC3 con GG+BI horneado → no es edición manual', () => {
        expect(isManualOverBc3({ bc3_unit_price: 0.88, unitPrice: 1.1 }, 1.25)).toBe(false);
    });
    it('precio BC3 raw (bug antiguo del cambio de fuente) → no es edición manual', () => {
        expect(isManualOverBc3({ bc3_unit_price: 0.88, unitPrice: 0.88 }, 1.25)).toBe(false);
    });
    it('precio distinto de ambos → edición manual', () => {
        expect(isManualOverBc3({ bc3_unit_price: 0.88, unitPrice: 1.5 }, 1.25)).toBe(true);
    });
    it('sin precio BC3 → nunca', () => {
        expect(isManualOverBc3({ bc3_unit_price: null, unitPrice: 1.5 }, 1.25)).toBe(false);
    });
});

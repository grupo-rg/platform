import { describe, it, expect } from 'vitest';
import { BudgetNarrativeBuilder } from './budget-narrative-builder';

describe('BudgetNarrativeBuilder', () => {
    it('incluye originalRequest cuando está presente', () => {
        const out = BudgetNarrativeBuilder.build({
            originalRequest: 'Reforma cocina 12 m² con demolición',
            totalArea: 12,
            qualityLevel: 'medium',
        } as any);
        expect(out).toMatch(/Petición Original/);
        expect(out).toMatch(/Reforma cocina 12 m²/);
    });

    it('mapea interventionType new_build → "Obra Nueva"', () => {
        const out = BudgetNarrativeBuilder.build({ interventionType: 'new_build', totalArea: 120 } as any);
        expect(out).toMatch(/Obra Nueva/);
    });

    it('mapea interventionType total → "Reforma Integral"', () => {
        const out = BudgetNarrativeBuilder.build({ interventionType: 'total', totalArea: 90 } as any);
        expect(out).toMatch(/Reforma Integral/);
    });

    it('valores desconocidos caen a "Reforma Parcial"', () => {
        const out = BudgetNarrativeBuilder.build({ interventionType: 'whatever', totalArea: 30 } as any);
        expect(out).toMatch(/Reforma Parcial/);
    });

    it('enumera rooms/bathrooms/kitchens cuando existen', () => {
        const out = BudgetNarrativeBuilder.build({
            totalArea: 80,
            rooms: [{ area: 20 }, { area: 15 }],
            bathrooms: [{ area: 6, quality: 'medium' }],
            kitchens: [{ area: 10, quality: 'high' }],
        } as any);
        expect(out).toMatch(/Habitaciones \(2\)/);
        expect(out).toMatch(/Baños \(1\)/);
        expect(out).toMatch(/Cocinas \(1\)/);
        expect(out).toMatch(/10 m² \(high\)/);
    });

    it('marca flags especiales (demolición, ascensor, parking)', () => {
        const out = BudgetNarrativeBuilder.build({
            totalArea: 50,
            demolition: true,
            elevator: true,
            parking: true,
        } as any);
        expect(out).toMatch(/Incluye demolición previa/);
        expect(out).toMatch(/Requiere instalación de ascensor/);
        expect(out).toMatch(/Incluye plaza de parking/);
    });
});

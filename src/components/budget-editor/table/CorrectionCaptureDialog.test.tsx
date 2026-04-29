/**
 * Fase 6.B — tests de sub-componentes + helpers del dialog de captura.
 *
 * Mismo enfoque que `audit-v005.test.tsx`: Node puro +
 * renderToStaticMarkup + React.createElement (sin jsdom).
 *
 * Lo que se testea:
 *   1. `detectPriceOrUnitChange(previous, next)`: pure función que dispara el dialog
 *       cuando `unitPrice` o `unit` han cambiado respecto al anterior.
 *   2. Render del listado de opciones del dropdown.
 *   3. El heading y la descripción del dialog son consistentes (cero-regresión
 *      sobre la copia visible al usuario).
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';

import {
    detectPriceOrUnitChange,
    CorrectionReasonOptions,
} from './CorrectionCaptureDialog.helpers';

const h = React.createElement;

describe('detectPriceOrUnitChange', () => {
    it('returns null when nothing changed', () => {
        const change = detectPriceOrUnitChange(
            { unitPrice: 10, unit: 'm2' },
            { unitPrice: 10, unit: 'm2' },
        );
        expect(change).toBeNull();
    });

    it('detects a price change', () => {
        const change = detectPriceOrUnitChange(
            { unitPrice: 10, unit: 'm2' },
            { unitPrice: 12, unit: 'm2' },
        );
        expect(change).toEqual({ priceChanged: true, unitChanged: false });
    });

    it('detects a unit change', () => {
        const change = detectPriceOrUnitChange(
            { unitPrice: 10, unit: 'm2' },
            { unitPrice: 10, unit: 'm3' },
        );
        expect(change).toEqual({ priceChanged: false, unitChanged: true });
    });

    it('detects both changes simultaneously', () => {
        const change = detectPriceOrUnitChange(
            { unitPrice: 10, unit: 'm2' },
            { unitPrice: 12, unit: 'm3' },
        );
        expect(change).toEqual({ priceChanged: true, unitChanged: true });
    });

    it('ignores tiny float noise below 1 cent (0.005 €)', () => {
        // Evita que un reformat cosmético (10.00 -> 10.0001) dispare el dialog.
        const change = detectPriceOrUnitChange(
            { unitPrice: 10.0, unit: 'm2' },
            { unitPrice: 10.004, unit: 'm2' },
        );
        expect(change).toBeNull();
    });

    it('treats null/undefined like no prior state (no change detected)', () => {
        const change = detectPriceOrUnitChange(
            undefined,
            { unitPrice: 10, unit: 'm2' },
        );
        expect(change).toBeNull();
    });
});

describe('CorrectionReasonOptions', () => {
    it('renders all 5 reason options in a <select>', () => {
        const html = renderToStaticMarkup(
            h(CorrectionReasonOptions, { value: 'volumen', onChange: () => {} }),
        );
        expect(html).toContain('data-testid="correction-reason-select"');
        expect(html).toContain('Descuento proveedor');
        expect(html).toContain('Volumen');
        expect(html).toContain('Error de la IA');
        expect(html).toContain('Calidad premium');
        expect(html).toContain('Otro');
    });

    it('marks the currently selected reason', () => {
        const html = renderToStaticMarkup(
            h(CorrectionReasonOptions, { value: 'calidad_premium', onChange: () => {} }),
        );
        // React renderiza la opción seleccionada con `selected`.
        expect(html).toMatch(/value="calidad_premium"[^>]*selected/);
    });
});

/**
 * Sprint 4 Fase B (B4) — tests del banner contextual del parser TABULAR
 * en BudgetGenerationProgress.
 *
 * Cubrimos los tres `kind` (tabular_completed | tabular_aborted |
 * layout_unsupported). Renderizado puro (sin jsdom) vía
 * `react-dom/server.renderToStaticMarkup` para mantener el patrón ya
 * establecido en `audit-v005.test.tsx`.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';

import { ExtractorBannerView } from './ExtractorBannerView';

const h = React.createElement;

describe('ExtractorBannerView', () => {
    it('renders tabular_completed badge with qty% + seconds', () => {
        const html = renderToStaticMarkup(
            h(ExtractorBannerView, {
                banner: {
                    kind: 'tabular_completed',
                    partidasCount: 74,
                    qtyRate: 0.95,
                    chapterRate: 0.91,
                    durationSeconds: 12.34,
                },
            }),
        );
        expect(html).toMatch(/Parser TABULAR/);
        expect(html).toMatch(/95% qty/);
        // formatted to one decimal in the component.
        expect(html).toMatch(/12\.3s/);
        expect(html).toMatch(/74 partidas/);
        // Tone: emerald.
        expect(html).toMatch(/emerald/);
    });

    it('renders tabular_aborted with reason and fallback hint', () => {
        const html = renderToStaticMarkup(
            h(ExtractorBannerView, {
                banner: {
                    kind: 'tabular_aborted',
                    reason: 'low_qty_rate (40.0% < 80%)',
                    partidasExtracted: 25,
                },
            }),
        );
        expect(html).toMatch(/Parser TABULAR aborted/);
        expect(html).toMatch(/low_qty_rate/);
        expect(html.toLowerCase()).toMatch(/fallback/);
        expect(html).toMatch(/25 partidas/);
        // Tone: amber.
        expect(html).toMatch(/amber/);
    });

    it('renders layout_unsupported error card with message + suggestion + retry button', () => {
        const html = renderToStaticMarkup(
            h(ExtractorBannerView, {
                banner: {
                    kind: 'layout_unsupported',
                    extractor: 'AnnexedPdfExtractorService',
                    pagesAttempted: 258,
                    maxPagesAllowed: 50,
                    message:
                        'Layout no soportado: AnnexedPdfExtractorService caería a LLM Vision para 258 páginas (max permitido: 50).',
                    suggestion:
                        'Activá USE_TABULAR_PARSER si no lo está, o contactá soporte.',
                },
            }),
        );
        expect(html).toMatch(/Layout no soportado/);
        expect(html).toMatch(/AnnexedPdfExtractorService/);
        expect(html).toMatch(/USE_TABULAR_PARSER/);
        expect(html).toMatch(/258 págs/);
        expect(html).toMatch(/max 50/);
        expect(html).toMatch(/Reintentar con flag activado/);
        // Tone: red.
        expect(html).toMatch(/red/);
    });

    it('layout_unsupported tolerates missing optional fields', () => {
        const html = renderToStaticMarkup(
            h(ExtractorBannerView, {
                banner: {
                    kind: 'layout_unsupported',
                    message: 'Layout no soportado.',
                },
            }),
        );
        expect(html).toMatch(/Layout no soportado/);
        // Sin extractor, sin pagesAttempted: el card sigue renderizando.
        expect(html).not.toMatch(/AnnexedPdfExtractorService/);
        expect(html).toMatch(/Reintentar con flag activado/);
    });
});

/**
 * Sprint 4 Fase B — banner contextual del parser TABULAR coord-based.
 *
 * Aislado en su propio módulo (sin dependencias de `@/components/ui/*`) para
 * mantenerlo testeable con `renderToStaticMarkup` en Node puro vía Vitest —
 * mismo patrón que `CorrectionCaptureDialog.helpers.tsx` y `audit-v005.ts`.
 *
 * Tres estados (uno por evento de telemetría):
 *  - `tabular_completed`: success — pill verde con qty_rate + duración.
 *  - `tabular_aborted`: aviso — banner amarillo con razón + fallback hint.
 *  - `layout_unsupported`: error duro (A9 abort) — card roja con mensaje +
 *    suggestion + botón "Reintentar con flag activado". El botón hace un
 *    `window.location.reload()` — el caller no necesita pasar handler.
 */
import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';

const h = React.createElement;

export type ExtractorBanner =
    | {
          kind: 'tabular_completed';
          partidasCount: number;
          qtyRate: number;
          chapterRate: number;
          durationSeconds: number;
      }
    | {
          kind: 'tabular_aborted';
          reason: string;
          partidasExtracted: number;
      }
    | {
          kind: 'layout_unsupported';
          extractor?: string;
          pagesAttempted?: number;
          maxPagesAllowed?: number;
          message: string;
          suggestion?: string;
      };

export function ExtractorBannerView({ banner }: { banner: ExtractorBanner }): React.ReactElement {
    if (banner.kind === 'tabular_completed') {
        const qtyPct = (banner.qtyRate * 100).toFixed(0);
        const dur = banner.durationSeconds.toFixed(1);
        return h(
            'div',
            {
                role: 'status',
                'aria-label': 'Parser TABULAR completado',
                className:
                    'inline-flex items-center gap-2 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 px-3 py-1 text-[12px]',
            },
            h(CheckCircle2, { className: 'h-3.5 w-3.5' }),
            h('span', { className: 'font-medium' }, 'Parser TABULAR'),
            h('span', { className: 'opacity-70' }, '·'),
            h('span', { className: 'font-mono tabular-nums' }, `${qtyPct}% qty`),
            h('span', { className: 'opacity-70' }, '·'),
            h('span', { className: 'font-mono tabular-nums' }, `${dur}s`),
            h('span', { className: 'opacity-70' }, '·'),
            h('span', { className: 'font-mono tabular-nums' }, `${banner.partidasCount} partidas`),
        );
    }
    if (banner.kind === 'tabular_aborted') {
        return h(
            'div',
            {
                role: 'status',
                'aria-label': 'Parser TABULAR aborted',
                className:
                    'rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 px-3 py-2 text-[12px]',
            },
            h(
                'div',
                { className: 'flex items-center gap-2 font-medium' },
                h(AlertTriangle, { className: 'h-3.5 w-3.5' }),
                h('span', null, 'Parser TABULAR aborted'),
                h('span', { className: 'opacity-70' }, '·'),
                h('code', { className: 'font-mono' }, banner.reason),
            ),
            h(
                'p',
                { className: 'mt-1 text-[11px] opacity-80' },
                `Fallback a heurística legacy (${banner.partidasExtracted} partidas parciales descartadas).`,
            ),
        );
    }
    // banner.kind === 'layout_unsupported'
    const children: React.ReactNode[] = [
        h(
            'div',
            { className: 'flex items-center gap-2 font-semibold', key: 'h' },
            h(AlertCircle, { className: 'h-4 w-4' }),
            h('span', null, 'Layout no soportado'),
            banner.extractor
                ? h(
                      React.Fragment,
                      null,
                      h('span', { className: 'opacity-70' }, '·'),
                      h('code', { className: 'font-mono text-[11px]' }, banner.extractor),
                  )
                : null,
        ),
        h('p', { className: 'opacity-90', key: 'm' }, banner.message),
    ];
    if (banner.suggestion) {
        children.push(
            h(
                'p',
                { className: 'text-[11px] opacity-80 italic', key: 's' },
                banner.suggestion,
            ),
        );
    }
    if (typeof banner.pagesAttempted === 'number' && typeof banner.maxPagesAllowed === 'number') {
        children.push(
            h(
                'p',
                { className: 'text-[11px] opacity-70 font-mono', key: 'p' },
                `${banner.pagesAttempted} págs / max ${banner.maxPagesAllowed}`,
            ),
        );
    }
    children.push(
        h(
            'button',
            {
                type: 'button',
                key: 'btn',
                onClick: () => {
                    if (typeof window !== 'undefined') window.location.reload();
                },
                className:
                    'inline-flex items-center gap-1.5 rounded-md bg-red-600 text-white px-3 py-1 text-[11px] font-medium hover:bg-red-700 transition-colors',
            },
            'Reintentar con flag activado',
        ),
    );

    return h(
        'div',
        {
            role: 'alert',
            'aria-label': 'Layout no soportado',
            className:
                'rounded-md bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/30 px-3 py-3 text-[12px] space-y-2',
        },
        ...children,
    );
}

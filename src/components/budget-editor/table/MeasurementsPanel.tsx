'use client';

import React from 'react';
import { MeasurementLine } from '@/backend/budget/domain/budget';

/**
 * Panel de mediciones estructuradas de una partida BC3 (estado de mediciones).
 *
 * Muestra el desglose línea a línea que justifica la cantidad total:
 * estancia · uds · largo · ancho · alto · subtotal, agrupado por secciones
 * (p.ej. "PLANTA BAJA"). Read-only en esta versión.
 */

const fmt = (n?: number | null): string =>
    n == null
        ? '—'
        : new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(n);

const GRID = 'grid grid-cols-[minmax(140px,1fr)_58px_78px_78px_78px_96px]';

export function MeasurementsPanel({
    measurements,
    unit,
    total,
}: {
    measurements: MeasurementLine[];
    unit?: string;
    total?: number;
}) {
    const sum = measurements.reduce((acc, l) => acc + (l.is_section ? 0 : l.subtotal ?? 0), 0);

    return (
        <div className="mx-4 mb-3 mt-1 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.03] overflow-x-auto">
            <div className="min-w-[520px]">
                <div className={`${GRID} px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 font-semibold`}>
                    <span>Comentario / Estancia</span>
                    <span className="text-right">Uds</span>
                    <span className="text-right">Largo</span>
                    <span className="text-right">Ancho</span>
                    <span className="text-right">Alto</span>
                    <span className="text-right">Subtotal</span>
                </div>

                {measurements.map((l, i) =>
                    l.is_section ? (
                        <div
                            key={i}
                            className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 bg-slate-100/70 dark:bg-white/[0.05] border-t border-slate-200 dark:border-white/10"
                        >
                            {l.comment}
                        </div>
                    ) : (
                        <div
                            key={i}
                            className={`${GRID} px-3 py-1.5 text-[13px] border-t border-slate-100 dark:border-white/5 hover:bg-white/70 dark:hover:bg-white/[0.04]`}
                        >
                            <span className="text-slate-700 dark:text-slate-200 truncate" title={l.comment}>{l.comment || '—'}</span>
                            <span className="text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">{fmt(l.units)}</span>
                            <span className="text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">{fmt(l.length)}</span>
                            <span className="text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">{fmt(l.width)}</span>
                            <span className="text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">{fmt(l.height)}</span>
                            <span className="text-right font-mono tabular-nums font-semibold text-slate-800 dark:text-white">{fmt(l.subtotal)}</span>
                        </div>
                    )
                )}

                <div className="grid grid-cols-[1fr_96px] px-3 py-2 border-t-2 border-primary/20 text-[13px]">
                    <span className="uppercase text-[11px] tracking-wide text-slate-500 dark:text-slate-400 font-semibold self-center">
                        Total medición{unit ? ` (${unit})` : ''}
                    </span>
                    <span className="text-right font-mono tabular-nums font-bold text-amber-700 dark:text-amber-400">
                        {fmt(total ?? sum)}
                    </span>
                </div>
            </div>
        </div>
    );
}

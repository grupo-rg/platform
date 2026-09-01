'use client';

import React from 'react';
import { FileText, Loader2 } from 'lucide-react';
import type { Bc3DetectResult } from '@/actions/budget/detect-bc3.action';

/**
 * Tarjeta de detección BC3 en el chat: muestra los conteos (capítulos, partidas,
 * con precio, mediciones) tras leer el archivo, para que el usuario sepa qué está
 * importando antes de generar nada. Ver `detectBc3Action`.
 */
export function Bc3DetectCard({
    result,
    loading,
    error,
}: {
    result?: Bc3DetectResult;
    loading?: boolean;
    error?: string;
}) {
    if (loading) {
        return (
            <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 p-4">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="w-4 h-4 text-amber-500 animate-spin" /> Leyendo BC3…
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/10 p-4 text-sm text-red-600 dark:text-red-400">
                No se pudo leer el BC3: {error}
            </div>
        );
    }

    if (!result) return null;

    const stats: { k: string; v: number; sub?: string }[] = [
        { k: 'Capítulos', v: result.chapters },
        { k: 'Partidas', v: result.partidas },
        { k: 'Con precio', v: result.priced_partidas, sub: `/ ${result.partidas}` },
        { k: 'Mediciones', v: result.measurements },
    ];

    return (
        <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
            <div className="flex items-center gap-3 p-3 border-b border-slate-200 dark:border-white/10">
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/15 border border-amber-300 dark:border-amber-500/30 px-2 py-0.5 rounded">
                    BC3
                </span>
                <div className="min-w-0 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-amber-500 shrink-0" />
                    <div className="min-w-0">
                        <div className="font-semibold text-sm truncate">{result.title || result.filename}</div>
                        <div className="text-xs text-slate-400">
                            {result.version || 'FIEBDC-3'} · {result.encoding}
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-4 divide-x divide-slate-200 dark:divide-white/10">
                {stats.map((s) => (
                    <div key={s.k} className="p-3">
                        <div className="text-[11px] uppercase tracking-wide text-slate-400">{s.k}</div>
                        <div className="font-mono text-xl font-semibold tabular-nums text-slate-800 dark:text-white">
                            {s.v}
                            {s.sub && <span className="text-xs text-slate-400 font-sans ml-0.5">{s.sub}</span>}
                        </div>
                    </div>
                ))}
            </div>

            {result.has_prices && (
                <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-white/10">
                    Este BC3 trae precios: podrás{' '}
                    <b className="text-slate-700 dark:text-slate-200">compararlos</b> con la estimación de IA en el editor.
                </div>
            )}
        </div>
    );
}

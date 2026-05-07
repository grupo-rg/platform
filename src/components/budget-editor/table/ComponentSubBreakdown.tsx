'use client';

/**
 * Phase 17.5 — Sub-descompuesto del catálogo COAATMCA para un componente.
 *
 * Cuando el agente compone una partida 1:N a partir de items del catálogo
 * (D3001.0080, D3002.0020, etc.), el `BudgetPartida.breakdown` solo guarda
 * los items "padre" del catálogo. Cada item padre tiene a su vez su propia
 * descomposición en el catálogo (B0001.0060 Peón especializado + B0001.0070
 * Peón suelto + B1917.0060 compresor con bujarda + …).
 *
 * Este subcomponente carga lazy la descomposición del item del catálogo y la
 * muestra anidada bajo el componente del descompuesto del editor.
 *
 * Solo lectura — son datos de referencia del catálogo, NO del budget. No se
 * persisten en el budget ni se afectan por GG/BI live-edit. Si el admin
 * sustituyó el componente vía MaterialPicker (`isSubstituted=true`), no
 * habrá descomposición de catálogo (el material es de otro origen) y se
 * muestra mensaje neutro.
 */

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { getPriceBookBreakdown } from '@/actions/price-book/get-price-book-breakdown.action';
import type { PriceBookComponent } from '@/backend/price-book/domain/price-book-item';

interface ComponentSubBreakdownProps {
    /** Código del item del catálogo (ej. "D3001.0080"). */
    parentCode: string | undefined;
}

export function ComponentSubBreakdown({ parentCode }: ComponentSubBreakdownProps) {
    const [components, setComponents] = useState<PriceBookComponent[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!parentCode) {
            setComponents([]);
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        getPriceBookBreakdown(parentCode)
            .then((result) => {
                if (cancelled) return;
                if (!result.success) {
                    setError(result.error || 'No se pudo cargar la descomposición.');
                    setComponents([]);
                    return;
                }
                setComponents(result.components);
            })
            .catch((e: any) => {
                if (cancelled) return;
                console.error('[ComponentSubBreakdown] fetch failed', e);
                setError(e?.message || 'Error al cargar la descomposición.');
                setComponents([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [parentCode]);

    if (loading) {
        return (
            <div className="px-6 py-3 bg-slate-50/50 dark:bg-black/20 border-l-2 border-indigo-200 dark:border-indigo-800 ml-4 text-xs flex items-center gap-2 text-slate-500">
                <Loader2 className="w-3 h-3 animate-spin" />
                Cargando descomposición de {parentCode}…
            </div>
        );
    }

    if (error) {
        return (
            <div className="px-6 py-3 bg-red-50/50 dark:bg-red-950/20 border-l-2 border-red-200 dark:border-red-800 ml-4 text-xs text-red-700 dark:text-red-400">
                {error}
            </div>
        );
    }

    if (!components || components.length === 0) {
        return (
            <div className="px-6 py-3 bg-slate-50/30 dark:bg-black/10 border-l-2 border-slate-200 dark:border-slate-800 ml-4 text-[11px] italic text-slate-500">
                Sin descomposición de catálogo para {parentCode || 'este componente'} (puede ser un material sustituido o un código no presente en COAATMCA).
            </div>
        );
    }

    return (
        <div className="bg-slate-50/40 dark:bg-black/20 border-l-2 border-indigo-300 dark:border-indigo-700 ml-4 px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400 mb-2">
                Descomposición catálogo (referencia COAATMCA, raw PEM)
            </div>
            <div className="grid grid-cols-[80px_1fr_70px_70px_80px] gap-2 text-[10px] uppercase tracking-wider text-slate-400 font-medium pb-1 border-b border-slate-200 dark:border-slate-700">
                <div>Código</div>
                <div>Descripción</div>
                <div className="text-right">Cant. / Ud</div>
                <div className="text-right">Precio Ud.</div>
                <div className="text-right">Total</div>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-white/5">
                {components.map((c, idx) => {
                    const qty = c.quantity || 0;
                    const price = c.price || 0;
                    const total = c.unit === '%' ? price * (qty / 100) : qty * price;
                    return (
                        <div key={idx} className="grid grid-cols-[80px_1fr_70px_70px_80px] gap-2 text-xs py-1.5 items-center">
                            <span className="font-mono text-[10px] text-slate-500">{c.code || '—'}</span>
                            <span className="truncate text-slate-700 dark:text-slate-300" title={c.description || ''}>
                                {c.description || '—'}
                                {c.is_variable && (
                                    <span className="ml-1.5 text-[8px] uppercase font-bold text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 px-1 py-0.5 rounded">
                                        VAR
                                    </span>
                                )}
                            </span>
                            <span className="text-right font-mono text-slate-500">
                                {qty.toFixed(3)} {c.unit || ''}
                            </span>
                            <span className="text-right font-mono text-slate-600 dark:text-slate-400">
                                {formatCurrency(price)}
                            </span>
                            <span className="text-right font-mono font-semibold text-slate-700 dark:text-slate-200">
                                {formatCurrency(total)}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

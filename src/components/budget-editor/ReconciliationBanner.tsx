'use client';

/**
 * Phase 17 — Banner de estado de reconciliación encima del editor.
 *
 * Siempre visible cuando el budget es `phase17-markup-baked` (status badge):
 *   - Verde "Descompuestos verificados" cuando count divergencia = 0.
 *   - Amber "N partidas con descompuesto desajustado" + click → modal cuando count > 0.
 *
 * Para budgets legacy (phase15 o sin stamp) NO se renderiza nada — la rama
 * legacy del editor no admite reconciliación batch (sería invasiva y solo hay
 * un budget aprobado en producción).
 */
import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReconciliationDiffModal } from './ReconciliationDiffModal';
import { detectDivergence } from '@/lib/budget/reconciliation';
import type { EditableBudgetLineItem } from '@/types/budget-editor';

interface ReconciliationBannerProps {
    items: EditableBudgetLineItem[];
    budgetId: string;
    calibrationVersion?: 'phase14' | 'phase15' | 'phase17-markup-baked';
    onReconciled?: (reconciledIds: string[]) => void;
}

export function ReconciliationBanner({ items, budgetId, calibrationVersion, onReconciled }: ReconciliationBannerProps) {
    const [modalOpen, setModalOpen] = useState(false);

    const isPhase17 = calibrationVersion === 'phase17-markup-baked';

    const stats = useMemo(() => {
        if (!isPhase17) return { divergent: 0, evaluable: 0 };
        let divergent = 0;
        let evaluable = 0;
        for (const line of items) {
            const hasBreakdown = !!(line.item?.breakdown && line.item.breakdown.length > 0);
            if (!hasBreakdown) continue;
            evaluable += 1;
            if (detectDivergence(line).hasDivergence) divergent += 1;
        }
        return { divergent, evaluable };
    }, [items, isPhase17]);

    if (!isPhase17) return null;

    if (stats.divergent === 0) {
        return (
            <div className="mx-2 my-2 rounded-md border border-emerald-300/60 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-700/40 px-3 py-2 flex items-center gap-2 text-sm text-emerald-800 dark:text-emerald-200">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                    Descompuestos verificados — <strong>{stats.evaluable}</strong>{' '}
                    {stats.evaluable === 1 ? 'partida cuadra' : 'partidas cuadran'} con su precio total.
                </span>
            </div>
        );
    }

    return (
        <>
            <div className="mx-2 my-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700/50 px-3 py-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>
                        <strong>{stats.divergent}</strong>{' '}
                        {stats.divergent === 1 ? 'partida tiene' : 'partidas tienen'} el descompuesto
                        desajustado contra el precio total
                        {stats.evaluable > stats.divergent && (
                            <> ({stats.evaluable - stats.divergent} cuadran)</>
                        )}.
                    </span>
                </div>
                <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-400 text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
                    onClick={() => setModalOpen(true)}
                >
                    Revisar y reconciliar
                </Button>
            </div>
            <ReconciliationDiffModal
                open={modalOpen}
                onOpenChange={setModalOpen}
                items={items}
                budgetId={budgetId}
                onReconciled={onReconciled}
            />
        </>
    );
}

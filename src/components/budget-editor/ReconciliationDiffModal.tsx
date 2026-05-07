'use client';

/**
 * Phase 17 — Modal preview con diff antes de reconciliar.
 *
 * Muestra una tabla con todas las partidas seleccionadas, sus diferencias
 * actuales y los nuevos valores de cada componente tras escalar al unit_price.
 * Admin confirma → server action `reconcilePartidasAction` ejecuta el cambio.
 */
import React, { useMemo, useState, useTransition } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { reconcilePartidasAction } from '@/actions/admin/reconcile-partidas.action';
import { detectDivergence, previewReconcile } from '@/lib/budget/reconciliation';
import type { EditableBudgetLineItem } from '@/types/budget-editor';

interface ReconciliationDiffModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Lista completa de partidas del budget. El modal filtra las que tienen divergencia. */
    items: EditableBudgetLineItem[];
    budgetId: string;
    /** Si está presente, el modal se enfoca solo en esa partida (modo per-partida). */
    focusedPartidaId?: string | null;
    /** Callback tras reconciliación exitosa (e.g. para refrescar el editor). */
    onReconciled?: (reconciledIds: string[]) => void;
}

export function ReconciliationDiffModal({
    open,
    onOpenChange,
    items,
    budgetId,
    focusedPartidaId,
    onReconciled,
}: ReconciliationDiffModalProps) {
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();

    const candidateRows = useMemo(() => {
        return items
            .filter((line) => {
                if (focusedPartidaId) return line.id === focusedPartidaId;
                return detectDivergence(line).hasDivergence;
            })
            .map((line) => {
                const div = detectDivergence(line);
                const preview = previewReconcile(line);
                return { line, div, preview };
            })
            .filter((r) => r.preview != null);
    }, [items, focusedPartidaId]);

    const [selected, setSelected] = useState<Record<string, boolean>>({});

    React.useEffect(() => {
        if (open) {
            const initial: Record<string, boolean> = {};
            for (const r of candidateRows) initial[r.line.id] = true;
            setSelected(initial);
        }
    }, [open, candidateRows]);

    const selectedIds = candidateRows.filter((r) => selected[r.line.id]).map((r) => r.line.id);

    const handleConfirm = () => {
        if (selectedIds.length === 0) return;
        startTransition(async () => {
            const result = await reconcilePartidasAction(budgetId, selectedIds);
            if (!result.ok) {
                toast({
                    variant: 'destructive',
                    title: 'Error al reconciliar',
                    description: result.error || 'No se pudo aplicar la reconciliación.',
                });
                return;
            }
            toast({
                title: `${result.reconciled} partidas reconciliadas`,
                description: result.skipped > 0
                    ? `${result.skipped} omitidas (ya cuadraban o sin breakdown).`
                    : 'Descompuesto recalculado para que sume el unit_price.',
            });
            onReconciled?.(selectedIds);
            onOpenChange(false);
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-amber-600" />
                        Reconciliar descompuesto
                    </DialogTitle>
                    <DialogDescription>
                        Las siguientes partidas tienen un descompuesto que no suma el unit_price total.
                        Al reconciliar, los componentes se escalan proporcionalmente para que cuadren.
                        El precio final de la partida no cambia.
                    </DialogDescription>
                </DialogHeader>

                {candidateRows.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground flex flex-col items-center gap-2">
                        <CheckCircle2 className="w-8 h-8 text-green-600" />
                        <span>No hay partidas con descompuesto desajustado.</span>
                    </div>
                ) : (
                    <div className="space-y-3 my-2">
                        {candidateRows.map(({ line, div, preview }) => (
                            <div key={line.id} className="border rounded-md p-3 bg-muted/20">
                                <div className="flex items-start gap-3">
                                    <Checkbox
                                        checked={!!selected[line.id]}
                                        onCheckedChange={(v) =>
                                            setSelected((prev) => ({ ...prev, [line.id]: v === true }))
                                        }
                                        className="mt-1"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-2 mb-2">
                                            <div className="font-mono text-sm font-semibold">
                                                {line.item?.code || line.id.substring(0, 8)} ·{' '}
                                                <span className="font-sans font-normal text-muted-foreground">
                                                    {line.item?.description?.substring(0, 60) || line.originalTask?.substring(0, 60)}
                                                </span>
                                            </div>
                                            <div className="text-xs whitespace-nowrap">
                                                <span className="text-muted-foreground">unit_price</span>{' '}
                                                <span className="font-mono">{line.item?.unitPrice?.toFixed(2)} €</span>
                                            </div>
                                        </div>
                                        <div className="text-xs text-muted-foreground mb-2">
                                            Sum actual:{' '}
                                            <span className="font-mono">{div.sumBreakdown.toFixed(2)} €</span>{' '}
                                            · Diferencia:{' '}
                                            <span
                                                className={
                                                    div.diffAmount >= 0 ? 'font-mono text-amber-700' : 'font-mono text-red-700'
                                                }
                                            >
                                                {div.diffAmount >= 0 ? '+' : ''}
                                                {div.diffAmount.toFixed(2)} € ({(div.diffPct * 100).toFixed(1)}%)
                                            </span>
                                        </div>
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="border-b text-muted-foreground">
                                                    <th className="text-left py-1">Componente</th>
                                                    <th className="text-right py-1">Total actual</th>
                                                    <th className="text-right py-1">Total nuevo</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {preview!.componentScales.map((c, i) => (
                                                    <tr key={i} className="border-b border-dashed last:border-0">
                                                        <td className="py-1 font-mono text-xs">{c.code || '—'}</td>
                                                        <td className="text-right py-1 font-mono">{c.before.toFixed(2)} €</td>
                                                        <td className="text-right py-1 font-mono font-semibold text-green-700">
                                                            {c.after.toFixed(2)} €
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={selectedIds.length === 0 || isPending || candidateRows.length === 0}
                    >
                        {isPending ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Reconciliando...
                            </>
                        ) : (
                            `Reconciliar ${selectedIds.length} partida${selectedIds.length === 1 ? '' : 's'}`
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

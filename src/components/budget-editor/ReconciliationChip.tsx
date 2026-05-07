'use client';

/**
 * Phase 17 — Chip ⚠️ inline en partida con descompuesto desajustado.
 *
 * Aparece junto al code de la partida cuando `detectDivergence().hasDivergence` o
 * `item.needs_reconciliation === true`. Click delega al modal global con foco
 * en esa partida.
 */
import React from 'react';
import { AlertTriangle } from 'lucide-react';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface ReconciliationChipProps {
    diffAmount: number;
    diffPct: number;
    onClick?: () => void;
    className?: string;
}

export function ReconciliationChip({ diffAmount, diffPct, onClick, className }: ReconciliationChipProps) {
    const sign = diffAmount >= 0 ? '+' : '';
    const formattedAmount = `${sign}${diffAmount.toFixed(2)} €`;
    const formattedPct = `${(diffPct * 100).toFixed(1)}%`;

    return (
        <TooltipProvider delayDuration={150}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        onClick={onClick}
                        className={cn(
                            'inline-flex items-center justify-center w-5 h-5 rounded-full',
                            'bg-amber-100 hover:bg-amber-200 text-amber-700',
                            'transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400',
                            className,
                        )}
                        aria-label="Descompuesto desajustado"
                    >
                        <AlertTriangle className="w-3 h-3" />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs text-xs">
                    <div className="font-semibold mb-0.5">Descompuesto desajustado</div>
                    <div>Diferencia: <span className="font-mono">{formattedAmount}</span> ({formattedPct})</div>
                    <div className="text-muted-foreground mt-1">Click para reconciliar.</div>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

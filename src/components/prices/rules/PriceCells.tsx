'use client';

/**
 * Celdas/badges presentacionales compartidos para mostrar el precio efectivo de
 * un material (base → efectivo) y el ajuste porcentual aplicado por una regla.
 */

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import type { EffectivePrice } from './useActiveMaterialRules';

/** Formatea un porcentaje con signo explícito: +10 %, -8 %. */
export function formatSignedPct(pct: number): string {
    const rounded = Math.round(pct * 100) / 100;
    const sign = rounded > 0 ? '+' : '';
    return `${sign}${rounded} %`;
}

export function AdjustmentBadge({ pct, className }: { pct: number; className?: string }) {
    const isDiscount = pct < 0;
    const Icon = isDiscount ? ArrowDownRight : ArrowUpRight;
    return (
        <Badge
            variant="outline"
            className={cn(
                'gap-1 font-mono text-[10px] whitespace-nowrap',
                isDiscount
                    ? 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400'
                    : 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400',
                className,
            )}
        >
            <Icon className="h-3 w-3" />
            {formatSignedPct(pct)}
        </Badge>
    );
}

/**
 * Celda de precio efectivo. Cuando hay regla aplicada muestra el base tachado y
 * el efectivo destacado; si no, solo el base.
 */
export function EffectivePriceCell({ eff, unit }: { eff: EffectivePrice; unit?: string }) {
    const hasRule = !!eff.appliedRule && eff.factor !== 1;
    const suffix = unit ? ` / ${unit}` : '';

    if (!hasRule) {
        return (
            <span className="font-mono font-semibold">
                {formatCurrency(eff.basePrice)}
                {suffix}
            </span>
        );
    }

    const isDiscount = (eff.adjustmentPct ?? 0) < 0;
    return (
        <div className="flex flex-col items-end gap-0.5">
            <span className="text-xs text-muted-foreground line-through">
                {formatCurrency(eff.basePrice)}
            </span>
            <span
                className={cn(
                    'font-mono font-bold',
                    isDiscount ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
                )}
            >
                {formatCurrency(eff.effectivePrice)}
                {suffix}
            </span>
        </div>
    );
}

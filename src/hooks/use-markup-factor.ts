'use client';

/**
 * Phase 17.4 — Hook centralizado para el `markupFactor` del display.
 *
 * Comportamiento:
 *   - phase17 baked: factor = currentFactor / bakedFactor.
 *       · Sin cambios live de GG/BI: factor = 1 (precios baked tal cual).
 *       · Con cambios live: factor != 1 → display reacciona inmediatamente.
 *   - phase15 / legacy: factor = currentFactor (multiplica raw para mostrar PVP).
 *
 * DRY: TableRowItem, ChapterSection, AIReasoningSheet, BudgetBreakdownSheet,
 * BudgetPartidaBreakdown comparten esta lógica. Centralizada aquí.
 */

import { useBudgetEditorContext } from '@/components/budget-editor/BudgetEditorContext';

export function useMarkupFactor(): {
    markupFactor: number;
    isMarkupBaked: boolean;
    currentFactor: number;
    bakedFactor: number;
} {
    const { state } = useBudgetEditorContext();
    const isMarkupBaked = state.calibrationVersion === 'phase17-markup-baked';
    const currentFactor = 1 + ((state.config?.marginGG || 0) + (state.config?.marginBI || 0)) / 100;
    const bakedFactor = isMarkupBaked
        ? 1 + ((state.bakedConfig?.marginGG || 0) + (state.bakedConfig?.marginBI || 0)) / 100
        : 1;
    const markupFactor = isMarkupBaked
        ? (bakedFactor > 0 ? currentFactor / bakedFactor : 1)
        : currentFactor;
    return { markupFactor, isMarkupBaked, currentFactor, bakedFactor };
}

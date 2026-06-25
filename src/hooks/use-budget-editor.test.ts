import { describe, it, expect } from 'vitest';
import { budgetEditorReducer, initialState } from './use-budget-editor';
import type { EditableBudgetLineItem } from '@/types/budget-editor';

// Partida con descompuesto a 0 (bug de precios perdidos), unitPrice válido.
function makeStateWithZeroBreakdown() {
    const item: EditableBudgetLineItem = {
        id: 'p1',
        chapter: 'DEMOLICIONES',
        originalTask: 'Demolición de tabique',
        isEditing: false,
        isDirty: false,
        item: {
            type: 'PARTIDA',
            code: 'NL-1',
            description: 'Demolición de tabique',
            unit: 'm2',
            quantity: 3.7,
            unitPrice: 78.59,
            totalPrice: 290.78,
            breakdown: [
                { code: 'mq05mai030', concept: 'Martillo', type: 'MACHINERY', price: 0, yield: 0.1, total: 0 },
                { code: 'mo112', concept: 'Peón', type: 'LABOR', price: 0, yield: 0.19, total: 0 },
            ],
        } as any,
    } as any;
    return budgetEditorReducer(initialState, { type: 'INIT_STATE', payload: { items: [item] } });
}

describe('UPDATE_ITEM breakdown handling', () => {
    it('usa el descompuesto NUEVO provisto por el caller (reparación) en vez de revertir al viejo a 0', () => {
        const state = makeStateWithZeroBreakdown();
        const old = state.items[0];

        // Reparación: nuevo array de breakdown con precios reales, mismo unitPrice.
        const repaired = [
            { code: 'mq05mai030', concept: 'Martillo', type: 'MACHINERY', price: 100, unitPrice: 100, yield: 0.1, quantity: 0.1, total: 40, totalPrice: 40 },
            { code: 'mo112', concept: 'Peón', type: 'LABOR', price: 200, unitPrice: 200, yield: 0.19, quantity: 0.19, total: 38.59, totalPrice: 38.59 },
        ];
        const next = budgetEditorReducer(state, {
            type: 'UPDATE_ITEM',
            payload: { id: 'p1', changes: { item: { ...(old.item as any), breakdown: repaired } } },
        });

        const bd = next.items[0].item!.breakdown!;
        const sum = bd.reduce((s, c: any) => s + (c.total || 0), 0);
        expect(sum).toBeCloseTo(78.59, 2); // ya NO es 0
        expect(bd[0].total).toBe(40);
    });

    it('escala el descompuesto heredado (mismo ref) cuando cambia el unitPrice', () => {
        const state = makeStateWithZeroBreakdown();
        // Sustituimos por un breakdown no-cero (sum=50) con unitPrice=50 alineado.
        const seeded = budgetEditorReducer(state, {
            type: 'UPDATE_ITEM',
            payload: { id: 'p1', changes: { item: { ...(state.items[0].item as any), unitPrice: 50, breakdown: [
                { code: 'mt1', concept: 'x', type: 'MATERIAL', price: 50, unitPrice: 50, yield: 1, quantity: 1, total: 50, totalPrice: 50 },
            ] } } },
        });
        const cur = seeded.items[0];
        // El usuario edita solo el unitPrice (breakdown heredado por spread = misma ref).
        const next = budgetEditorReducer(seeded, {
            type: 'UPDATE_ITEM',
            payload: { id: 'p1', changes: { item: { ...(cur.item as any), unitPrice: 100 } } },
        });
        const bd = next.items[0].item!.breakdown!;
        // 50 → escalado a 100/50 = ×2 → 100.
        expect(bd[0].total).toBeCloseTo(100, 2);
    });

    it('no toca el descompuesto al editar solo la cantidad', () => {
        const state = makeStateWithZeroBreakdown();
        const seeded = budgetEditorReducer(state, {
            type: 'UPDATE_ITEM',
            payload: { id: 'p1', changes: { item: { ...(state.items[0].item as any), breakdown: [
                { code: 'mt1', concept: 'x', type: 'MATERIAL', price: 50, unitPrice: 50, yield: 1, quantity: 1, total: 50, totalPrice: 50 },
            ] } } },
        });
        const cur = seeded.items[0];
        const next = budgetEditorReducer(seeded, {
            type: 'UPDATE_ITEM',
            payload: { id: 'p1', changes: { item: { ...(cur.item as any), quantity: 10 } } },
        });
        expect(next.items[0].item!.breakdown![0].total).toBe(50);
    });
});

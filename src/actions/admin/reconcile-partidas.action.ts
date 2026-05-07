'use server';

/**
 * Phase 17 — Reconciliación manual de partidas con descompuesto desajustado.
 *
 * Cuando el LLM devuelve breakdown con divergencia >= 2% del unit_price,
 * el backend lo flagea con `needs_reconciliation: true` y persiste raw.
 * Este action permite al admin escalar los componentes para que sumen el
 * unit_price (decisión D1: confiar en unit_price validado por Judge).
 *
 * Auditoría: cada reconciliación deja huella en `audit_logs/{auto}` con
 * actor, target partida, valores antes/después.
 */

import { adminFirestore as adminDb } from '@/backend/shared/infrastructure/firebase/admin-app';
import { BudgetRepositoryFirestore } from '@/backend/budget/infrastructure/budget-repository-firestore';
import { verifyAuth } from '@/backend/auth/auth.middleware';
import { revalidatePath } from 'next/cache';
import type { BudgetPartida } from '@/backend/budget/domain/budget';

interface ReconcileResult {
    ok: boolean;
    reconciled: number;
    skipped: number;
    error?: string;
}

const budgetRepository = new BudgetRepositoryFirestore();

export async function reconcilePartidasAction(
    budgetId: string,
    partidaIds: string[],
): Promise<ReconcileResult> {
    const auth = await verifyAuth(true);
    if (!auth) {
        return { ok: false, reconciled: 0, skipped: 0, error: 'forbidden' };
    }

    if (!budgetId || !Array.isArray(partidaIds) || partidaIds.length === 0) {
        return { ok: false, reconciled: 0, skipped: 0, error: 'invalid_input' };
    }

    try {
        const budget = await budgetRepository.findById(budgetId);
        if (!budget) {
            return { ok: false, reconciled: 0, skipped: 0, error: 'budget_not_found' };
        }

        const targetIds = new Set(partidaIds);
        const auditEntries: any[] = [];
        let reconciled = 0;
        let skipped = 0;

        for (const chapter of budget.chapters) {
            for (let i = 0; i < chapter.items.length; i++) {
                const item = chapter.items[i];
                if (item.type !== 'PARTIDA') continue;
                const partida = item as BudgetPartida;
                if (!targetIds.has(partida.id)) continue;

                if (!partida.breakdown || partida.breakdown.length === 0) {
                    skipped++;
                    continue;
                }

                const sumBefore = partida.breakdown.reduce((s, b) => s + (b.total || 0), 0);
                if (sumBefore <= 0 || partida.unitPrice <= 0) {
                    skipped++;
                    continue;
                }

                const scale = partida.unitPrice / sumBefore;
                if (Math.abs(1 - scale) < 0.0001) {
                    // Ya cuadra; sin cambios
                    skipped++;
                    continue;
                }

                const before = partida.breakdown.map((b) => ({
                    code: b.code ?? null,
                    price: b.price,
                    total: b.total,
                }));

                for (const b of partida.breakdown) {
                    const newTotal = Math.round((b.total || 0) * scale * 100) / 100;
                    if (b.yield && b.yield > 0) {
                        b.price = Math.round((newTotal / b.yield) * 100) / 100;
                    } else {
                        b.price = Math.round((b.price || 0) * scale * 100) / 100;
                    }
                    b.total = newTotal;
                }

                partida.needs_reconciliation = false;
                partida.last_reconciled_at = new Date().toISOString();
                partida.reconciled_by = auth.userId;
                if (partida.original_unit_price_before_reconciliation == null) {
                    partida.original_unit_price_before_reconciliation = partida.unitPrice;
                }
                partida.divergence_pct = undefined;
                partida.divergence_amount = undefined;

                auditEntries.push({
                    actorUid: auth.userId,
                    actorEmail: auth.email ?? null,
                    budgetId,
                    partidaId: partida.id,
                    partidaCode: partida.code,
                    method: 'scale_breakdown_to_unit_price',
                    unitPrice: partida.unitPrice,
                    sumBefore: Math.round(sumBefore * 100) / 100,
                    scale: Math.round(scale * 10000) / 10000,
                    before,
                    after: partida.breakdown.map((b) => ({
                        code: b.code ?? null,
                        price: b.price,
                        total: b.total,
                    })),
                    timestamp: new Date().toISOString(),
                });

                reconciled++;
            }
        }

        if (reconciled === 0) {
            return { ok: true, reconciled: 0, skipped };
        }

        await budgetRepository.save(budget);

        // Audit log batch (best-effort; no rompemos si falla)
        try {
            const auditRef = adminDb.collection('audit_logs');
            for (const entry of auditEntries) {
                await auditRef.add({ kind: 'partida_reconciliation', ...entry });
            }
        } catch (auditErr) {
            console.warn('[reconcile] audit log failed (non-fatal)', auditErr);
        }

        revalidatePath(`/dashboard/admin/budgets/${budgetId}`);
        revalidatePath('/dashboard/admin/budgets');

        return { ok: true, reconciled, skipped };
    } catch (error: any) {
        console.error('[reconcile] error', error);
        return {
            ok: false,
            reconciled: 0,
            skipped: 0,
            error: error?.message || 'unknown_error',
        };
    }
}

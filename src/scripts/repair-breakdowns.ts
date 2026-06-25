/**
 * Backfill: reparar descompuestos a 0 desde el catálogo COAATMCA.
 *
 * Escanea todos los presupuestos y, para cada partida cuyo descompuesto suma ~0
 * (bug de precios perdidos) aunque emparejó con un candidato del catálogo,
 * re-pobla los precios desde `prices/coaatmca_2025_price_book.json` (fuente de
 * verdad) y los escala al `unitPrice` validado de la partida (el total NO cambia).
 *
 * Uso:
 *   npx tsx src/scripts/repair-breakdowns.ts                 # dry-run (no escribe)
 *   npx tsx src/scripts/repair-breakdowns.ts --commit        # aplica
 *   npx tsx src/scripts/repair-breakdowns.ts --commit --budget=<id>   # solo un budget
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Umbral: si la suma del descompuesto es < 1% del unitPrice, se considera "a 0".
const ZERO_RATIO = 0.01;

type CatalogComp = {
    code?: string;
    description?: string;
    unit?: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    is_variable?: boolean;
};

function normalizeCatalogBreakdown(breakdown: any[]): CatalogComp[] {
    return (breakdown || []).map((b) => {
        const quantity = Number(b.quantity ?? 0);
        const unitPrice = Number(
            b.price_unit ?? (quantity > 0 && typeof b.price === 'number' ? b.price / quantity : b.price) ?? 0,
        );
        const lineTotal = Number(typeof b.price === 'number' ? b.price : unitPrice * quantity);
        return { code: b.code, description: b.description, unit: b.unit, quantity, unitPrice, lineTotal, is_variable: b.is_variable === true };
    });
}

function getWinnerCode(partida: any): string | null {
    const winner = partida?.aiResolution?.selected_candidate ?? partida?.ai_resolution?.selected_candidate;
    if (!winner) return null;
    const code = typeof winner === 'string' ? winner : winner.code;
    return code ? String(code) : null;
}

function sumTotals(breakdown: any[]): number {
    return (breakdown || []).reduce((s: number, b: any) => s + Number(b.total ?? b.totalPrice ?? 0), 0);
}

async function main() {
    const commit = process.argv.includes('--commit');
    const onlyBudget = process.argv.find((a) => a.startsWith('--budget='))?.split('=')[1];

    const { initFirebaseAdminApp } = await import('@/backend/shared/infrastructure/firebase/admin-app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const { BudgetRepositoryFirestore } = await import('@/backend/budget/infrastructure/budget-repository-firestore');
    const { buildRepairedBreakdown } = await import('@/lib/budget/reconciliation');

    // 1. Indexar el catálogo COAATMCA por código de partida (fuente de verdad).
    const jsonPath = resolve(process.cwd(), 'prices/coaatmca_2025_price_book.json');
    const chaptersJson = JSON.parse(readFileSync(jsonPath, 'utf-8')) as any[];
    const catalogByCode = new Map<string, any>();
    for (const chap of chaptersJson) {
        for (const item of chap.items || chap.partidas || []) {
            if (item.code) catalogByCode.set(String(item.code), item);
        }
    }
    console.log(`\n📚 Catálogo indexado: ${catalogByCode.size} partidas.`);

    initFirebaseAdminApp();
    const db = getFirestore();
    const repo = new BudgetRepositoryFirestore();

    const budgetIds = onlyBudget
        ? [onlyBudget]
        : (await db.collection('budgets').get()).docs.map((d) => d.id);
    console.log(`📋 ${budgetIds.length} presupuestos a revisar.\n`);

    let totalRepaired = 0;
    let totalSkipped = 0;

    for (const budgetId of budgetIds) {
        const budget = await repo.findById(budgetId);
        if (!budget) continue;

        let changed = false;
        const repairedInBudget: string[] = [];
        const skippedInBudget: string[] = [];

        for (const chapter of budget.chapters || []) {
            for (const partida of chapter.items || []) {
                const p: any = partida;
                const breakdown = p.breakdown || [];
                const unitPrice = Number(p.unitPrice || 0);
                if (breakdown.length === 0 || unitPrice <= 0) continue;

                const sum = sumTotals(breakdown);
                const hasZeroComp = breakdown.some((b: any) => {
                    const total = Number(b.total ?? b.totalPrice ?? 0);
                    const price = Number(b.price ?? b.unitPrice ?? 0);
                    return total <= 0.0001 && price <= 0.0001;
                });
                // El bug: suma a 0 (todos los componentes a 0) o algún componente a 0
                // (caso parcial donde la suma coincide por casualidad, p.ej. NL-15).
                if (sum >= unitPrice * ZERO_RATIO && !hasZeroComp) continue;

                const winnerCode = getWinnerCode(p);
                const catalogEntry = winnerCode ? catalogByCode.get(winnerCode) : null;
                if (!catalogEntry || !catalogEntry.breakdown?.length) {
                    skippedInBudget.push(`${p.code || p.id} (winner=${winnerCode ?? '—'} no en catálogo)`);
                    totalSkipped += 1;
                    continue;
                }

                const repaired = buildRepairedBreakdown(normalizeCatalogBreakdown(catalogEntry.breakdown), unitPrice);
                if (!repaired.length) {
                    skippedInBudget.push(`${p.code || p.id} (repair vacío)`);
                    totalSkipped += 1;
                    continue;
                }

                p.breakdown = repaired;
                p.needs_reconciliation = false;
                p.divergence_pct = null;
                p.divergence_amount = null;
                p.last_reconciled_at = new Date().toISOString();
                p.reconciled_by = 'backfill';
                changed = true;
                repairedInBudget.push(`${p.code || p.id} → ${winnerCode} (${repaired.length} comp, sum=${sumTotals(repaired).toFixed(2)} = ${unitPrice.toFixed(2)})`);
                totalRepaired += 1;
            }
        }

        if (repairedInBudget.length || skippedInBudget.length) {
            console.log(`\n🧾 ${budgetId}`);
            repairedInBudget.forEach((r) => console.log(`   ✅ ${r}`));
            skippedInBudget.forEach((s) => console.log(`   ⏭️  ${s}`));
        }

        if (changed && commit) {
            await repo.save(budget);
            console.log(`   💾 Guardado.`);
        }
    }

    console.log(`\n──────────────────────────────`);
    console.log(`Reparadas: ${totalRepaired} · Omitidas: ${totalSkipped}`);
    if (!commit) console.log('🟡 DRY-RUN. Re-ejecuta con --commit para aplicar.');
    else console.log('✅ Backfill aplicado.');
}

main().catch((err) => {
    console.error('❌ Error en repair-breakdowns:', err);
    process.exit(1);
});

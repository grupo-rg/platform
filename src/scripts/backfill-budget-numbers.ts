/**
 * Backfill de números de presupuesto tipo factura (YYYY-MM/NNNN).
 *
 * Asigna `budgetNumber` a todos los presupuestos existentes que aún no lo tienen,
 * ordenados por `createdAt` ascendente y agrupados por mes natural (la secuencia
 * reinicia cada mes). Tras el backfill, siembra el contador `counters/budget_number`
 * con el último número del periodo MÁS RECIENTE para que los nuevos presupuestos
 * continúen la secuencia sin colisiones.
 *
 * Uso:
 *   npx tsx src/scripts/backfill-budget-numbers.ts            # dry-run (no escribe)
 *   npx tsx src/scripts/backfill-budget-numbers.ts --commit   # aplica los cambios
 *   npx tsx src/scripts/backfill-budget-numbers.ts --commit --force  # renumera incluso los que ya tienen número
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config();

async function main() {
    const commit = process.argv.includes('--commit');
    const force = process.argv.includes('--force');

    const { initFirebaseAdminApp } = await import('@/backend/shared/infrastructure/firebase/admin-app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const { budgetPeriodOf, formatBudgetNumber } = await import('@/backend/budget/infrastructure/budget-number-generator');

    initFirebaseAdminApp();
    const db = getFirestore();

    const snap = await db.collection('budgets').orderBy('createdAt', 'asc').get();
    console.log(`\n📋 ${snap.size} presupuestos encontrados.\n`);

    const seqByPeriod = new Map<string, number>();
    const updates: { id: string; period: string; number: string; existing?: string }[] = [];

    for (const doc of snap.docs) {
        const data = doc.data();
        if (data.budgetNumber && !force) {
            // Conserva el periodo en el contador para no reciclar números ya emitidos.
            const period = String(data.budgetNumber).split('/')[0];
            const seq = Number(String(data.budgetNumber).split('/')[1] || 0);
            if (!Number.isNaN(seq)) {
                seqByPeriod.set(period, Math.max(seqByPeriod.get(period) || 0, seq));
            }
            continue;
        }

        const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt || Date.now());
        const period = budgetPeriodOf(createdAt);
        const nextSeq = (seqByPeriod.get(period) || 0) + 1;
        seqByPeriod.set(period, nextSeq);
        const number = formatBudgetNumber(period, nextSeq);
        updates.push({ id: doc.id, period, number, existing: data.budgetNumber });
    }

    for (const u of updates) {
        console.log(`  ${u.id}  →  ${u.number}${u.existing ? `  (antes: ${u.existing})` : ''}`);
    }
    console.log(`\n✏️  ${updates.length} presupuestos a (re)numerar.`);

    // Periodo con el número más alto = el que debe quedar en el contador para que
    // los nuevos presupuestos del mismo mes continúen la secuencia.
    const periods = Array.from(seqByPeriod.keys()).sort();
    const latestPeriod = periods[periods.length - 1];

    if (!commit) {
        console.log('\n🟡 DRY-RUN. Re-ejecuta con --commit para aplicar.');
        if (latestPeriod) {
            console.log(`   Contador quedaría en { period: "${latestPeriod}", lastSeq: ${seqByPeriod.get(latestPeriod)} }`);
        }
        return;
    }

    // Aplica en lotes (límite Firestore: 500 ops por batch).
    let batch = db.batch();
    let ops = 0;
    for (const u of updates) {
        batch.set(db.collection('budgets').doc(u.id), { budgetNumber: u.number }, { merge: true });
        if (++ops >= 450) {
            await batch.commit();
            batch = db.batch();
            ops = 0;
        }
    }
    if (ops > 0) await batch.commit();

    if (latestPeriod) {
        await db.collection('counters').doc('budget_number').set(
            { period: latestPeriod, lastSeq: seqByPeriod.get(latestPeriod), updatedAt: new Date() },
            { merge: true },
        );
        console.log(`\n🔢 Contador sembrado: { period: "${latestPeriod}", lastSeq: ${seqByPeriod.get(latestPeriod)} }`);
    }

    console.log('\n✅ Backfill completado.');
}

main().catch((err) => {
    console.error('❌ Error en backfill:', err);
    process.exit(1);
});

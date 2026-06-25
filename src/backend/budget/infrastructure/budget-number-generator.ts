// src/backend/budget/infrastructure/budget-number-generator.ts
import type { Firestore } from 'firebase-admin/firestore';

/**
 * Genera números de presupuesto secuenciales tipo factura con formato
 * `YYYY-MM/NNNN` (p.ej. "2026-06/0001"). La secuencia reinicia cada mes natural.
 *
 * La asignación es atómica: usa una transacción Firestore sobre un único
 * documento contador (`counters/budget_number`) para garantizar que dos
 * presupuestos creados concurrentemente nunca reciban el mismo número.
 */

const COUNTER_COLLECTION = 'counters';
const COUNTER_DOC = 'budget_number';
const SEQ_PAD = 4;

/** Devuelve el periodo `YYYY-MM` de una fecha dada (por defecto, ahora). */
export function budgetPeriodOf(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** Formatea un periodo + secuencia al número final `YYYY-MM/NNNN`. */
export function formatBudgetNumber(period: string, seq: number): string {
  return `${period}/${String(seq).padStart(SEQ_PAD, '0')}`;
}

/**
 * Reserva y devuelve el siguiente número de presupuesto para el periodo actual.
 * Reinicia la secuencia a 1 cuando cambia el mes.
 */
export async function generateNextBudgetNumber(
  db: Firestore,
  date: Date = new Date(),
): Promise<string> {
  const period = budgetPeriodOf(date);
  const counterRef = db.collection(COUNTER_COLLECTION).doc(COUNTER_DOC);

  const seq = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const data = snap.exists ? snap.data() : undefined;
    const nextSeq = data?.period === period ? Number(data.lastSeq || 0) + 1 : 1;
    tx.set(counterRef, { period, lastSeq: nextSeq, updatedAt: date }, { merge: true });
    return nextSeq;
  });

  return formatBudgetNumber(period, seq);
}

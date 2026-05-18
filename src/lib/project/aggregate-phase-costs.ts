import type { Project } from '@/backend/project/domain/project';
import type { Expense } from '@/backend/expense/domain/expense';

/**
 * Calcula el coste real de cada fase agregando todas las líneas de factura
 * vinculadas. Soporta dos formas de vinculación (la UI/extracción puede usar
 * una u otra según contexto):
 *
 *   1. `line.phaseId === phase.id` — match exacto, preferido.
 *   2. `line.budgetChapter === phase.name` (case-insensitive) — fallback útil
 *      cuando el gasto se extrajo por IA contra un capítulo del Budget cuyo
 *      nombre coincide con la fase pero sin haber persistido el `phaseId`.
 *
 * Las líneas sin vinculación (sin `phaseId` ni `budgetChapter` casable) se
 * acumulan en `unassigned`. Eso permite al UI mostrar "X € sin asignar" y
 * empujar al usuario a re-categorizar.
 */
export interface PhaseCostAggregation {
    /** Por fase: `{ [phase.id]: totalRealCost }`. */
    byPhase: Record<string, number>;
    /** Gastos no vinculados a ninguna fase. */
    unassigned: number;
    /** Total agregado de todos los gastos (= sum byPhase + unassigned). */
    total: number;
}

export function aggregatePhaseRealCosts(
    project: Project,
    expenses: Expense[],
): PhaseCostAggregation {
    const phaseById = new Map(project.phases.map(p => [p.id, p]));
    const phaseByNormalizedName = new Map(
        project.phases.map(p => [p.name.toLowerCase().trim(), p.id]),
    );

    const byPhase: Record<string, number> = {};
    let unassigned = 0;

    for (const expense of expenses) {
        for (const line of expense.lines || []) {
            const lineTotal = line.total ?? line.quantity * line.unitPrice;
            let phaseId: string | null = null;

            if (line.phaseId && phaseById.has(line.phaseId)) {
                phaseId = line.phaseId;
            } else if (line.budgetChapter) {
                const normalized = line.budgetChapter.toLowerCase().trim();
                phaseId = phaseByNormalizedName.get(normalized) ?? null;
            }

            if (phaseId) {
                byPhase[phaseId] = (byPhase[phaseId] || 0) + lineTotal;
            } else {
                unassigned += lineTotal;
            }
        }
    }

    const total = Object.values(byPhase).reduce((acc, v) => acc + v, 0) + unassigned;
    return { byPhase, unassigned, total };
}

/**
 * Coste real efectivo de una fase: si el usuario fijó `phase.realCost` manual
 * (>0) lo respetamos como override; si no, derivamos del agregado de gastos.
 * Esto permite mantener el comportamiento manual existente sin romper.
 */
export function effectivePhaseRealCost(
    phase: { id: string; realCost?: number },
    aggregated: PhaseCostAggregation,
): number {
    if (phase.realCost && phase.realCost > 0) return phase.realCost;
    return aggregated.byPhase[phase.id] || 0;
}

/**
 * Clasifica el estado financiero de una fase a partir de su realCost vs
 * estimatedCost. Permite a la UI pintar un badge único sin duplicar lógica.
 *
 *   - 'ok'        — sin gastos todavía o real <90 % del estimado.
 *   - 'tracking'  — entre 90 % y 100 % del estimado.
 *   - 'tight'     — entre 100 % y 110 % (ligera desviación).
 *   - 'over'      — >110 % del estimado (sobrecoste grave).
 *   - 'unbudgeted'— hay gasto real pero la fase no tiene estimado (no calculable).
 */
export type PhaseCostStatus = 'ok' | 'tracking' | 'tight' | 'over' | 'unbudgeted';

export function phaseCostStatus(real: number, estimated: number): PhaseCostStatus {
    if (real <= 0) return 'ok';
    if (estimated <= 0) return 'unbudgeted';
    const ratio = real / estimated;
    if (ratio < 0.9) return 'ok';
    if (ratio < 1.0) return 'tracking';
    if (ratio <= 1.1) return 'tight';
    return 'over';
}

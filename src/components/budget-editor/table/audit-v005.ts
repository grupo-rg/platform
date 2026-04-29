/**
 * Fase 5.F — sub-componentes del panel de auditoría v005.
 *
 * Presentación pura (sin estado, sin efectos, sin Radix) de los nuevos campos
 * del Judge que el Swarm emite desde 5.A:
 *   - `match_kind`               : chip que resume el tipo de match.
 *   - `unit_conversion_applied`  : fórmula legible del puente físico aplicado.
 *   - `matchScore` / `rejected_reason` de cada candidato.
 *
 * Implementados con `React.createElement` (sin JSX) para que Vitest 4 + rolldown
 * los procese sin necesidad de `@vitejs/plugin-react`. El consumidor final
 * (`AIReasoningSheet.tsx`) los usa como cualquier otro componente React.
 * Si el campo v005 está ausente (presupuestos históricos), cada componente
 * devuelve `null` — UI idéntica a la de antes del sprint.
 */
import React from 'react';
import type { MatchKind, UnitConversionRecord } from '@/backend/budget/domain/budget';

const h = React.createElement;

// -------- MatchKind chip ----------------------------------------------------

const MATCH_KIND_LABEL: Record<MatchKind, string> = {
    '1:1': '1:1 exacto',
    '1:N': '1:N compuesto',
    'from_scratch': 'Desde cero',
};

const MATCH_KIND_CLASSES: Record<MatchKind, string> = {
    '1:1': 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800',
    '1:N': 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:border-indigo-800',
    'from_scratch': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800',
};

export function MatchKindChip({ matchKind }: { matchKind?: MatchKind | null }) {
    if (!matchKind) return null;
    return h(
        'span',
        {
            'data-testid': 'match-kind-chip',
            'data-match-kind': matchKind,
            className: `inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-widest ${MATCH_KIND_CLASSES[matchKind]}`,
        },
        MATCH_KIND_LABEL[matchKind]
    );
}

// -------- Unit conversion formula ------------------------------------------

const BRIDGE_LABEL: Record<string, (v: number) => string> = {
    thickness_m: (v) => `espesor ${v} m`,
    density_kg_m3: (v) => `densidad ${v} kg/m³`,
    piece_length_m: (v) => `pieza ${v} m`,
};

export function formatBridge(bridge: Record<string, number>): string {
    const entries = Object.entries(bridge);
    if (entries.length === 0) return 'puente sin especificar';
    return entries
        .map(([k, v]) => (BRIDGE_LABEL[k] ? BRIDGE_LABEL[k](v) : `${k} = ${v}`))
        .join(', ');
}

export function UnitConversionApplied({ record }: { record?: UnitConversionRecord | null }) {
    if (!record) return null;
    return h(
        'div',
        {
            'data-testid': 'unit-conversion-applied',
            className:
                'mt-3 bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-300 text-xs p-2.5 rounded-lg border border-sky-200 dark:border-sky-800/50 flex flex-col gap-1',
        },
        h(
            'p',
            {
                className:
                    'font-semibold uppercase tracking-widest text-[10px] text-sky-600 dark:text-sky-400',
            },
            'Conversión de unidad aplicada'
        ),
        h(
            'p',
            {
                'data-testid': 'unit-conversion-formula',
                className: 'font-mono text-[11px] leading-relaxed',
            },
            `${record.value} ${record.from_unit} × ${formatBridge(record.bridge)} = ${record.result} ${record.to_unit}`
        )
    );
}

// -------- Applied fragments (Fase 6.D) --------------------------------------

/**
 * Badge que resume cuántos HeuristicFragments aplicó el Swarm al tasar esta
 * partida. Se queda oculto si no hubo fragments (presupuestos v005 o anteriores).
 * El título del elemento lleva los IDs completos para trazabilidad auditora.
 */
export function AppliedFragmentsBadge({ fragments }: { fragments?: string[] | null }) {
    if (!fragments || fragments.length === 0) return null;
    const count = fragments.length;
    const label = count === 1 ? '1 corrección previa' : `${count} correcciones previas`;
    return h(
        'span',
        {
            'data-testid': 'applied-fragments-badge',
            title: `Fragments aplicados: ${fragments.join(', ')}`,
            className:
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-widest ' +
                'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200 dark:bg-fuchsia-950/40 dark:text-fuchsia-300 dark:border-fuchsia-800',
        },
        `🧠 Basado en ${label}`
    );
}

// -------- Candidate audit meta (score + rejected_reason) --------------------

export interface CandidateAuditMeta {
    matchScore?: number;
    score?: number;
    rejected_reason?: string;
    rejectedReason?: string;
    kind?: 'item' | 'breakdown';
}

export function CandidateMetaBadges({ candidate }: { candidate: CandidateAuditMeta }) {
    const rawScore = candidate.matchScore ?? candidate.score;
    const score = typeof rawScore === 'number' ? rawScore : undefined;
    const reason = candidate.rejected_reason ?? candidate.rejectedReason;
    const kind = candidate.kind;
    if (score === undefined && !reason && !kind) return null;

    const children: React.ReactNode[] = [];
    if (kind) {
        children.push(
            h(
                'span',
                {
                    key: 'kind',
                    'data-testid': 'candidate-kind',
                    className:
                        'inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-widest bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
                },
                kind
            )
        );
    }
    if (score !== undefined) {
        children.push(
            h(
                'span',
                {
                    key: 'score',
                    'data-testid': 'candidate-score',
                    title: 'Similitud del vector search',
                    className:
                        'inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-mono tabular-nums bg-white text-indigo-700 border-indigo-200 dark:bg-black/40 dark:text-indigo-300 dark:border-indigo-800',
                },
                `score ${score.toFixed(2)}`
            )
        );
    }
    if (reason) {
        children.push(
            h(
                'span',
                {
                    key: 'reason',
                    'data-testid': 'candidate-rejected-reason',
                    title: 'Motivo por el que el Judge descartó este candidato',
                    className:
                        'inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] italic bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
                },
                reason
            )
        );
    }
    return h(
        'div',
        {
            'data-testid': 'candidate-meta',
            className: 'flex flex-wrap items-center gap-1.5',
        },
        ...children
    );
}

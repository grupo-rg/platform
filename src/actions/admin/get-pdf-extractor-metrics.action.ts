'use server';

/**
 * Sprint 4 Fase B (B2) — agregador de métricas del extractor de PDFs cliente.
 *
 * Lee los eventos de telemetría persistidos en
 * `pipeline_telemetry/{budgetId}/events` durante las últimas 24h y agrupa por
 * `method` (parser TABULAR vs heurística legacy S3-06 vs Fase 9.2 vs LLM
 * Vision) para alimentar el panel "PDF Extractor V2" del dashboard
 * `/dashboard/admin/model-health`.
 *
 * Eventos relevantes (definidos por el backend Sprint 4 Fase A):
 *   - `inline_fast_path_used` con `data.method` ∈
 *     ['tabular_parser_coord_based' | 'pdfplumber_first_tabular' |
 *      'layout_analyzer_heuristic']. → counter por método + qty_rate /
 *     chapter_rate cuando vienen.
 *   - `tabular_parser_completed` con `data.qtyRate / chapterRate /
 *     durationSeconds`. → muestras finas del parser TABULAR.
 *   - `pipeline_error` con `data.errorType=EXTRACTOR_LAYOUT_UNSUPPORTED` →
 *     counter de aborts A9 (PDF >50pp que habría caído a LLM Vision).
 *
 * Si NINGÚN evento `inline_fast_path_used` aparece para un budget, asumimos
 * que cayó al path LLM Vision (no hay fast path → flujo pre-Sprint 4).
 *
 * Auth: admin only. Cachea 5 minutos en memoria (Next).
 */

import { verifyAuth } from '@/backend/auth/auth.middleware';
import { adminFirestore } from '@/backend/shared/infrastructure/firebase/admin-app';

export const revalidate = 300;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// Cap defensivo: nunca leemos más de N budgets de pipeline_telemetry para
// evitar lecturas runaway. 200 es el mismo cap de get-model-health.action.
const MAX_BUDGETS_TO_SCAN = 200;

export type ExtractorMethod =
    | 'tabular_parser_coord_based'
    | 'pdfplumber_first_tabular'
    | 'layout_analyzer_heuristic'
    | 'llm_vision_fallback';

export interface MethodBreakdownEntry {
    method: ExtractorMethod;
    /** Número de budgets que terminaron con este método. */
    count: number;
    /** Fracción 0-1 sobre total. */
    pct: number;
}

export interface PdfExtractorMetricsPayload {
    /** Total de budgets con telemetría en la ventana (incluye los que NO usaron fast path). */
    totalBudgets: number;
    /** Total de budgets cuyo fast path se usó (tabular | pdfplumber | heuristic). */
    fastPathBudgets: number;
    /** Total que NO usaron fast path (cayeron a LLM Vision). */
    llmVisionBudgets: number;
    /** Aborts A9 (LayoutUnsupportedError) en la ventana. */
    layoutUnsupportedCount: number;
    /** Desglose por método (suma TODOS los métodos, llm_vision_fallback incluido). */
    methodBreakdown: MethodBreakdownEntry[];
    /** Media simple del qty_rate del parser TABULAR en la ventana. `null` si no hay muestras. */
    avgTabularQtyRate: number | null;
    /** Media simple del chapter_rate del parser TABULAR. `null` si no hay muestras. */
    avgTabularChapterRate: number | null;
    /** Número de muestras del parser TABULAR (tabular_parser_completed events). */
    tabularSamples: number;
    /** ISO timestamp del cálculo. */
    generatedAt: string;
    /** Ventana en horas analizadas (default 24). */
    windowHours: number;
}

export type PdfExtractorMetricsResult =
    | { success: true; data: PdfExtractorMetricsPayload }
    | { success: false; error: string };

function timestampToMs(value: any): number | null {
    if (!value) return null;
    if (typeof value === 'string') {
        const t = new Date(value).getTime();
        return Number.isFinite(t) ? t : null;
    }
    if (typeof value === 'number') return value;
    if (typeof value?.toDate === 'function') {
        try {
            return value.toDate().getTime();
        } catch {
            return null;
        }
    }
    if (value instanceof Date) return value.getTime();
    return null;
}

function normalizeMethod(raw: any): ExtractorMethod | null {
    if (typeof raw !== 'string') return null;
    const v = raw.trim().toLowerCase();
    if (v === 'tabular_parser_coord_based') return 'tabular_parser_coord_based';
    if (v === 'pdfplumber_first_tabular') return 'pdfplumber_first_tabular';
    if (v === 'layout_analyzer_heuristic') return 'layout_analyzer_heuristic';
    return null;
}

export async function getPdfExtractorMetricsAction(): Promise<PdfExtractorMetricsResult> {
    const auth = await verifyAuth(true);
    if (!auth) return { success: false, error: 'forbidden' };

    try {
        const cutoffMs = Date.now() - ONE_DAY_MS;

        const rootSnap = await adminFirestore
            .collection('pipeline_telemetry')
            .limit(MAX_BUDGETS_TO_SCAN)
            .get();

        const methodCounts: Record<ExtractorMethod, number> = {
            tabular_parser_coord_based: 0,
            pdfplumber_first_tabular: 0,
            layout_analyzer_heuristic: 0,
            llm_vision_fallback: 0,
        };

        const tabularQtyRates: number[] = [];
        const tabularChapterRates: number[] = [];
        let layoutUnsupportedCount = 0;
        let totalBudgetsInWindow = 0;
        let fastPathBudgets = 0;

        // Procesamos cada budget en paralelo limitado (Firestore SDK ya hace pooling).
        await Promise.all(
            rootSnap.docs.map(async (doc) => {
                const evSnap = await doc.ref.collection('events').get();
                let budgetTouchedWindow = false;
                let methodForBudget: ExtractorMethod | null = null;

                for (const ev of evSnap.docs) {
                    const data = ev.data() as any;
                    const tsMs = timestampToMs(data.timestamp);
                    if (tsMs == null) continue;
                    if (tsMs < cutoffMs) continue;
                    budgetTouchedWindow = true;

                    const type = data.type;
                    const inner = data.data || {};

                    if (type === 'inline_fast_path_used') {
                        const m = normalizeMethod(inner.method);
                        if (m && methodForBudget === null) {
                            methodForBudget = m;
                        }
                    } else if (type === 'tabular_parser_completed') {
                        const qty = Number(inner.qtyRate);
                        const ch = Number(inner.chapterRate);
                        if (Number.isFinite(qty) && qty >= 0 && qty <= 1) {
                            tabularQtyRates.push(qty);
                        }
                        if (Number.isFinite(ch) && ch >= 0 && ch <= 1) {
                            tabularChapterRates.push(ch);
                        }
                    } else if (type === 'pipeline_error') {
                        const errorType = inner.errorType ?? inner.error_type;
                        if (errorType === 'EXTRACTOR_LAYOUT_UNSUPPORTED') {
                            layoutUnsupportedCount++;
                        }
                    }
                }

                if (!budgetTouchedWindow) return;
                totalBudgetsInWindow++;
                if (methodForBudget) {
                    methodCounts[methodForBudget]++;
                    fastPathBudgets++;
                } else {
                    // Sin fast path → cayó a LLM Vision (pre-Sprint 4 path).
                    methodCounts.llm_vision_fallback++;
                }
            }),
        );

        const totalForPct = totalBudgetsInWindow > 0 ? totalBudgetsInWindow : 1;
        const methodBreakdown: MethodBreakdownEntry[] = (
            Object.keys(methodCounts) as ExtractorMethod[]
        ).map((method) => ({
            method,
            count: methodCounts[method],
            pct: methodCounts[method] / totalForPct,
        }));

        const avg = (arr: number[]): number | null =>
            arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length;

        const payload: PdfExtractorMetricsPayload = {
            totalBudgets: totalBudgetsInWindow,
            fastPathBudgets,
            llmVisionBudgets: methodCounts.llm_vision_fallback,
            layoutUnsupportedCount,
            methodBreakdown,
            avgTabularQtyRate: avg(tabularQtyRates),
            avgTabularChapterRate: avg(tabularChapterRates),
            tabularSamples: tabularQtyRates.length,
            generatedAt: new Date().toISOString(),
            windowHours: 24,
        };

        return { success: true, data: payload };
    } catch (error: any) {
        console.error('[getPdfExtractorMetricsAction] failed', error);
        return { success: false, error: error?.message || 'unknown_error' };
    }
}

import { describe, it, expect } from 'vitest';
import { eventToPhase, buildSubEvent } from './budget-generation-events';

// Fuente de verdad de los 14 tipos de evento que documenta
// `docs/ai-pipelines-diagnostic-and-plan.md § 3`.
const EVENT_CONTRACT: Array<{ type: string; phase: 'extracting' | 'searching' | 'calculating' | 'complete' | null }> = [
    { type: 'extraction_started',          phase: 'extracting' },
    { type: 'subtasks_extracted',          phase: 'extracting' },
    { type: 'restructuring',               phase: 'extracting' },
    { type: 'batch_restructure_submitted', phase: 'extracting' },
    { type: 'extraction_retry_minimal',    phase: 'extracting' },
    { type: 'extraction_partial_success',  phase: 'extracting' },
    { type: 'cross_page_merge',            phase: 'extracting' },
    { type: 'extraction_failed_chunk',     phase: 'extracting' },
    { type: 'query_expansion_started',     phase: 'searching' },
    { type: 'vector_search_started',       phase: 'searching' },
    { type: 'vector_search_completed',     phase: 'searching' },
    { type: 'vector_search',               phase: 'searching' },
    { type: 'batch_pricing_submitted',     phase: 'searching' },
    { type: 'judge_evaluating',            phase: 'calculating' },
    { type: 'item_resolved',               phase: 'calculating' },
    { type: 'item_skipped',                phase: 'calculating' },
    { type: 'budget_completed',            phase: 'complete' },
    // Fase 10.1 — eventos nuevos de Fase 7-9
    { type: 'inline_fast_path_used',       phase: 'extracting' },
    { type: 'cross_page_merge_annexed',    phase: 'extracting' },
    { type: 'partida_description_short',   phase: 'extracting' },
    { type: 'tier_assigned',               phase: 'searching' },
    { type: 'tier_escalated',              phase: 'searching' },
    { type: 'rerank_applied',              phase: 'searching' },
    { type: 'partida_price_anomaly',       phase: 'calculating' },
    // Fase 11.A — guard defensivo del breakdown
    { type: 'breakdown_scaled_defensive',  phase: 'calculating' },
    { type: 'breakdown_sum_divergence',    phase: 'calculating' },
];

describe('eventToPhase — contrato de telemetría', () => {
    it('mapea cada tipo documentado a la fase correcta', () => {
        for (const { type, phase } of EVENT_CONTRACT) {
            expect(eventToPhase(type), `tipo ${type}`).toBe(phase);
        }
    });

    it('devuelve null para tipos desconocidos (no los pinta en ninguna fase)', () => {
        expect(eventToPhase('unknown_event')).toBeNull();
        expect(eventToPhase('')).toBeNull();
    });
});

describe('buildSubEvent — render amigable por tipo', () => {
    it('subtasks_extracted muestra el número de tareas', () => {
        const ev = buildSubEvent(
            { type: 'subtasks_extracted', data: { totalTasks: 28 } },
            'k1',
            1_700_000_000,
        );
        expect(ev).not.toBeNull();
        expect(ev!.title).toMatch(/28 tareas/);
        expect(ev!.kind).toBe('info');
    });

    it('item_resolved pinta el precio formateado y trunca descripción larga', () => {
        const ev = buildSubEvent(
            {
                type: 'item_resolved',
                data: {
                    item: {
                        code: 'X.1',
                        description: 'A'.repeat(100),
                        totalPrice: 1234.56,
                    },
                },
            },
            'k2',
            0,
        );
        expect(ev!.kind).toBe('resolved');
        expect(ev!.title.length).toBeLessThanOrEqual(61); // 60 chars + ellipsis
        expect(ev!.detail).toMatch(/1\.?234|1,234|1235/); // locale-dependent formatting
    });

    it('extraction_failed_chunk marca kind="error" y muestra página', () => {
        const ev = buildSubEvent(
            { type: 'extraction_failed_chunk', data: { page: 7, error: 'JSON truncado' } },
            'k3',
            0,
        );
        expect(ev!.kind).toBe('error');
        expect(ev!.title).toMatch(/7/);
    });

    it('extraction_partial_success muestra página + items rescatados', () => {
        const ev = buildSubEvent(
            { type: 'extraction_partial_success', data: { page: 12, items_recovered: 8 } },
            'k-rescue',
            0,
        );
        expect(ev!.kind).toBe('info');
        expect(ev!.title).toMatch(/12/);
        expect(ev!.detail).toMatch(/8 items/);
    });

    it('cross_page_merge indica páginas origen/destino y chars fusionados', () => {
        const ev = buildSubEvent(
            { type: 'cross_page_merge', data: { from_page: 5, to_page: 6, tail_chars: 72 } },
            'k-merge',
            0,
        );
        expect(ev!.kind).toBe('info');
        expect(ev!.title).toMatch(/5.*6/);
        expect(ev!.detail).toMatch(/72 chars/);
    });

    it('query_expansion_started incluye el capítulo', () => {
        const ev = buildSubEvent(
            { type: 'query_expansion_started', data: { chapter: 'DEMOLICIONES', task: 'Picado alicatado' } },
            'k4',
            0,
        );
        expect(ev!.kind).toBe('search');
        expect(ev!.title).toMatch(/DEMOLICIONES/);
    });

    it('item_skipped marca kind="error" y muestra código + tipo de error', () => {
        const ev = buildSubEvent(
            {
                type: 'item_skipped',
                data: { code: 'C03.14', reason: 'unit value is None', error_type: 'ValidationError' },
            },
            'k-skip',
            0,
        );
        expect(ev!.kind).toBe('error');
        expect(ev!.title).toMatch(/C03\.14/);
        expect(ev!.detail).toMatch(/ValidationError/);
    });

    it('devuelve null para tipos no soportados', () => {
        expect(buildSubEvent({ type: 'totally_unknown', data: {} }, 'k', 0)).toBeNull();
    });

    // Fase 10.1 — render de eventos nuevos
    it('inline_fast_path_used muestra cuántas partidas salieron sin LLM', () => {
        const ev = buildSubEvent(
            { type: 'inline_fast_path_used', data: { partidas_count: 64, method: 'layout_analyzer_heuristic' } },
            'k-fp', 0,
        );
        expect(ev!.kind).toBe('resolved');
        expect(ev!.title).toMatch(/64/);
        expect(ev!.title.toLowerCase()).toMatch(/sin llm|heur|fast/);
    });

    it('tier_assigned indica tier y código de partida', () => {
        const ev = buildSubEvent(
            { type: 'tier_assigned', data: { code: 'C04.02', tier: 'flash', reason: 'score 0.92' } },
            'k-tier', 0,
        );
        expect(ev!.kind).toBe('info');
        expect(ev!.title).toMatch(/C04\.02/);
        expect(ev!.title.toUpperCase()).toMatch(/FLASH/);
    });

    it('tier_escalated marca el cambio Flash → Pro', () => {
        const ev = buildSubEvent(
            { type: 'tier_escalated', data: { code: 'C02.01', from_tier: 'flash', to_tier: 'pro', reason: 'from_scratch' } },
            'k-esc', 0,
        );
        expect(ev!.kind).toBe('info');
        expect(ev!.title).toMatch(/C02\.01/);
        expect(ev!.title.toLowerCase()).toMatch(/escalad|pro/);
    });

    it('rerank_applied muestra reducción input → output', () => {
        const ev = buildSubEvent(
            { type: 'rerank_applied', data: { code: 'C01.01', input_size: 10, output_size: 3, selected_ids: ['A', 'B', 'C'] } },
            'k-rr', 0,
        );
        expect(ev!.kind).toBe('search');
        expect(ev!.title).toMatch(/10.*3/);
    });

    it('partida_price_anomaly marca kind=error con código y total', () => {
        const ev = buildSubEvent(
            {
                type: 'partida_price_anomaly',
                data: {
                    code: 'C02.01', unit_price: 20496.25, quantity: 339.02,
                    unit: 'm2', total_price: 6948638.67, threshold: 100000.0,
                    reason: 'unit_price × quantity > 100K',
                },
            },
            'k-anom', 0,
        );
        expect(ev!.kind).toBe('error');
        expect(ev!.title).toMatch(/C02\.01/);
        expect(ev!.detail).toMatch(/6\.?948|6,948/); // total_price formateado
    });

    it('partida_description_short marca kind=error con chars y código', () => {
        const ev = buildSubEvent(
            { type: 'partida_description_short', data: { code: 'C04.02', chars: 38, chapter: 'C04 PAVIMENTOS', preview: 'SOLADO GRES' } },
            'k-short', 0,
        );
        expect(ev!.kind).toBe('error');
        expect(ev!.title).toMatch(/C04\.02/);
        expect(ev!.detail).toMatch(/38/);
    });

    it('cross_page_merge_annexed sigue el patrón de cross_page_merge', () => {
        const ev = buildSubEvent(
            { type: 'cross_page_merge_annexed', data: { from_page: 23, to_page: 24, tail_chars: 180, partida_code: 'C04.02' } },
            'k-cpm', 0,
        );
        expect(ev!.kind).toBe('info');
        expect(ev!.title).toMatch(/C04\.02/);
        expect(ev!.detail).toMatch(/180/);
    });

    // Fase 11.A — guard del boundary contra breakdown sin escalar
    it('breakdown_scaled_defensive es info con factor y ratio previo', () => {
        const ev = buildSubEvent(
            { type: 'breakdown_scaled_defensive', data: { code: '01.03', factor: 0.25, ratio_before: 4.0 } },
            'k-bsd', 0,
        );
        expect(ev!.kind).toBe('info');
        expect(ev!.title).toMatch(/01\.03/);
        expect(ev!.detail).toMatch(/0\.25/);
    });

    it('breakdown_sum_divergence es error con sumatorio y ratio', () => {
        const ev = buildSubEvent(
            { type: 'breakdown_sum_divergence', data: { code: '01.03', sum_total: 165.46, unit_price: 41.37, ratio: 4.0 } },
            'k-bsdiv', 0,
        );
        expect(ev!.kind).toBe('error');
        expect(ev!.title).toMatch(/01\.03/);
        expect(ev!.detail).toMatch(/165\.46|41\.37/);
    });
});

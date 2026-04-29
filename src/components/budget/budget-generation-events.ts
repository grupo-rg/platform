/**
 * Funciones puras que traducen eventos de telemetría (Firestore/SSE) a la
 * estructura que pinta el timeline en el UI. Extraídas del componente React
 * para que tengan tests unitarios sin arrastrar dependencias de JSX.
 *
 * Si añades un tipo de evento nuevo:
 *  1. `eventToPhase` decide en qué fase visual aparece.
 *  2. `buildSubEvent` lo convierte en una tarjeta con título + detalle.
 *  3. Documéntalo también en `docs/ai-pipelines-diagnostic-and-plan.md § 3`.
 */

export type PhaseId = 'extracting' | 'searching' | 'calculating' | 'complete';

export type SubEvent = {
    id: string;
    kind: 'info' | 'search' | 'resolved' | 'error';
    title: string;
    detail?: string;
    ts: number;
};

export function eventToPhase(type: string): PhaseId | null {
    if (
        type === 'extraction_started' ||
        type === 'subtasks_extracted' ||
        type === 'restructuring' ||
        type === 'batch_restructure_submitted' ||
        type === 'extraction_retry_minimal' ||
        type === 'extraction_partial_success' ||
        type === 'cross_page_merge' ||
        // Fase 10.1 — eventos nuevos (Fase 7-9)
        type === 'inline_fast_path_used' ||
        type === 'cross_page_merge_annexed' ||
        type === 'partida_description_short'
    ) return 'extracting';
    if (
        type === 'vector_search' ||
        type === 'vector_search_started' ||
        type === 'vector_search_completed' ||
        type === 'query_expansion_started' ||
        type === 'batch_pricing_submitted' ||
        // Fase 10.1
        type === 'tier_assigned' ||
        type === 'tier_escalated' ||
        type === 'rerank_applied'
    ) return 'searching';
    if (
        type === 'item_resolved' ||
        type === 'judge_evaluating' ||
        type === 'item_skipped' ||
        type === 'partida_price_anomaly' ||
        // Fase 11.A — boundary defensivo del breakdown
        type === 'breakdown_scaled_defensive' ||
        type === 'breakdown_sum_divergence'
    ) return 'calculating';
    if (type === 'budget_completed') return 'complete';
    if (type === 'extraction_failed_chunk') return 'extracting'; // pintado con kind='error'
    return null;
}

export function buildSubEvent(parsed: any, uniqueKey: any, ts: number): SubEvent | null {
    const type = parsed.type as string;
    const data = parsed.data ?? {};
    const id = String(uniqueKey) + '-' + type;
    switch (type) {
        case 'extraction_started':
            return { id, kind: 'info', title: 'Analizando requisitos estructurales', ts };
        case 'subtasks_extracted':
            return { id, kind: 'info', title: `${data.totalTasks ?? '?'} tareas identificadas`, ts };
        case 'restructuring':
        case 'batch_restructure_submitted':
            return { id, kind: 'info', title: 'Reestructurando partidas…', detail: data.query, ts };
        case 'query_expansion_started':
            return {
                id,
                kind: 'search',
                title: `Generando queries [${data.chapter || '?'}]`,
                detail: (data.task || '').substring(0, 80),
                ts,
            };
        case 'vector_search':
        case 'vector_search_started':
            return { id, kind: 'search', title: 'Consultando libro de precios', detail: data.query, ts };
        case 'vector_search_completed':
            return {
                id,
                kind: 'info',
                title: `${data.candidatesCount ?? 0} candidatos encontrados`,
                ts,
            };
        case 'batch_pricing_submitted':
            return { id, kind: 'search', title: 'Lote de precios en curso', detail: data.query, ts };
        case 'judge_evaluating':
            return {
                id,
                kind: 'info',
                title: `Evaluando candidatos [${data.chapter || '?'}]`,
                detail: data.candidatesCount ? `${data.candidatesCount} candidatos` : undefined,
                ts,
            };
        case 'item_resolved': {
            const item = data.item || {};
            const price = typeof item.totalPrice === 'number'
                ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(item.totalPrice)
                : undefined;
            const desc = (item.description || item.code || '').toString();
            return {
                id,
                kind: 'resolved',
                title: desc.length > 60 ? desc.substring(0, 60) + '…' : (desc || 'Partida resuelta'),
                detail: price ? `✓ ${price}` : undefined,
                ts,
            };
        }
        case 'extraction_retry_minimal':
            return {
                id,
                kind: 'info',
                title: `Reintento con schema mínimo (pág. ${data.page ?? '?'})`,
                detail: `Intento ${data.attempt ?? '?'}`,
                ts,
            };
        case 'extraction_partial_success':
            return {
                id,
                kind: 'info',
                title: `Página ${data.page ?? '?'} rescatada parcialmente`,
                detail: `${data.items_recovered ?? '?'} items recuperados del JSON truncado`,
                ts,
            };
        case 'cross_page_merge':
            return {
                id,
                kind: 'info',
                title: `Partida fusionada entre páginas ${data.from_page ?? '?'}→${data.to_page ?? '?'}`,
                detail: `${data.tail_chars ?? '?'} chars de continuación añadidos a la descripción`,
                ts,
            };
        case 'item_skipped':
            return {
                id,
                kind: 'error',
                title: `Partida ${data.code ?? '?'} descartada`,
                detail: `${data.error_type ?? 'Error'}: ${(data.reason || '').toString().substring(0, 120)}`,
                ts,
            };
        case 'extraction_failed_chunk':
            return {
                id,
                kind: 'error',
                title: `Página ${data.page ?? '?'} no se pudo extraer`,
                detail: (data.error || '').toString().substring(0, 120),
                ts,
            };
        // Fase 10.1 — eventos de Fase 7-9
        case 'inline_fast_path_used':
            return {
                id,
                kind: 'resolved',
                title: `${data.partidas_count ?? '?'} partidas extraídas sin LLM (heurística)`,
                detail: data.method || 'Layout Analyzer fast path',
                ts,
            };
        case 'tier_assigned':
            return {
                id,
                kind: 'info',
                title: `${data.code ?? '?'} → ${(data.tier ?? '?').toString().toUpperCase()}`,
                detail: data.reason,
                ts,
            };
        case 'tier_escalated':
            return {
                id,
                kind: 'info',
                title: `${data.code ?? '?'}: escalado Flash → Pro`,
                detail: data.reason,
                ts,
            };
        case 'rerank_applied':
            return {
                id,
                kind: 'search',
                title: `Re-rank ${data.input_size ?? '?'} → ${data.output_size ?? '?'}`,
                detail: data.code ? `partida ${data.code}` : undefined,
                ts,
            };
        case 'partida_price_anomaly': {
            const total = typeof data.total_price === 'number'
                ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(data.total_price)
                : `${data.total_price ?? '?'}€`;
            return {
                id,
                kind: 'error',
                title: `⚠ Precio anómalo: ${data.code ?? '?'}`,
                detail: `${data.unit_price ?? '?'} €/${data.unit ?? 'ud'} × ${data.quantity ?? '?'} = ${total}`,
                ts,
            };
        }
        case 'partida_description_short':
            return {
                id,
                kind: 'error',
                title: `Descripción corta: ${data.code ?? '?'}`,
                detail: `${data.chars ?? '?'} chars · cap. ${data.chapter ?? '?'}`,
                ts,
            };
        case 'cross_page_merge_annexed':
            return {
                id,
                kind: 'info',
                title: `Fusión cross-page: ${data.partida_code ?? '?'} (págs ${data.from_page ?? '?'}→${data.to_page ?? '?'})`,
                detail: `+${data.tail_chars ?? '?'} chars de continuación`,
                ts,
            };
        // Fase 11.A — guard del boundary contra breakdown sin escalar
        case 'breakdown_scaled_defensive':
            return {
                id,
                kind: 'info',
                title: `Breakdown reescalado: ${data.code ?? '?'}`,
                detail: `factor ${data.factor ?? '?'} (ratio previo ${data.ratio_before ?? '?'})`,
                ts,
            };
        case 'breakdown_sum_divergence': {
            // Fase 13.B — `direction` distingue dos modos: 'sum_above' (>1.5,
            // breakdown sin escalar hacia arriba) o 'sum_below' (<0.7, Judge
            // multiplicó vía DIMENSIONAMIENTO OCULTO sin escalar el breakdown).
            const dirLabel = data.direction === 'sum_below' ? 'Σ < unit' : 'Σ > unit';
            return {
                id,
                kind: 'error',
                title: `⚠ Divergencia breakdown: ${data.code ?? '?'}`,
                detail: `${dirLabel} | Σ ${data.sum_total ?? '?'} € vs unit ${data.unit_price ?? '?'} € (×${data.ratio ?? '?'})`,
                ts,
            };
        }
        default:
            return null;
    }
}

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
    /**
     * `info` — neutro (texto gris)
     * `search` — actividad de búsqueda (icono ámbar)
     * `resolved` — éxito (icono verde)
     * `error` — error visible (icono rojo)
     * `warning` — aviso no bloqueante (icono ámbar/amarillo); Sprint 4 Fase B —
     *   nuevo kind para banner del parser TABULAR cuando aborta (fallback no es
     *   un error pero el usuario debería verlo).
     */
    kind: 'info' | 'search' | 'resolved' | 'error' | 'warning';
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
        type === 'partida_description_short' ||
        // Sprint 4 Fase B — eventos del parser TABULAR
        type === 'tabular_parser_started' ||
        type === 'tabular_parser_completed' ||
        type === 'tabular_parser_aborted' ||
        // pipeline_error con errorType EXTRACTOR_LAYOUT_UNSUPPORTED — A9 anomaly
        // detection. Lo pintamos en la fase de extracción porque siempre ocurre
        // durante el extractor, antes del Swarm.
        type === 'pipeline_error'
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
        case 'inline_fast_path_used': {
            // Sprint 4 Fase B — si el método es el parser TABULAR usamos un
            // texto más explícito que diferencie del fallback heurístico legacy.
            const isTabular = data.method === 'tabular_parser_coord_based';
            const detailParts: string[] = [];
            if (typeof data.qty_rate === 'number') {
                detailParts.push(`qty ${(data.qty_rate * 100).toFixed(0)}%`);
            }
            if (typeof data.chapter_rate === 'number') {
                detailParts.push(`cap ${(data.chapter_rate * 100).toFixed(0)}%`);
            }
            detailParts.push(data.method || 'Layout Analyzer fast path');
            return {
                id,
                kind: 'resolved',
                title: isTabular
                    ? `${data.partidas_count ?? '?'} partidas extraídas con parser TABULAR`
                    : `${data.partidas_count ?? '?'} partidas extraídas sin LLM (heurística)`,
                detail: detailParts.join(' · '),
                ts,
            };
        }
        // Sprint 4 Fase B — eventos del parser TABULAR coord-based.
        case 'tabular_parser_started':
            return {
                id,
                kind: 'info',
                title: 'Parser TABULAR iniciado',
                detail:
                    typeof data.totalPages === 'number'
                        ? `${data.totalPages} páginas a procesar`
                        : undefined,
                ts,
            };
        case 'tabular_parser_completed': {
            const qty = typeof data.qtyRate === 'number'
                ? `${(data.qtyRate * 100).toFixed(0)}% qty`
                : null;
            const dur = typeof data.durationSeconds === 'number'
                ? `${data.durationSeconds.toFixed(1)}s`
                : null;
            const detailParts = [qty, dur].filter((v): v is string => Boolean(v));
            return {
                id,
                kind: 'resolved',
                title: `Parser TABULAR · ${data.partidasCount ?? '?'} partidas`,
                detail: detailParts.length > 0 ? detailParts.join(' · ') : undefined,
                ts,
            };
        }
        case 'tabular_parser_aborted':
            return {
                id,
                kind: 'warning',
                title: `Parser TABULAR aborted · ${data.reason ?? 'unknown'}`,
                detail: `Fallback a heurística (${data.partidasExtracted ?? 0} parciales)`,
                ts,
            };
        case 'pipeline_error': {
            // Sprint 4 Fase A9 — abort por LayoutUnsupportedError (PDF >50pp
            // que habría caído a LLM Vision page-by-page). Mostramos el
            // mensaje + suggestion del payload tal cual.
            if (
                data.errorType === 'EXTRACTOR_LAYOUT_UNSUPPORTED' ||
                data.error_type === 'EXTRACTOR_LAYOUT_UNSUPPORTED'
            ) {
                const pages = data.pagesAttempted ?? data.pages_attempted;
                const max = data.maxPagesAllowed ?? data.max_pages_allowed;
                return {
                    id,
                    kind: 'error',
                    title: `Layout no soportado · ${data.extractor ?? 'extractor'}`,
                    detail:
                        (data.message as string) ||
                        `PDF ${pages ?? '?'} págs > ${max ?? '?'} permitidas`,
                    ts,
                };
            }
            return {
                id,
                kind: 'error',
                title: 'Error de pipeline',
                detail: (data.message as string) || (data.errorType as string) || 'unknown',
                ts,
            };
        }
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

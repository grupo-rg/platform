'use client';

/**
 * Componente headless que anteriormente emitía toasts de `sileo` por cada
 * evento del pipeline. Ahora el panel `BudgetGenerationProgress` lee el
 * mismo canal SSE (`/api/budget/stream`) y lo renderiza como una línea de
 * tiempo persistente por fases, así que este listener queda como no-op.
 *
 * Se conserva el export porque hay consumidores que lo montan y porque
 * puede servir en el futuro para surfacing de eventos críticos globales
 * (p.ej. errores fatales) fuera del chat.
 */
export function BudgetStreamListener() {
    return null;
}

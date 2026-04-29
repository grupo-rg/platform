/**
 * Fase 10.2 — helper puro para derivar estadísticas del presupuesto a partir
 * de los `SubEvent` que va acumulando `BudgetGenerationProgress`.
 *
 * Se usa por `BudgetSummaryBar` para mostrar contadores en vivo y al cerrar
 * el job. Independiente de React: testeable trivialmente.
 */
import type { SubEvent } from '@/components/budget/budget-generation-events';

export interface BudgetStats {
    /** Cuántas partidas se han resuelto (count de `kind === 'resolved'`). */
    partidasCount: number;
    /** Capítulos distintos detectados (prefix `Cxx` o `xx` extraído de los títulos). */
    chaptersCount: number;
    /** Suma del PEM (price total) parseado de los `detail` "✓ €1.200,50". */
    pemTotal: number;
    /** Anomalías detectadas durante el job (kind === 'error'). */
    anomaliesCount: number;
    /** Formato es-ES del PEM listo para mostrar. */
    formattedPem: string;
}

const _CURRENCY_FORMATTER = new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
});

const _CHAPTER_PREFIX_RE = /^(C?\d+)\./i;
// Captura "1.234,56", "350", "50.000,00", "1234.56" — formato es-ES y fallback US.
const _PRICE_RE = /([\d.]+(?:,\d+)?|\d+(?:\.\d+)?)\s*€/;

function _parsePrice(detail: string | undefined): number {
    if (!detail) return 0;
    const match = detail.match(_PRICE_RE);
    if (!match) return 0;
    // El sistema usa Intl.NumberFormat('es-ES') consistentemente:
    // - "1.500 €"     → punto es thousands → 1500
    // - "12.345 €"    → 12345
    // - "1.234,56 €"  → punto thousands, coma decimal → 1234.56
    // Estrategia robusta: SIEMPRE quitamos puntos y promovemos comas a punto
    // antes de parseFloat. Funciona para todos los formatos es-ES (con/sin
    // decimales, con/sin separador de miles).
    const normalized = match[1].replace(/\./g, '').replace(',', '.');
    const value = parseFloat(normalized);
    return Number.isFinite(value) ? value : 0;
}

export function computeBudgetStats(subEvents: SubEvent[]): BudgetStats {
    let partidasCount = 0;
    let pemTotal = 0;
    let anomaliesCount = 0;
    const chapters = new Set<string>();

    for (const ev of subEvents) {
        if (ev.kind === 'resolved') {
            partidasCount++;
            pemTotal += _parsePrice(ev.detail);
            const m = (ev.title || '').trim().match(_CHAPTER_PREFIX_RE);
            if (m) {
                chapters.add(m[1].toUpperCase());
            }
        } else if (ev.kind === 'error') {
            anomaliesCount++;
        }
    }

    return {
        partidasCount,
        chaptersCount: chapters.size,
        pemTotal,
        anomaliesCount,
        formattedPem: _CURRENCY_FORMATTER.format(pemTotal),
    };
}

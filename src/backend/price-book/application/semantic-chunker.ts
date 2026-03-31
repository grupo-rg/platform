import { PriceBookItem, PriceBookComponent } from '../domain/price-book-item';

/**
 * Parses the pure semantic string for 768d vector embeddings.
 * According to architectural design:
 * "Capítulo: [chapter]. Tarea: [code] [description]. Contiene: [breakdown summaries]. Es variable: [true/false]."
 */
export function generateSemanticChunk(item: PriceBookItem): string {
    const isVariableOverall = item.breakdown?.some(b => b?.is_variable === true) ?? false;

    let breakdownText = '';
    if (item.breakdown && item.breakdown.length > 0) {
        const parts = item.breakdown
            .filter(b => b && b.description)
            .map(b => `${b.description?.trim()} (${b.is_variable ? 'variable' : 'fijo'})`);
        if (parts.length > 0) {
            breakdownText = ` Contiene: ${parts.join(', ')}.`;
        }
    }

    const chapText = item.chapter ? `Capítulo: ${item.chapter}. ` : '';
    const taskText = `Tarea: ${item.code} ${item.description}.`;
    let varText = ` Es variable: ${isVariableOverall}.`;

    return `${chapText}${taskText}${breakdownText}${varText}`.trim().replace(/\s+/g, ' ');
}

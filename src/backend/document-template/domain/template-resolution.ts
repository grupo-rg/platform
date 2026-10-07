import {
    templateMatchesKind,
    type DocumentKind,
    type DocumentTemplate,
    type ResolvedDocumentTemplate,
    type TemplateBlock,
} from './document-template';
import {
    BUILTIN_BUDGET_TEMPLATE_NAME,
    DEFAULT_BUDGET_BLOCKS,
    DEFAULT_BUDGET_DISCLAIMER,
} from './default-budget-template';
import {
    BUILTIN_PRICE_LIST_TEMPLATE_NAME,
    DEFAULT_PRICE_LIST_BLOCKS,
    DEFAULT_PRICE_LIST_DISCLAIMER,
} from './default-price-list-template';

/** Plantilla incorporada en código (fallback final) para cada tipo de documento. */
export function builtinTemplateFor(kind: DocumentKind): ResolvedDocumentTemplate {
    const cloneBlocks = (blocks: TemplateBlock[]) => blocks.map((b) => ({ ...b }));
    if (kind === 'price_list') {
        return {
            source: 'builtin',
            name: BUILTIN_PRICE_LIST_TEMPLATE_NAME,
            blocks: cloneBlocks(DEFAULT_PRICE_LIST_BLOCKS),
            disclaimer: DEFAULT_PRICE_LIST_DISCLAIMER,
        };
    }
    return {
        source: 'builtin',
        name: BUILTIN_BUDGET_TEMPLATE_NAME,
        blocks: cloneBlocks(DEFAULT_BUDGET_BLOCKS),
        disclaimer: DEFAULT_BUDGET_DISCLAIMER,
    };
}

function toResolved(t: DocumentTemplate, source: 'assigned' | 'default'): ResolvedDocumentTemplate {
    return { source, templateId: t.id, name: t.name, blocks: t.blocks, disclaimer: t.disclaimer };
}

/**
 * Resuelve qué condiciones lleva un documento:
 *   1. La plantilla ASIGNADA (`assignedId`), si existe y es compatible con el tipo.
 *   2. La PREDETERMINADA del tipo exacto (`budget` / `price_list`).
 *   3. La PREDETERMINADA de tipo `any`.
 *   4. La constante en código (`builtinTemplateFor`).
 * Si hay varias predeterminadas del mismo tipo (no debería), gana la más reciente.
 */
export function resolveDocumentTemplate(
    templates: readonly DocumentTemplate[],
    kind: DocumentKind,
    assignedId?: string | null,
): ResolvedDocumentTemplate {
    if (assignedId) {
        const assigned = templates.find((t) => t.id === assignedId);
        if (assigned && templateMatchesKind(assigned, kind)) return toResolved(assigned, 'assigned');
    }
    const byRecency = [...templates].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const exact = byRecency.find((t) => t.isDefault && t.kind === kind);
    if (exact) return toResolved(exact, 'default');
    const any = byRecency.find((t) => t.isDefault && t.kind === 'any');
    if (any) return toResolved(any, 'default');
    return builtinTemplateFor(kind);
}

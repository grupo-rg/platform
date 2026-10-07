import {
    DocumentTemplateInputSchema,
    type DocumentKind,
    type DocumentTemplate,
    type DocumentTemplateInput,
    type DocumentTemplateKind,
    type ResolvedDocumentTemplate,
} from '../domain/document-template';
import { builtinTemplateFor, resolveDocumentTemplate } from '../domain/template-resolution';

export interface DocumentTemplateRepository {
    newId(): string;
    listAll(): Promise<DocumentTemplate[]>;
    get(id: string): Promise<DocumentTemplate | null>;
    save(template: DocumentTemplate): Promise<void>;
    setDefaultFlags(updates: Array<{ id: string; isDefault: boolean }>): Promise<void>;
    delete(id: string): Promise<void>;
}

export class DocumentTemplateError extends Error {}

/**
 * Casos de uso de las plantillas de condiciones del PDF.
 * Invariante: como mucho UNA predeterminada por `kind` (budget / price_list / any).
 */
export class DocumentTemplateService {
    constructor(private readonly repo: DocumentTemplateRepository) {}

    async list(): Promise<DocumentTemplate[]> {
        const all = await this.repo.listAll();
        return all.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    }

    get(id: string): Promise<DocumentTemplate | null> {
        return this.repo.get(id);
    }

    async resolve(kind: DocumentKind, assignedId?: string | null): Promise<ResolvedDocumentTemplate> {
        return resolveDocumentTemplate(await this.repo.listAll(), kind, assignedId);
    }

    async create(input: DocumentTemplateInput, who: string): Promise<DocumentTemplate> {
        const data = DocumentTemplateInputSchema.parse(input);
        const now = new Date().toISOString();
        const template: DocumentTemplate = {
            id: this.repo.newId(),
            name: data.name,
            kind: data.kind,
            isDefault: false,
            blocks: data.blocks,
            disclaimer: data.disclaimer,
            createdAt: now,
            updatedAt: now,
            createdBy: who,
            updatedBy: who,
        };
        await this.repo.save(template);
        if (data.isDefault) await this.setDefault(template.id);
        return { ...template, isDefault: !!data.isDefault };
    }

    async update(id: string, input: DocumentTemplateInput, who: string): Promise<DocumentTemplate> {
        const current = await this.repo.get(id);
        if (!current) throw new DocumentTemplateError('La plantilla no existe');
        const data = DocumentTemplateInputSchema.parse(input);
        const kindChanged = data.kind !== current.kind;
        const next: DocumentTemplate = {
            ...current,
            name: data.name,
            kind: data.kind,
            blocks: data.blocks,
            disclaimer: data.disclaimer,
            // Si cambia de tipo deja de ser la predeterminada del tipo anterior.
            isDefault: kindChanged ? false : current.isDefault,
            updatedAt: new Date().toISOString(),
            updatedBy: who,
        };
        await this.repo.save(next);
        if (data.isDefault && !next.isDefault) {
            await this.setDefault(id);
            next.isDefault = true;
        }
        return next;
    }

    async duplicate(id: string, who: string): Promise<DocumentTemplate> {
        const src = await this.repo.get(id);
        if (!src) throw new DocumentTemplateError('La plantilla no existe');
        return this.create(
            {
                name: `Copia de ${src.name}`.slice(0, 120),
                kind: src.kind,
                blocks: src.blocks.map((b) => ({ ...b })),
                disclaimer: src.disclaimer,
                isDefault: false,
            },
            who,
        );
    }

    /** Marca `id` como predeterminada de su tipo y desmarca las demás del mismo tipo. */
    async setDefault(id: string): Promise<void> {
        const all = await this.repo.listAll();
        const target = all.find((t) => t.id === id);
        if (!target) throw new DocumentTemplateError('La plantilla no existe');
        await this.repo.setDefaultFlags(computeDefaultFlagUpdates(all, id, target.kind));
    }

    async delete(id: string): Promise<void> {
        const t = await this.repo.get(id);
        if (!t) return;
        if (t.isDefault) {
            throw new DocumentTemplateError(
                'Es la plantilla predeterminada: marca otra como predeterminada antes de eliminarla.',
            );
        }
        await this.repo.delete(id);
    }

    /**
     * "Crear desde la plantilla actual": siembra en Firestore la plantilla estándar
     * en código. Queda como predeterminada si su tipo aún no tiene ninguna.
     */
    async seedFromBuiltin(kind: DocumentKind, who: string): Promise<DocumentTemplate> {
        const builtin = builtinTemplateFor(kind);
        const all = await this.repo.listAll();
        const hasDefault = all.some((t) => t.isDefault && t.kind === kind);
        return this.create(
            {
                name: builtin.name,
                kind,
                blocks: builtin.blocks,
                disclaimer: builtin.disclaimer,
                isDefault: !hasDefault,
            },
            who,
        );
    }
}

/** Puro: qué flags `isDefault` hay que cambiar para que `targetId` sea la única predeterminada de `kind`. */
export function computeDefaultFlagUpdates(
    templates: readonly DocumentTemplate[],
    targetId: string,
    kind: DocumentTemplateKind,
): Array<{ id: string; isDefault: boolean }> {
    const updates: Array<{ id: string; isDefault: boolean }> = [];
    for (const t of templates) {
        if (t.id === targetId) {
            if (!t.isDefault) updates.push({ id: t.id, isDefault: true });
        } else if (t.kind === kind && t.isDefault) {
            updates.push({ id: t.id, isDefault: false });
        }
    }
    return updates;
}

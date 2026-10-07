'use server';

import { revalidatePath } from 'next/cache';
import { documentTemplateService } from '@/backend/document-template/application';
import {
    DocumentTemplateInputSchema,
    type DocumentKind,
    type DocumentTemplate,
    type DocumentTemplateInput,
    type ResolvedDocumentTemplate,
} from '@/backend/document-template/domain/document-template';
import { builtinTemplateFor, resolveDocumentTemplate } from '@/backend/document-template/domain/template-resolution';
import { requireAdminOrFail, errorMessage, zodMessage, type ActionResult } from './_shared';

const TEMPLATES_PATH = '/[locale]/dashboard/settings/document-templates';

function revalidate() {
    revalidatePath(TEMPLATES_PATH, 'page');
}

export async function listDocumentTemplatesAction(): Promise<ActionResult<DocumentTemplate[]>> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };
    try {
        return { success: true, data: await documentTemplateService.list() };
    } catch (e) {
        console.error('[listDocumentTemplatesAction]', e);
        return { success: false, error: errorMessage(e, 'No se pudieron cargar las plantillas') };
    }
}

export async function getDocumentTemplateAction(id: string): Promise<ActionResult<DocumentTemplate | null>> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };
    try {
        return { success: true, data: await documentTemplateService.get(id) };
    } catch (e) {
        console.error('[getDocumentTemplateAction]', e);
        return { success: false, error: errorMessage(e, 'No se pudo cargar la plantilla') };
    }
}

export async function createDocumentTemplateAction(input: DocumentTemplateInput): Promise<ActionResult<DocumentTemplate>> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };
    const parsed = DocumentTemplateInputSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: zodMessage(parsed.error) };
    try {
        const data = await documentTemplateService.create(parsed.data, guard.who);
        revalidate();
        return { success: true, data };
    } catch (e) {
        console.error('[createDocumentTemplateAction]', e);
        return { success: false, error: errorMessage(e, 'No se pudo crear la plantilla') };
    }
}

export async function updateDocumentTemplateAction(
    id: string,
    input: DocumentTemplateInput,
): Promise<ActionResult<DocumentTemplate>> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };
    const parsed = DocumentTemplateInputSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: zodMessage(parsed.error) };
    try {
        const data = await documentTemplateService.update(id, parsed.data, guard.who);
        revalidate();
        return { success: true, data };
    } catch (e) {
        console.error('[updateDocumentTemplateAction]', e);
        return { success: false, error: errorMessage(e, 'No se pudo guardar la plantilla') };
    }
}

export async function duplicateDocumentTemplateAction(id: string): Promise<ActionResult<DocumentTemplate>> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };
    try {
        const data = await documentTemplateService.duplicate(id, guard.who);
        revalidate();
        return { success: true, data };
    } catch (e) {
        console.error('[duplicateDocumentTemplateAction]', e);
        return { success: false, error: errorMessage(e, 'No se pudo duplicar la plantilla') };
    }
}

export async function setDefaultDocumentTemplateAction(id: string): Promise<ActionResult<null>> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };
    try {
        await documentTemplateService.setDefault(id);
        revalidate();
        return { success: true, data: null };
    } catch (e) {
        console.error('[setDefaultDocumentTemplateAction]', e);
        return { success: false, error: errorMessage(e, 'No se pudo marcar como predeterminada') };
    }
}

export async function deleteDocumentTemplateAction(id: string): Promise<ActionResult<null>> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };
    try {
        await documentTemplateService.delete(id);
        revalidate();
        return { success: true, data: null };
    } catch (e) {
        console.error('[deleteDocumentTemplateAction]', e);
        return { success: false, error: errorMessage(e, 'No se pudo eliminar la plantilla') };
    }
}

/** "Crear desde la plantilla actual": siembra la estándar (constante en código). */
export async function seedBuiltinDocumentTemplateAction(kind: DocumentKind): Promise<ActionResult<DocumentTemplate>> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };
    if (kind !== 'budget' && kind !== 'price_list') return { success: false, error: 'Tipo inválido' };
    try {
        const data = await documentTemplateService.seedFromBuiltin(kind, guard.who);
        revalidate();
        return { success: true, data };
    } catch (e) {
        console.error('[seedBuiltinDocumentTemplateAction]', e);
        return { success: false, error: errorMessage(e, 'No se pudo crear la plantilla') };
    }
}

/**
 * Plantillas aplicables + resolución para un documento. Pensada para el editor
 * de presupuestos: si el usuario no es admin (editor de demo / traza) o falla
 * Firestore, devuelve la constante en código → el PDF sale como siempre.
 */
export async function getDocumentTemplatesForAction(
    kind: DocumentKind,
    assignedId?: string | null,
): Promise<{ templates: DocumentTemplate[]; resolved: ResolvedDocumentTemplate }> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { templates: [], resolved: builtinTemplateFor(kind) };
    try {
        const all = await documentTemplateService.list();
        const templates = all.filter((t) => t.kind === kind || t.kind === 'any');
        const resolved = resolveDocumentTemplate(all, kind, assignedId);
        return { templates, resolved };
    } catch (e) {
        console.error('[getDocumentTemplatesForAction]', e);
        return { templates: [], resolved: builtinTemplateFor(kind) };
    }
}

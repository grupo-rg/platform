'use server';

import { revalidatePath } from 'next/cache';
import { priceListService } from '@/backend/price-list/application';
import { documentTemplateService } from '@/backend/document-template/application';
import { PriceListInputSchema, type PriceList, type PriceListInput } from '@/backend/price-list/domain/price-list';
import type { ResolvedDocumentTemplate } from '@/backend/document-template/domain/document-template';
import { builtinTemplateFor } from '@/backend/document-template/domain/template-resolution';
import {
    requireAdminOrFail,
    errorMessage,
    zodMessage,
    type ActionResult,
} from '@/actions/document-template/_shared';

const LIST_PATH = '/[locale]/dashboard/price-lists';
const DETAIL_PATH = '/[locale]/dashboard/price-lists/[id]';

function revalidate() {
    revalidatePath(LIST_PATH, 'page');
    revalidatePath(DETAIL_PATH, 'page');
}

export async function listPriceListsAction(): Promise<ActionResult<PriceList[]>> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };
    try {
        return { success: true, data: await priceListService.list() };
    } catch (e) {
        console.error('[listPriceListsAction]', e);
        return { success: false, error: errorMessage(e, 'No se pudieron cargar las listas') };
    }
}

export async function getPriceListAction(id: string): Promise<ActionResult<PriceList | null>> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };
    try {
        return { success: true, data: await priceListService.get(id) };
    } catch (e) {
        console.error('[getPriceListAction]', e);
        return { success: false, error: errorMessage(e, 'No se pudo cargar la lista') };
    }
}

export async function createPriceListAction(input: PriceListInput): Promise<ActionResult<PriceList>> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };
    const parsed = PriceListInputSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: zodMessage(parsed.error) };
    try {
        const data = await priceListService.create(parsed.data, guard.who);
        revalidate();
        return { success: true, data };
    } catch (e) {
        console.error('[createPriceListAction]', e);
        return { success: false, error: errorMessage(e, 'No se pudo crear la lista') };
    }
}

export async function updatePriceListAction(id: string, input: PriceListInput): Promise<ActionResult<PriceList>> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };
    const parsed = PriceListInputSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: zodMessage(parsed.error) };
    try {
        const data = await priceListService.update(id, parsed.data);
        revalidate();
        return { success: true, data };
    } catch (e) {
        console.error('[updatePriceListAction]', e);
        return { success: false, error: errorMessage(e, 'No se pudo guardar la lista') };
    }
}

export async function duplicatePriceListAction(id: string): Promise<ActionResult<PriceList>> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };
    try {
        const data = await priceListService.duplicate(id, guard.who);
        revalidate();
        return { success: true, data };
    } catch (e) {
        console.error('[duplicatePriceListAction]', e);
        return { success: false, error: errorMessage(e, 'No se pudo duplicar la lista') };
    }
}

export async function deletePriceListAction(id: string): Promise<ActionResult<null>> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };
    try {
        await priceListService.delete(id);
        revalidate();
        return { success: true, data: null };
    } catch (e) {
        console.error('[deletePriceListAction]', e);
        return { success: false, error: errorMessage(e, 'No se pudo eliminar la lista') };
    }
}

/**
 * Bloques de partida para una lista: plantilla elegida (o la predeterminada de
 * listas de precios / `any`, o la constante en código). Solo rellena; la lista
 * guarda después su propia copia editable.
 */
export async function getPriceListStarterBlocksAction(
    templateId?: string | null,
): Promise<ActionResult<ResolvedDocumentTemplate>> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };
    try {
        return { success: true, data: await documentTemplateService.resolve('price_list', templateId) };
    } catch (e) {
        console.error('[getPriceListStarterBlocksAction]', e);
        return { success: true, data: builtinTemplateFor('price_list') };
    }
}

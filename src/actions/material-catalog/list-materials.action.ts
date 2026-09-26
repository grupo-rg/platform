'use server';

/**
 * Listado paginado + filtrable del catálogo de materiales (`material_catalog`)
 * para la UI de administración de precios (Wave 3, solo lectura).
 *
 * FICHERO NUEVO — no toca los `*-rule.action.ts` existentes ni las views. Se
 * apoya en el admin SDK (igual que `preview-material-price-rule.action.ts`) y en
 * `verifyAuth(true)` para el gate admin.
 *
 * Diseño de consultas (evita índices compuestos que no existen todavía en
 * `firestore.indexes.json` — solo se usan índices de campo único, que Firestore
 * crea por defecto):
 *   - Sin categoría → `orderBy('createdAt','desc')` + offset/limit.
 *   - Con categoría → filtro por PREFIJO sobre `category` con un rango
 *     `[parent, parent + ]` ordenado por `category` (índice de campo
 *     único). Como las categorías son texto libre "Padre > Hijo", un prefijo del
 *     nivel padre captura también todas sus subcategorías.
 *
 * La paginación es por OFFSET (mismo patrón que `FirestoreLeadRepository.findAll`):
 * el cliente pasa `page`/`pageSize` (valores planos y serializables), sin
 * cursores/snapshots que no cruzan el boundary de Server Actions.
 */

import { adminFirestore } from '@/backend/shared/infrastructure/firebase/admin-app';
import { verifyAuth } from '@/backend/auth/auth.middleware';
import type { MaterialItem } from '@/backend/material-catalog/domain/material-item';

const COLLECTION = 'material_catalog';
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
/** Tope de documentos que se escanean para descubrir categorías (muestra). */
const CATEGORY_SCAN_CAP = 2500;

export interface ListMaterialsInput {
    page?: number;
    pageSize?: number;
    /** Categoría (nivel padre o ruta completa "Padre > Hijo") para filtrar por prefijo. */
    category?: string | null;
}

/** Fila ligera y 100% serializable (sin embedding ni metadata pesada). */
export interface CatalogMaterialRow {
    id: string;
    sku: string;
    name: string;
    description: string;
    category: string;
    price: number;
    unit: string;
    year?: number;
}

export interface ListMaterialsResult {
    success: boolean;
    items: CatalogMaterialRow[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
    error?: string;
}

export interface MaterialCategoryFacet {
    /** Nivel padre ("Padre" de "Padre > Hijo"). */
    parent: string;
    /** Nº de materiales con ese padre dentro de la muestra escaneada. */
    count: number;
}

export interface ListMaterialCategoriesResult {
    success: boolean;
    categories: MaterialCategoryFacet[];
    /** Nº de documentos leídos para calcular las facetas. */
    scanned: number;
    /** true si se alcanzó el tope de escaneo (la lista puede estar incompleta). */
    truncated: boolean;
    error?: string;
}

function clampPageSize(n: number | undefined): number {
    if (!Number.isFinite(n as number)) return DEFAULT_PAGE_SIZE;
    return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(n as number)));
}

function toRow(data: FirebaseFirestore.DocumentData, id: string): CatalogMaterialRow {
    return {
        id: (data.id as string) || id,
        sku: (data.sku as string) || '',
        name: (data.name as string) || '',
        description: (data.description as string) || '',
        category: (data.category as string) || '',
        price: typeof data.price === 'number' ? data.price : Number(data.price) || 0,
        unit: (data.unit as string) || '',
        year: typeof data.year === 'number' ? data.year : undefined,
    };
}

/** Nivel padre de una categoría jerárquica libre "Padre > Hijo". */
function parentOf(category: string): string {
    const head = category.split('>')[0]?.trim();
    return head || category.trim();
}

/**
 * Página del catálogo (opcionalmente filtrada por categoría). Admin-gated.
 * Devuelve el total (vía `count()`) para poder pintar "página X de Y".
 */
export async function listMaterialsAction(
    input: ListMaterialsInput = {},
): Promise<ListMaterialsResult> {
    const pageSize = clampPageSize(input.pageSize);
    const page = Math.max(0, Math.trunc(input.page ?? 0));

    const auth = await verifyAuth(true);
    if (!auth) {
        return { success: false, items: [], total: 0, page, pageSize, hasMore: false, error: 'forbidden' };
    }

    const category = input.category?.trim() || null;

    try {
        const col = adminFirestore.collection(COLLECTION);

        let pageQuery: FirebaseFirestore.Query;
        let countQuery: FirebaseFirestore.Query;

        if (category) {
            const end = `${category}`;
            pageQuery = col.orderBy('category').startAt(category).endAt(end);
            countQuery = col.where('category', '>=', category).where('category', '<=', end);
        } else {
            pageQuery = col.orderBy('createdAt', 'desc');
            countQuery = col;
        }

        const [countSnap, pageSnap] = await Promise.all([
            countQuery.count().get(),
            pageQuery.offset(page * pageSize).limit(pageSize).get(),
        ]);

        const total = countSnap.data().count;
        const items = pageSnap.docs.map((d) => toRow(d.data(), d.id));
        const hasMore = (page + 1) * pageSize < total;

        return { success: true, items, total, page, pageSize, hasMore };
    } catch (e: any) {
        console.error('[listMaterialsAction]', e);
        return { success: false, items: [], total: 0, page, pageSize, hasMore: false, error: e?.message || 'list_failed' };
    }
}

/**
 * Facetas de categoría (nivel padre) para el selector de filtro. Admin-gated.
 *
 * Firestore no soporta DISTINCT server-side y el catálogo tiene ~decenas de
 * miles de documentos, así que se escanea una MUESTRA acotada
 * (`CATEGORY_SCAN_CAP`) leyendo solo el campo `category` (`.select()` reduce el
 * ancho de banda) y se agregan los padres en memoria. Si `truncated` es true la
 * lista puede no incluir categorías poco frecuentes: la UI debe avisarlo.
 */
export async function listMaterialCategoriesAction(): Promise<ListMaterialCategoriesResult> {
    const auth = await verifyAuth(true);
    if (!auth) {
        return { success: false, categories: [], scanned: 0, truncated: false, error: 'forbidden' };
    }

    try {
        const snap = await adminFirestore
            .collection(COLLECTION)
            .select('category')
            .limit(CATEGORY_SCAN_CAP)
            .get();

        const counts = new Map<string, number>();
        for (const doc of snap.docs) {
            const category = (doc.data().category as string) || '';
            if (!category) continue;
            const parent = parentOf(category);
            if (!parent) continue;
            counts.set(parent, (counts.get(parent) || 0) + 1);
        }

        const categories: MaterialCategoryFacet[] = Array.from(counts.entries())
            .map(([parent, count]) => ({ parent, count }))
            .sort((a, b) => a.parent.localeCompare(b.parent, 'es'));

        return {
            success: true,
            categories,
            scanned: snap.size,
            truncated: snap.size >= CATEGORY_SCAN_CAP,
        };
    } catch (e: any) {
        console.error('[listMaterialCategoriesAction]', e);
        return { success: false, categories: [], scanned: 0, truncated: false, error: e?.message || 'categories_failed' };
    }
}

'use server';

import { adminFirestore } from '@/backend/shared/infrastructure/firebase/admin-app';
import { resolveMaterialFactor } from '@/lib/pricing/material-price-resolver';
import type { MaterialItem } from '@/backend/material-catalog/domain/material-item';
import type { MaterialPriceRule } from '@/backend/material-catalog/domain/material-price-rule';
import { FirestoreMaterialCatalogRepository } from '@/backend/material-catalog/infrastructure/firestore-material-catalog-repository';
import {
    MaterialPriceRuleInputSchema,
    requireAdminOrFail,
    scopeTargetError,
    zodMessage,
    type MaterialPriceRuleInput,
} from './_shared';

/** Cuántos materiales leemos como MUESTRA para los scopes que barren catálogo. */
const SAMPLE_SCAN_LIMIT = 200;
/** Cuántas filas afectadas devolvemos como ejemplos. */
const SAMPLE_RETURN_LIMIT = 25;

type PreviewSampleRow = {
    sku: string;
    name: string;
    category: string;
    basePrice: number;
    effectivePrice: number;
};

type PreviewResult =
    | {
          success: true;
          /** Nº estimado de materiales afectados. `estimated=true` → viene de una MUESTRA. */
          affectedCountEstimate: number;
          estimated: boolean;
          /** Cuántos materiales se leyeron para calcular la muestra. */
          sampleSize: number;
          sample: PreviewSampleRow[];
          note: string;
      }
    | { success: false; error: string };

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/**
 * DRY-RUN de una regla de ajuste de precio de materiales. Admin-gated.
 *
 * NO escribe nada. Lee una MUESTRA ACOTADA de `material_catalog` (nunca las ~29k
 * partidas completas), aplica `resolveMaterialFactor` con la regla PROPUESTA
 * como único candidato y devuelve un estimado de materiales afectados más una
 * muestra de precios efectivos.
 *
 * Sobre el conteo (`affectedCountEstimate` / `estimated`):
 *  - scope `material`  → exacto (0 ó 1: el material del SKU).
 *  - scope `global`/`client`/`budget` → exacto vía `count()` (afecta a TODO el
 *    catálogo; en client/budget se inyecta el leadId/budgetId en el input para
 *    que la regla case).
 *  - scope `category`  → ESTIMADO: `count()` sobre coincidencia EXACTA de
 *    categoría. El resolver además casa subcategorías (descendientes), que este
 *    conteo no incluye, así que el real puede ser mayor.
 *
 * Nota: se lee Firestore directamente (no vía repo) porque no existe un método
 * de "muestra acotada / filtro por categoría" en el repo de catálogo y su
 * modificación queda fuera de esta wave; para scope `material` sí se reutiliza
 * `FirestoreMaterialCatalogRepository.findBySku`.
 */
export async function previewMaterialPriceRuleAction(
    ruleSpec: MaterialPriceRuleInput,
): Promise<PreviewResult> {
    const guard = await requireAdminOrFail();
    if (!guard.ok) return { success: false, error: guard.error };

    const parsed = MaterialPriceRuleInputSchema.safeParse(ruleSpec);
    if (!parsed.success) return { success: false, error: zodMessage(parsed.error) };

    const scopeErr = scopeTargetError(parsed.data.scope, parsed.data.target);
    if (scopeErr) return { success: false, error: scopeErr };

    // Regla candidata: `active` forzado a true para que el resolver la considere
    // en el dry-run aunque finalmente se cree inactiva. Los campos que sella el
    // servidor llevan placeholders (el resolver no los mira).
    const candidate: MaterialPriceRule = {
        id: '__preview__',
        scope: parsed.data.scope,
        target: parsed.data.target,
        adjustmentPct: parsed.data.adjustmentPct,
        active: true,
        note: parsed.data.note,
        createdBy: guard.who,
        createdAt: new Date(0).toISOString(),
        updatedBy: guard.who,
        updatedAt: new Date(0).toISOString(),
    };

    // Contexto que hay que inyectar para que casen las reglas por contexto
    // (client/budget): el material por sí solo no las dispara.
    const ctx = {
        leadId: parsed.data.scope === 'client' ? parsed.data.target.leadId : undefined,
        budgetId: parsed.data.scope === 'budget' ? parsed.data.target.budgetId : undefined,
    };

    try {
        const col = adminFirestore.collection('material_catalog');

        // --- 1. Cargar la MUESTRA de materiales y el conteo estimado ---
        let materials: MaterialItem[] = [];
        let affectedCountEstimate = 0;
        let estimated = true;
        let note = '';

        if (parsed.data.scope === 'material' && parsed.data.target.sku) {
            const repo = new FirestoreMaterialCatalogRepository();
            const found = await repo.findBySku(parsed.data.target.sku);
            materials = found ? [found] : [];
            affectedCountEstimate = materials.length; // 0 ó 1
            estimated = false;
            note =
                materials.length === 0
                    ? `No existe ningún material con SKU '${parsed.data.target.sku}'.`
                    : 'Conteo exacto: la regla afecta a un único material (por SKU).';
        } else if (parsed.data.scope === 'category' && parsed.data.target.category) {
            const filtered = col.where('category', '==', parsed.data.target.category);
            const [scanSnap, countSnap] = await Promise.all([
                filtered.limit(SAMPLE_SCAN_LIMIT).get(),
                filtered.count().get(),
            ]);
            materials = scanSnap.docs.map((d) => d.data() as MaterialItem);
            affectedCountEstimate = countSnap.data().count;
            estimated = true;
            note =
                'Estimado: conteo por coincidencia EXACTA de categoría. El resolver ' +
                'también aplica a subcategorías (descendientes), así que el nº real puede ser mayor.';
        } else {
            // global / client / budget → afecta a TODO el catálogo.
            const [scanSnap, countSnap] = await Promise.all([
                col.limit(SAMPLE_SCAN_LIMIT).get(),
                col.count().get(),
            ]);
            materials = scanSnap.docs.map((d) => d.data() as MaterialItem);
            affectedCountEstimate = countSnap.data().count;
            estimated = false;
            note =
                parsed.data.scope === 'global'
                    ? 'La regla global afecta a todos los materiales del catálogo.'
                    : `La regla de ${parsed.data.scope} afecta a todos los materiales en ese contexto.`;
        }

        // --- 2. Aplicar el resolver material a material sobre la muestra ---
        const sample: PreviewSampleRow[] = [];
        for (const m of materials) {
            const basePrice = typeof m.price === 'number' ? m.price : 0;
            const { factor, appliedRule } = resolveMaterialFactor(
                { sku: m.sku, category: m.category, ...ctx },
                [candidate],
            );
            if (!appliedRule) continue; // esta regla no toca este material
            if (sample.length < SAMPLE_RETURN_LIMIT) {
                sample.push({
                    sku: m.sku,
                    name: m.name,
                    category: m.category,
                    basePrice,
                    effectivePrice: round2(basePrice * factor),
                });
            }
        }

        return {
            success: true,
            affectedCountEstimate,
            estimated,
            sampleSize: materials.length,
            sample,
            note,
        };
    } catch (e: any) {
        console.error('[previewMaterialPriceRuleAction]', e);
        return { success: false, error: e?.message || 'preview_failed' };
    }
}

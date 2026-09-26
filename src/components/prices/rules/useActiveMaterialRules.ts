'use client';

/**
 * Hook cliente que carga UNA sola vez las reglas ACTIVAS de ajuste de precio de
 * materiales y expone un cálculo de precio efectivo reutilizable por las vistas
 * del catálogo (buscador, listado paginado, últimos ingestados).
 *
 * Para la vista de catálogo solo tienen sentido los scopes "catalog-wide"
 * (global / category / material): las reglas de `client` y `budget` dependen de
 * un contexto (leadId / budgetId) que aquí no existe, así que se excluyen. El
 * resolver es puro (`@/lib/pricing/material-price-resolver`) y seguro en
 * cliente.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MaterialPriceRule } from '@/backend/material-catalog/domain/material-price-rule';
import { resolveMaterialFactor } from '@/lib/pricing/material-price-resolver';
import { listMaterialPriceRulesAction } from '@/actions/material-catalog/list-material-price-rules.action';

const CATALOG_WIDE_SCOPES: ReadonlyArray<MaterialPriceRule['scope']> = ['global', 'category', 'material'];

export interface EffectivePrice {
    basePrice: number;
    effectivePrice: number;
    factor: number;
    appliedRule: MaterialPriceRule | null;
    /** `adjustmentPct` con signo de la regla aplicada (o null). */
    adjustmentPct: number | null;
}

export interface UseActiveMaterialRules {
    /** Todas las reglas activas (cualquier scope). */
    activeRules: MaterialPriceRule[];
    /** Solo las que afectan al catálogo (global/category/material). */
    catalogRules: MaterialPriceRule[];
    loading: boolean;
    error: string | null;
    reload: () => Promise<void>;
    /** Precio efectivo de un material según las reglas catalog-wide activas. */
    computeEffective: (sku: string | null | undefined, category: string | null | undefined, basePrice: number) => EffectivePrice;
}

export function useActiveMaterialRules(): UseActiveMaterialRules {
    const [activeRules, setActiveRules] = useState<MaterialPriceRule[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await listMaterialPriceRulesAction();
            if (res.success) {
                setActiveRules(res.rules.filter((r) => r.active === true));
            } else {
                setError(res.error);
                setActiveRules([]);
            }
        } catch (e: any) {
            setError(e?.message || 'No se pudieron cargar las reglas.');
            setActiveRules([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    const catalogRules = useMemo(
        () => activeRules.filter((r) => CATALOG_WIDE_SCOPES.includes(r.scope)),
        [activeRules],
    );

    const computeEffective = useCallback<UseActiveMaterialRules['computeEffective']>(
        (sku, category, basePrice) => {
            const safeBase = typeof basePrice === 'number' && Number.isFinite(basePrice) ? basePrice : 0;
            const { factor, appliedRule } = resolveMaterialFactor({ sku, category }, catalogRules);
            return {
                basePrice: safeBase,
                effectivePrice: Math.round(safeBase * factor * 100) / 100,
                factor,
                appliedRule,
                adjustmentPct: appliedRule ? appliedRule.adjustmentPct : null,
            };
        },
        [catalogRules],
    );

    return { activeRules, catalogRules, loading, error, reload, computeEffective };
}

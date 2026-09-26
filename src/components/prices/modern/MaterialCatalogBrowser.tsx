'use client';

/**
 * Explorador del catálogo de materiales (TAREA 1): filtro por categoría (nivel
 * padre), paginación por servidor y precio efectivo (base → efectivo + badge)
 * según las reglas de ajuste activas. Incluye acciones rápidas para crear reglas
 * por material (fila), por categoría (bulk) y globales (bulk).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Package, ChevronLeft, ChevronRight, RefreshCw, Loader2, Percent, Globe, Info } from 'lucide-react';
import {
    listMaterialsAction,
    listMaterialCategoriesAction,
    type CatalogMaterialRow,
    type MaterialCategoryFacet,
} from '@/actions/material-catalog/list-materials.action';
import { useActiveMaterialRules } from '@/components/prices/rules/useActiveMaterialRules';
import { EffectivePriceCell, AdjustmentBadge } from '@/components/prices/rules/PriceCells';
import { MaterialRuleDialog, type RuleInput } from '@/components/prices/rules/MaterialRuleDialog';

const ALL_CATEGORIES = '__all__';
const PAGE_SIZES = [25, 50, 100];

export function MaterialCatalogBrowser({ onRulesChanged }: { onRulesChanged?: () => void }) {
    const { toast } = useToast();
    const { computeEffective, reload: reloadRules, activeRules } = useActiveMaterialRules();

    const [items, setItems] = useState<CatalogMaterialRow[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(25);
    const [category, setCategory] = useState<string>(ALL_CATEGORIES);
    const [loading, setLoading] = useState(false);

    const [facets, setFacets] = useState<MaterialCategoryFacet[]>([]);
    const [facetsTruncated, setFacetsTruncated] = useState(false);

    const [dialog, setDialog] = useState<{ open: boolean; initial?: Partial<RuleInput> }>({ open: false });

    const effectiveCategory = category === ALL_CATEGORIES ? null : category;

    const loadPage = useCallback(async () => {
        setLoading(true);
        try {
            const res = await listMaterialsAction({ page, pageSize, category: effectiveCategory });
            if (res.success) {
                setItems(res.items);
                setTotal(res.total);
            } else {
                toast({ variant: 'destructive', title: 'No se pudo cargar el catálogo', description: res.error });
                setItems([]);
                setTotal(0);
            }
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, effectiveCategory, toast]);

    useEffect(() => {
        void loadPage();
    }, [loadPage]);

    // Facetas de categoría: una sola vez.
    useEffect(() => {
        listMaterialCategoriesAction()
            .then((res) => {
                if (res.success) {
                    setFacets(res.categories);
                    setFacetsTruncated(res.truncated);
                }
            })
            .catch(() => undefined);
    }, []);

    const categorySuggestions = useMemo(() => facets.map((f) => f.parent), [facets]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const fromRow = total === 0 ? 0 : page * pageSize + 1;
    const toRow = Math.min(total, (page + 1) * pageSize);

    const onRuleSaved = () => {
        void reloadRules();
        void loadPage();
        onRulesChanged?.();
    };

    const openMaterialAdjust = (row: CatalogMaterialRow) => {
        setDialog({ open: true, initial: { scope: 'material', target: { sku: row.sku } } });
    };
    const openCategoryAdjust = () => {
        if (!effectiveCategory) return;
        setDialog({ open: true, initial: { scope: 'category', target: { category: effectiveCategory } } });
    };
    const openGlobalAdjust = () => {
        setDialog({ open: true, initial: { scope: 'global', target: {} } });
    };

    return (
        <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
                <CardTitle className="flex items-center gap-2 text-lg font-medium">
                    <Package className="h-5 w-5 text-orange-600" />
                    Catálogo de materiales
                    <Badge variant="secondary">{total.toLocaleString('es-ES')}</Badge>
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                    <Select
                        value={category}
                        onValueChange={(v) => {
                            setCategory(v);
                            setPage(0);
                        }}
                    >
                        <SelectTrigger className="h-9 w-[220px]">
                            <SelectValue placeholder="Categoría" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL_CATEGORIES}>Todas las categorías</SelectItem>
                            {facets.map((f) => (
                                <SelectItem key={f.parent} value={f.parent}>
                                    {f.parent} ({f.count})
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" onClick={openGlobalAdjust}>
                        <Globe className="mr-2 h-4 w-4" /> Ajustar todos %
                    </Button>
                    <Button variant="outline" size="sm" onClick={openCategoryAdjust} disabled={!effectiveCategory}>
                        <Percent className="mr-2 h-4 w-4" /> Ajustar categoría %
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => void loadPage()} disabled={loading} title="Recargar">
                        <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {facetsTruncated && (
                    <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        Las categorías se han detectado sobre una muestra del catálogo; puede que no aparezcan todas.
                    </div>
                )}

                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>SKU</TableHead>
                                <TableHead>Producto</TableHead>
                                <TableHead>Categoría</TableHead>
                                <TableHead className="text-right">Precio</TableHead>
                                <TableHead className="text-center">Regla</TableHead>
                                <TableHead className="text-right">Acción</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                                        {loading ? 'Cargando…' : 'No hay materiales para este filtro.'}
                                    </TableCell>
                                </TableRow>
                            ) : (
                                items.map((row) => {
                                    const eff = computeEffective(row.sku, row.category, row.price);
                                    return (
                                        <TableRow key={row.id || row.sku}>
                                            <TableCell className="font-mono text-xs text-muted-foreground">{row.sku}</TableCell>
                                            <TableCell className="max-w-[280px]">
                                                <div className="truncate font-medium" title={row.name}>
                                                    {row.name}
                                                </div>
                                                <div className="truncate text-xs text-muted-foreground" title={row.description}>
                                                    {row.description}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="whitespace-nowrap text-[10px]">
                                                    {row.category.split('>').pop()?.trim() || row.category}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <EffectivePriceCell eff={eff} unit={row.unit} />
                                            </TableCell>
                                            <TableCell className="text-center">
                                                {eff.appliedRule && eff.adjustmentPct !== null ? (
                                                    <AdjustmentBadge pct={eff.adjustmentPct} />
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="sm" onClick={() => openMaterialAdjust(row)}>
                                                    <Percent className="mr-1 h-3.5 w-3.5" /> Ajustar %
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* Paginación */}
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <span>
                            {fromRow.toLocaleString('es-ES')}–{toRow.toLocaleString('es-ES')} de{' '}
                            {total.toLocaleString('es-ES')}
                        </span>
                        {activeRules.length > 0 && (
                            <Badge variant="outline" className="text-[10px]">
                                {activeRules.length} regla(s) activa(s)
                            </Badge>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <Select
                            value={String(pageSize)}
                            onValueChange={(v) => {
                                setPageSize(Number(v));
                                setPage(0);
                            }}
                        >
                            <SelectTrigger className="h-8 w-[110px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {PAGE_SIZES.map((s) => (
                                    <SelectItem key={s} value={String(s)}>
                                        {s} / pág.
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setPage((p) => Math.max(0, p - 1))}
                            disabled={page === 0 || loading}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="min-w-[90px] text-center text-muted-foreground">
                            Pág. {page + 1} / {totalPages}
                        </span>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setPage((p) => p + 1)}
                            disabled={(page + 1) * pageSize >= total || loading}
                        >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
                        </Button>
                    </div>
                </div>
            </CardContent>

            <MaterialRuleDialog
                open={dialog.open}
                onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
                mode="create"
                lockScope
                initial={dialog.initial}
                categorySuggestions={categorySuggestions}
                onSaved={onRuleSaved}
            />
        </Card>
    );
}

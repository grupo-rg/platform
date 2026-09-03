'use client';

import { useState, useEffect } from 'react';
import { Search, Plus, Package, Loader2, Hammer, ShoppingCart, ChevronDown, ChevronUp, Layers } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UnifiedCatalogItem } from '@/backend/catalog/domain/catalog-item';
import { searchCatalogAction } from '@/actions/catalog/search-catalog.action';
import { getPriceBookBreakdown } from '@/actions/price-book/get-price-book-breakdown.action';
import { useToast } from '@/hooks/use-toast';
import { EditableBudgetLineItem } from '@/types/budget-editor';
import { formatCurrency, formatNumberES } from '@/lib/utils';

interface SemanticCatalogSidebarProps {
    onAddItem: (item: Partial<EditableBudgetLineItem>) => void;
}

/** Normaliza un componente (embebido legacy o v005 fetched) a una forma común. */
const normalizeComp = (comp: any) => {
    const code: string = comp.code ?? '';
    const description: string = comp.description || comp.concept || comp.name || comp.code || 'Componente';
    const unit: string = comp.unit ?? comp.unit_raw ?? '';
    const quantity: number = comp.quantity ?? comp.yield ?? 1;
    const price: number = comp.price ?? comp.price_unit ?? comp.unitPrice ?? 0;
    const total = unit === '%' ? price * (quantity / 100) : price * quantity;
    return { code, description, unit, quantity, price, total, is_variable: comp.is_variable === true };
};

/** Clasifica un componente por prefijo COAATMCA (mo/mt/mq) para el color del chip. */
const classifyType = (code: string | undefined): 'LABOR' | 'MATERIAL' | 'MACHINERY' | 'OTHER' => {
    const c = (code || '').toLowerCase();
    if (c.startsWith('mo')) return 'LABOR';
    if (c.startsWith('mt')) return 'MATERIAL';
    if (c.startsWith('mq')) return 'MACHINERY';
    return 'OTHER';
};

const COMP_CHIP: Record<string, string> = {
    LABOR: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400',
    MATERIAL: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400',
    MACHINERY: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400',
    OTHER: 'text-slate-500 bg-slate-100 dark:bg-white/10 dark:text-slate-400',
};

/**
 * Descompuesto de un resultado de búsqueda. Se monta SOLO cuando el usuario
 * expande la partida, así que la carga es lazy (fetch on-expand), reutilizando
 * `getPriceBookBreakdown` (mismo patrón que `ComponentSubBreakdown`).
 *
 * - Si el item trae `originalItem.breakdown` embebido (partidas legacy), se
 *   usa directamente sin fetch.
 * - Si no (partidas v005, cuyo descompuesto vive en docs hermanos), se hace
 *   fetch por código.
 */
function ResultBreakdown({ item }: { item: UnifiedCatalogItem }) {
    const origin = item.originalItem as any;
    const embedded: any[] = origin?.breakdown || [];
    const hasEmbedded = embedded.length > 0;

    const [components, setComponents] = useState<any[] | null>(hasEmbedded ? embedded : null);
    const [loading, setLoading] = useState(!hasEmbedded && item.type === 'LABOR');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (hasEmbedded || item.type !== 'LABOR') return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        getPriceBookBreakdown(item.code)
            .then((result) => {
                if (cancelled) return;
                if (!result.success) {
                    setError(result.error || 'No se pudo cargar el descompuesto.');
                    setComponents([]);
                    return;
                }
                setComponents(result.components);
            })
            .catch((e: any) => {
                if (cancelled) return;
                console.error('[SemanticCatalogSidebar] breakdown fetch failed', e);
                setError(e?.message || 'Error al cargar el descompuesto.');
                setComponents([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [item.code, item.type, hasEmbedded]);

    if (loading) {
        return (
            <div className="mt-2 pl-3 ml-2 border-l-2 border-indigo-200 dark:border-indigo-800 text-xs flex items-center gap-2 text-slate-500 py-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                Cargando descompuesto…
            </div>
        );
    }

    if (error) {
        return (
            <div className="mt-2 pl-3 ml-2 border-l-2 border-red-200 dark:border-red-800 text-[11px] text-red-700 dark:text-red-400 py-2">
                {error}
            </div>
        );
    }

    if (!components || components.length === 0) {
        return (
            <div className="mt-2 pl-3 ml-2 border-l-2 border-slate-200 dark:border-white/10 text-[11px] italic text-slate-500 py-2">
                Sin descompuesto disponible para esta partida.
            </div>
        );
    }

    const normalized = components.map(normalizeComp);
    const sum = normalized.reduce((acc, c) => acc + c.total, 0);

    return (
        <div className="mt-2 pl-3 ml-2 border-l-2 border-indigo-300 dark:border-indigo-700 space-y-1.5 animate-in slide-in-from-top-2">
            <div className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                Descompuesto ({normalized.length} {normalized.length === 1 ? 'componente' : 'componentes'})
            </div>
            <div className="space-y-1">
                {normalized.map((c, idx) => {
                    const kind = classifyType(c.code);
                    return (
                        <div key={idx} className="flex justify-between items-start text-xs text-slate-600 dark:text-slate-300 gap-2">
                            <div className="min-w-0 flex-1 flex items-start gap-1.5">
                                <span className={`shrink-0 mt-0.5 font-mono text-[9px] px-1 py-0 rounded ${COMP_CHIP[kind]}`}>
                                    {c.code || '—'}
                                </span>
                                <span className="min-w-0" title={c.description}>
                                    {c.description}
                                    {c.is_variable && (
                                        <span className="ml-1 text-[8px] uppercase font-bold text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 px-1 rounded">
                                            VAR
                                        </span>
                                    )}
                                    <span className="text-[10px] text-slate-400 ml-1 whitespace-nowrap">
                                        ({formatNumberES(c.quantity, 3)} {c.unit} × {formatCurrency(c.price)})
                                    </span>
                                </span>
                            </div>
                            <span className="font-mono whitespace-nowrap shrink-0">
                                {formatCurrency(c.total)}
                            </span>
                        </div>
                    );
                })}
            </div>
            <div className="flex justify-between items-center text-xs font-semibold text-slate-700 dark:text-slate-200 pt-1 border-t border-slate-200 dark:border-white/10">
                <span>Suma descompuesto</span>
                <span className="font-mono">{formatCurrency(sum)}</span>
            </div>
        </div>
    );
}

export const SemanticCatalogSidebar = ({ onAddItem }: SemanticCatalogSidebarProps) => {
    const [search, setSearch] = useState('');
    const [activeTab, setActiveTab] = useState<'LABOR' | 'MATERIAL'>('LABOR');
    const [expandedDesc, setExpandedDesc] = useState<Set<string>>(new Set());
    const [expandedBreakdown, setExpandedBreakdown] = useState<Set<string>>(new Set());
    const [items, setItems] = useState<UnifiedCatalogItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    const toggleSet = (setter: (updater: (prev: Set<string>) => Set<string>) => void, id: string) => {
        setter((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // Debounce Search
    useEffect(() => {
        const timer = setTimeout(async () => {
            if (search.trim().length > 2) {
                setIsLoading(true);
                try {
                    const results = await searchCatalogAction(search);
                    setItems(results);
                    // Reset expand state on new search
                    setExpandedDesc(new Set());
                    setExpandedBreakdown(new Set());
                } catch (error) {
                    console.error("Search error", error);
                    toast({
                        title: "Error",
                        description: "No se pudieron cargar los resultados.",
                        variant: "destructive"
                    });
                } finally {
                    setIsLoading(false);
                }
            } else if (search.trim().length === 0) {
                setItems([]);
            }
        }, 500);

        return () => clearTimeout(timer);
    }, [search, toast]);

    const filteredItems = items.filter(item => item.type === activeTab);

    const handleAdd = async (item: UnifiedCatalogItem) => {
        const origin = item.originalItem as any;
        const resolvedChapter = origin?.chapter || (item.type === 'LABOR' ? 'General' : 'Materiales');

        // Phase 18 — para items LABOR (price_book v005) el descompuesto vive en
        // docs hermanos (kind='breakdown'). Lo cargamos on-demand al añadir.
        // Para MATERIAL (material-catalog) no aplica.
        let rawBreakdown = origin?.breakdown;
        if (item.type === 'LABOR' && (!rawBreakdown || rawBreakdown.length === 0)) {
            try {
                const result = await getPriceBookBreakdown(item.code);
                if (result.success && result.components.length > 0) {
                    rawBreakdown = result.components;
                }
            } catch (e) {
                console.warn('[SemanticCatalogSidebar] Failed to load breakdown for', item.code, e);
            }
        }

        // Map PriceBookComponent → BudgetBreakdownComponent (clasifica por prefijo COAATMCA).
        const breakdown = rawBreakdown && rawBreakdown.length > 0
            ? rawBreakdown.map((c: any) => ({
                code: c.code,
                concept: c.description || c.concept || c.code || '',
                type: classifyType(c.code),
                price: c.price ?? c.price_unit ?? c.unitPrice ?? 0,
                unit: c.unit ?? c.unit_raw,
                quantity: c.quantity ?? c.yield ?? 1,
                total: (c.price ?? c.price_unit ?? c.unitPrice ?? 0) * (c.quantity ?? c.yield ?? 1),
                is_variable: c.is_variable,
            }))
            : undefined;

        const newItem: Partial<EditableBudgetLineItem> = {
            originalTask: item.name,
            chapter: resolvedChapter,
            item: {
                code: item.code,
                description: item.description,
                unit: item.unit,
                quantity: 1,
                unitPrice: item.price,
                totalPrice: item.price,
                breakdown,
            },
            originalState: {
                unitPrice: item.price,
                quantity: 1,
                description: item.description,
                unit: item.unit,
            },
        };

        onAddItem(newItem);
        toast({
            title: item.type === 'LABOR' ? 'Partida añadida' : 'Material añadido',
            description: `${item.code} se ha añadido al presupuesto${breakdown && breakdown.length > 0 ? ` (${breakdown.length} componentes)` : ''}.`,
        });
    };

    return (
        <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm flex flex-col h-[60vh] min-h-[400px] max-h-[800px] overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-white/10 bg-slate-50/50 dark:bg-white/5 space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <Package className="w-4 h-4 text-primary dark:text-primary/90" />
                        Catálogo Unificado
                    </h3>
                </div>

                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400 dark:text-white/40" />
                    <Input
                        placeholder="Buscar partida o material..."
                        className="pl-9 bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    {isLoading && (
                        <div className="absolute right-3 top-2.5">
                            <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        </div>
                    )}
                </div>

                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
                    <TabsList className="grid w-full grid-cols-2 h-8">
                        <TabsTrigger value="LABOR" className="text-xs">Partidas</TabsTrigger>
                        <TabsTrigger value="MATERIAL" className="text-xs">Materiales</TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            <div className="flex-1 overflow-y-auto p-0">
                <div className="p-2 space-y-1">
                    {items.length === 0 && !isLoading ? (
                        <div className="text-center py-8 text-slate-400 dark:text-white/40 text-sm px-4">
                            {search.length > 0 && search.length < 3
                                ? "Escribe al menos 3 caracteres..."
                                : "Busca partidas de obra o materiales de construcción."}
                        </div>
                    ) : (
                        filteredItems.map((item) => {
                            const isDescOpen = expandedDesc.has(item.id);
                            const isBreakdownOpen = expandedBreakdown.has(item.id);
                            const fullDesc = item.description || item.name;
                            // `name` es una descripción truncada (substring 0..100 + '…') para
                            // LABOR; para MATERIAL es un nombre corto. Ofrecemos "ver completa"
                            // cuando la descripción íntegra aporta más texto.
                            const canExpandDesc = (fullDesc || '').trim().length > (item.name || '').trim().length;
                            // Las partidas (LABOR) siempre pueden tener descompuesto (lazy).
                            const canShowBreakdown = item.type === 'LABOR' || ((item.originalItem as any)?.breakdown?.length > 0);

                            return (
                                <div
                                    key={item.id}
                                    className="group flex flex-col gap-2 p-3 rounded-lg border border-transparent hover:bg-slate-50 dark:hover:bg-white/5 hover:border-slate-100 dark:hover:border-white/5 transition-all cursor-default"
                                >
                                    <div className="flex justify-between items-start gap-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 border ${item.type === 'LABOR'
                                                    ? 'text-blue-600 border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800'
                                                    : 'text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800'
                                                    }`}>
                                                    {item.type === 'LABOR' ? <Hammer className="w-3 h-3 mr-1" /> : <ShoppingCart className="w-3 h-3 mr-1" />}
                                                    {item.type === 'LABOR' ? 'Partida' : 'Material'}
                                                </Badge>
                                            </div>
                                            <h4
                                                className={`font-medium text-sm text-slate-700 dark:text-white leading-tight ${isDescOpen ? '' : 'line-clamp-2'}`}
                                                title={fullDesc}
                                            >
                                                {isDescOpen ? fullDesc : item.name}
                                            </h4>
                                            {canExpandDesc && (
                                                <button
                                                    type="button"
                                                    className="text-[11px] text-primary hover:underline mt-0.5"
                                                    onClick={() => toggleSet(setExpandedDesc, item.id)}
                                                >
                                                    {isDescOpen ? 'Ver menos' : 'Ver descripción completa'}
                                                </button>
                                            )}
                                        </div>
                                        <span className="font-mono text-xs font-bold text-slate-600 dark:text-white/90 bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 rounded whitespace-nowrap">
                                            {formatCurrency(item.price)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-end mt-1">
                                        <span className="text-[10px] text-slate-400 dark:text-white/30 font-mono truncate max-w-[120px]">
                                            {item.code} • {item.unit}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            {canShowBreakdown && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                                                    onClick={() => toggleSet(setExpandedBreakdown, item.id)}
                                                >
                                                    <Layers className="w-3 h-3 mr-1" />
                                                    Descompuesto
                                                    {isBreakdownOpen ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
                                                </Button>
                                            )}
                                            <Button
                                                size="sm"
                                                className="h-7 text-xs"
                                                onClick={() => handleAdd(item)}
                                            >
                                                <Plus className="w-3 h-3 mr-1" /> Añadir
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Descompuesto expandible (lazy-fetch on-expand) */}
                                    {isBreakdownOpen && canShowBreakdown && (
                                        <ResultBreakdown item={item} />
                                    )}
                                </div>
                            )
                        })
                    )}
                </div>
            </div>
        </div>
    );
};

'use client';

import { useState, useEffect } from 'react';
import { Search, Plus, Package, Loader2, Hammer, ShoppingCart, ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UnifiedCatalogItem } from '@/backend/catalog/domain/catalog-item';
import { searchCatalogAction } from '@/actions/catalog/search-catalog.action';
import { useToast } from '@/hooks/use-toast';
import { EditableBudgetLineItem } from '@/types/budget-editor';
import { formatCurrency } from '@/lib/utils';

interface SemanticCatalogSidebarProps {
    onAddItem: (item: Partial<EditableBudgetLineItem>) => void;
}

export const SemanticCatalogSidebar = ({ onAddItem }: SemanticCatalogSidebarProps) => {
    const [search, setSearch] = useState('');
    const [activeTab, setActiveTab] = useState<'LABOR' | 'MATERIAL'>('LABOR');
    const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
    const [items, setItems] = useState<UnifiedCatalogItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    // Debounce Search
    useEffect(() => {
        const timer = setTimeout(async () => {
            if (search.trim().length > 2) {
                setIsLoading(true);
                try {
                    const results = await searchCatalogAction(search);
                    setItems(results);
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

    // Calculate total from breakdown to handle percentages
    const calculateCompTotal = (comp: any) => {
        const cPrice = comp.price_unit ?? comp.unitPrice ?? comp.price ?? 0;
        const cQuantity = comp.quantity ?? comp.yield ?? 1;
        if (comp.unit === '%') {
            return cPrice * (cQuantity / 100);
        }
        return cPrice * cQuantity;
    };

    const handleAdd = (item: UnifiedCatalogItem) => {
        // Evaluate native chapter from original datastore OR fallback to generic
        const origin = item.originalItem as any;
        const resolvedChapter = origin?.chapter || (item.type === 'LABOR' ? 'General' : 'Materiales');

        // Map UnifiedCatalogItem to EditableBudgetLineItem
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
                breakdown: origin?.breakdown
            },
            originalState: {
                unitPrice: item.price,
                quantity: 1,
                description: item.description,
                unit: item.unit
            }
        };

        onAddItem(newItem);
        toast({
            title: item.type === 'LABOR' ? "Partida añadida" : "Material añadido",
            description: `${item.code} se ha añadido al presupuesto.`,
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
                            const isExpanded = expandedItemId === item.id;
                            const origin = item.originalItem as any;
                            const breakdown = origin?.breakdown || [];
                            const hasBreakdown = breakdown.length > 0;

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
                                            <h4 className="font-medium text-sm text-slate-700 dark:text-white leading-tight line-clamp-2" title={item.description}>
                                                {item.name}
                                            </h4>
                                        </div>
                                        <span className="font-mono text-xs font-bold text-slate-600 dark:text-white/90 bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 rounded whitespace-nowrap">
                                            {formatCurrency(item.price)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-end mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <span className="text-[10px] text-slate-400 dark:text-white/30 font-mono truncate max-w-[120px]">
                                            {item.code} • {item.unit}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            {hasBreakdown && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                                                    onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                                                >
                                                    Desglose
                                                    {isExpanded ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
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

                                    {/* Expanded Breakdown View */}
                                    {isExpanded && hasBreakdown && (
                                        <div className="mt-2 pl-3 ml-2 border-l-2 border-slate-200 dark:border-white/10 space-y-2 animate-in slide-in-from-top-2">
                                            <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                                                Componentes del precio
                                            </div>
                                            {breakdown.map((comp: any, idx: number) => {
                                                const cDesc = comp.description || comp.name || comp.concept || 'Componente';
                                                const cPrice = comp.price_unit ?? comp.unitPrice ?? comp.price ?? 0;
                                                const cQuantity = comp.quantity ?? comp.yield ?? 1;
                                                const computedTotal = calculateCompTotal(comp);

                                                return (
                                                    <div key={idx} className="flex justify-between items-center text-xs text-slate-600 dark:text-slate-300">
                                                        <span className="truncate pr-2" title={cDesc}>
                                                            • {cDesc}
                                                            {comp.unit && <span className="text-[10px] text-slate-400 ml-1">({parseFloat(cQuantity).toFixed(2)} {comp.unit})</span>}
                                                        </span>
                                                        <span className="font-mono whitespace-nowrap">
                                                            {formatCurrency(computedTotal)}
                                                        </span>
                                                    </div>
                                                )
                                            })}
                                        </div>
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

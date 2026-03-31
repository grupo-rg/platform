'use client';

import { SmartAddInput } from './SmartAddInput';

import { useState, useEffect } from 'react';
import { Search, Plus, Package, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EditableBudgetLineItem } from '@/types/budget-editor';
import { searchPriceBookAction } from '@/actions/price-book/search-items.action';
import { PriceBookItem } from '@/backend/price-book/domain/price-book-item';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/utils';

interface BudgetLibrarySidebarProps {
    onAddItem: (item: Partial<EditableBudgetLineItem>) => void;
    leadId?: string;
    isReadOnly?: boolean;
}

export const BudgetLibrarySidebar = ({ onAddItem, leadId, isReadOnly }: BudgetLibrarySidebarProps) => {
    const [search, setSearch] = useState('');
    const [items, setItems] = useState<PriceBookItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    // Debounce Search
    useEffect(() => {
        const timer = setTimeout(async () => {
            if (search.trim().length > 2) {
                setIsLoading(true);
                try {
                    const result = await searchPriceBookAction(search);
                    if (result.success && result.data) {
                        setItems(result.data);
                    } else {
                        toast({
                            title: "Error en búsqueda",
                            description: result.error || "No se pudieron cargar los datos.",
                            variant: "destructive"
                        });
                    }
                } catch (error) {
                    console.error("Search error", error);
                } finally {
                    setIsLoading(false);
                }
            } else if (search.trim().length === 0) {
                setItems([]);
            }
        }, 500);

        return () => clearTimeout(timer);
    }, [search, toast]);

    const handleAdd = (dbItem: PriceBookItem) => {
        // Map PriceBookItem to EditableBudgetLineItem structure
        // Heuristic to determine type
        // If it has a breakdown, it's a PARTIDA (composed).
        // If it has only material price and no labor, it's likely a MATERIAL or simple supply.
        // If unit is 'h', it's LABOR.
        let inferredType: 'PARTIDA' | 'MATERIAL' = 'PARTIDA';

        if ((dbItem.priceMaterial || 0) > 0 && (dbItem.priceLabor || 0) === 0 && (!dbItem.breakdown || dbItem.breakdown.length === 0)) {
            inferredType = 'MATERIAL';
        }

        const newItem: Partial<EditableBudgetLineItem> = {
            originalTask: dbItem.description.substring(0, 50) + (dbItem.description.length > 50 ? '...' : ''),
            chapter: 'General',
            type: inferredType, // Set the inferred type
            item: {
                description: dbItem.description,
                unit: dbItem.unit,
                quantity: 1,
                unitPrice: dbItem.priceTotal,
                totalPrice: dbItem.priceTotal,
                code: dbItem.code,
                matchConfidence: 100 // It's from the catalog
            },
            originalState: {
                unitPrice: dbItem.priceTotal,
                quantity: 1,
                description: dbItem.description,
                unit: dbItem.unit
            }
        };
        onAddItem(newItem);
        toast({
            title: "Partida añadida",
            description: `${dbItem.code} se ha añadido al presupuesto.`,
        });
    };

    return (
        <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm flex flex-col h-[calc(100vh-180px)] overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-white/10 bg-slate-50/50 dark:bg-white/5 space-y-4">
                <div className="space-y-2">
                    <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <Package className="w-4 h-4 text-primary dark:text-primary/90" />
                        Biblioteca de Precios
                    </h3>
                    <SmartAddInput
                        onAddItems={(newItems) => newItems.forEach(onAddItem)}
                        className="shadow-sm"
                        leadId={leadId}
                        isReadOnly={isReadOnly}
                    />
                </div>

                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400 dark:text-white/40" />
                    <Input
                        placeholder="Buscar (min 3 letras)..."
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
            </div>

            <ScrollArea className="flex-1 p-0">
                <div className="p-2 space-y-1">
                    {items.length === 0 && !isLoading ? (
                        <div className="text-center py-8 text-slate-400 dark:text-white/40 text-sm px-4">
                            {search.length > 0 && search.length < 3
                                ? "Escribe al menos 3 caracteres..."
                                : "Busca partidas en tu base de datos centralizada."}
                        </div>
                    ) : (
                        items.map((item) => (
                            <div
                                key={item.id}
                                className="group flex flex-col gap-2 p-3 rounded-lg border border-transparent hover:bg-slate-50 dark:hover:bg-white/5 hover:border-slate-100 dark:hover:border-white/5 transition-all cursor-default"
                            >
                                <div className="flex justify-between items-start gap-2">
                                    <div>
                                        <Badge variant="outline" className="text-[10px] mb-1 text-slate-500 dark:text-white/50 border-slate-200 dark:border-white/10 font-normal">
                                            {item.year}
                                        </Badge>
                                        <h4 className="font-medium text-sm text-slate-700 dark:text-white leading-tight line-clamp-2">
                                            {item.description}
                                        </h4>
                                    </div>
                                    <span className="font-mono text-xs font-bold text-slate-600 dark:text-white/90 bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 rounded whitespace-nowrap">
                                        {formatCurrency(item.priceTotal)}
                                    </span>
                                </div>
                                <div className="flex justify-between items-end mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span className="text-[10px] text-slate-400 dark:text-white/30 font-mono">{item.code}</span>
                                    <Button
                                        size="sm"
                                        className="h-7 text-xs"
                                        onClick={() => handleAdd(item)}
                                    >
                                        <Plus className="w-3 h-3 mr-1" /> Añadir
                                    </Button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </ScrollArea>
        </div>
    );
};

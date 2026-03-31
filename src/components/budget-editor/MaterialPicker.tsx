'use client';

import { useState, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Loader2, Package } from 'lucide-react';
import { MaterialItem } from '@/backend/material-catalog/domain/material-item';
import { searchMaterialsAction } from '@/backend/material-catalog/actions/search-materials.action';

interface MaterialPickerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSelect: (material: MaterialItem) => void;
    currentMaterialName?: string;
}

export function MaterialPicker({ open, onOpenChange, onSelect, currentMaterialName }: MaterialPickerProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<MaterialItem[]>([]);
    const [loading, setLoading] = useState(false);

    // Search Handler
    const handleSearch = useCallback(async (q: string) => {
        if (q.length < 2) return;
        setLoading(true);
        try {
            const items = await searchMaterialsAction(q);
            setResults(items);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, []);

    // Trigger search on enter or button
    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSearch(query);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0 gap-0 overflow-hidden bg-white dark:bg-slate-950">
                <DialogHeader className="p-4 border-b">
                    <DialogTitle className="flex items-center gap-2">
                        <Package className="w-5 h-5 text-blue-500" />
                        Catálogo de Materiales
                    </DialogTitle>
                </DialogHeader>

                <div className="p-4 bg-slate-50 dark:bg-slate-900 border-b">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <Input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={onKeyDown}
                            placeholder="Buscar material (ej. 'Ladrillo hueco', 'Parquet')..."
                            className="pl-9 w-full bg-white dark:bg-black border-slate-200 dark:border-slate-800"
                        />
                        <Button
                            size="sm"
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-7"
                            onClick={() => handleSearch(query)}
                            disabled={loading || query.length < 2}
                        >
                            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Buscar'}
                        </Button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[300px]">
                    {results.length === 0 && !loading && (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
                            <Search className="w-8 h-8 opacity-20" />
                            <p className="text-sm">Busca materiales para ver resultados</p>
                            {currentMaterialName && (
                                <Button
                                    variant="link"
                                    className="text-xs"
                                    onClick={() => {
                                        setQuery(currentMaterialName);
                                        handleSearch(currentMaterialName);
                                    }}
                                >
                                    Buscar &quot;{currentMaterialName}&quot;
                                </Button>
                            )}
                        </div>
                    )}

                    {loading && (
                        <div className="flex items-center justify-center h-full text-slate-400">
                            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Buscando...
                        </div>
                    )}

                    {results.map((item) => (
                        <div
                            key={item.id || item.sku}
                            className="group flex items-start gap-4 p-3 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-900 border border-transparent hover:border-slate-200 dark:hover:border-slate-800 transition-all cursor-pointer"
                        >
                            <div className="w-16 h-16 bg-white dark:bg-white/5 rounded-md border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0 overflow-hidden text-slate-300">
                                <Package className="w-8 h-8" />
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between">
                                    <h4 className="font-medium text-sm text-slate-800 dark:text-slate-200 leading-tight">
                                        {item.name}
                                    </h4>
                                    <span className="font-bold font-mono text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded text-sm ml-2 whitespace-nowrap">
                                        {item.price.toFixed(2)}€ / {item.unit}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                                    <span className="bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 rounded text-[10px] items-center flex uppercase tracking-wider font-semibold">
                                        {item.category || 'MATERIAL'}
                                    </span>
                                    {item.sku && (
                                        <span className="font-mono opacity-70">REF: {item.sku}</span>
                                    )}
                                </div>

                                <p className="text-xs text-slate-400 mt-2 line-clamp-2">
                                    {item.description}
                                </p>
                            </div>

                            <div className="flex flex-col items-end gap-2 self-center">
                                <Button
                                    size="sm"
                                    onClick={() => {
                                        onSelect(item);
                                        onOpenChange(false);
                                    }}
                                    className="bg-blue-600 hover:bg-blue-700 text-white h-8"
                                >
                                    Seleccionar
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="p-2 border-t bg-slate-50 dark:bg-slate-950 text-[10px] text-center text-slate-400">
                    Búsqueda semántica potenciada por Google Gemini
                </div>
            </DialogContent>
        </Dialog>
    );
}

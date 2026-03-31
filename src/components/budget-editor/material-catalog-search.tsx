'use client';

import * as React from 'react';
import { Search, Loader2, Package } from 'lucide-react';

// import { useDebounce } from '@/hooks/use-debounce'; // Removed as we use custom useEffect debounce
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { searchMaterialsAction } from '@/actions/material-catalog/search-materials.action';
import { MaterialItem } from '@/backend/material-catalog/domain/material-item';

interface MaterialCatalogSearchProps {
    onSelect: (item: MaterialItem) => void;
    trigger?: React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

export function MaterialCatalogSearch({ onSelect, trigger, open: controlledOpen, onOpenChange: setControlledOpen }: MaterialCatalogSearchProps) {
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
    const open = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;
    const setOpen = setControlledOpen || setUncontrolledOpen;
    const [query, setQuery] = React.useState('');
    const [loading, setLoading] = React.useState(false);
    const [results, setResults] = React.useState<MaterialItem[]>([]);

    // Simple debounce implementation if hook doesn't exist
    React.useEffect(() => {
        const timeoutId = setTimeout(async () => {
            if (query.length < 2) {
                setResults([]);
                return;
            }

            setLoading(true);
            const items = await searchMaterialsAction(query);
            setResults(items);
            setLoading(false);
        }, 500);

        return () => clearTimeout(timeoutId);
    }, [query]);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            {controlledOpen === undefined && (
                <DialogTrigger asChild>
                    {trigger || (
                        <Button variant="outline">
                            <Package className="mr-2 h-4 w-4" />
                            Buscar Material
                        </Button>
                    )}
                </DialogTrigger>
            )}
            <DialogContent className="sm:max-w-[600px] h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Catálogo de Materiales (Obramat)</DialogTitle>
                </DialogHeader>

                <div className="relative mb-4">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por nombre, referencia (SKU) o descripción..."
                        className="pl-8"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                </div>

                <ScrollArea className="flex-1 pr-4">
                    {loading && (
                        <div className="flex justify-center p-8">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    )}

                    {!loading && results && results.length === 0 && query.length >= 2 && (
                        <div className="text-center p-8 text-muted-foreground">
                            No se encontraron materiales.
                        </div>
                    )}

                    <div className="space-y-2">
                        {results && results.map((item) => (
                            <div
                                key={item.id || item.sku}
                                className="flex items-start justify-between p-3 border rounded-lg hover:bg-accent cursor-pointer transition-colors"
                                onClick={() => {
                                    onSelect(item);
                                    setOpen(false);
                                }}
                            >
                                <div>
                                    <div className="font-medium">{item.name}</div>
                                    <div className="text-xs text-muted-foreground line-clamp-2">{item.description}</div>
                                    <div className="mt-1 text-xs bg-secondary inline-block px-1.5 py-0.5 rounded text-secondary-foreground">
                                        Ref: {item.sku}
                                    </div>
                                </div>
                                <div className="text-right whitespace-nowrap ml-4">
                                    <div className="font-bold text-lg">
                                        {new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(item.price)}
                                    </div>
                                    <div className="text-xs text-muted-foreground">/ {item.unit}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}

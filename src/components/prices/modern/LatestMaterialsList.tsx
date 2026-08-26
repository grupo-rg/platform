'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getLatestMaterialsAction } from '@/actions/material-catalog/get-latest-materials.action';
import { MaterialItem } from '@/backend/material-catalog/domain/material-item';
import { formatCurrency } from '@/lib/utils';

export function LatestMaterialsList() {
    const [items, setItems] = useState<MaterialItem[]>([]);
    const [loading, setLoading] = useState(false);

    const loadItems = async () => {
        setLoading(true);
        const data = await getLatestMaterialsAction(10);
        setItems(data);
        setLoading(false);
    };

    useEffect(() => {
        loadItems();
    }, []);

    return (
        <Card className="col-span-1 lg:col-span-3">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg font-medium flex items-center gap-2">
                    <Package className="w-5 h-5 text-orange-600" />
                    Últimos Materiales Ingestados
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={loadItems} disabled={loading}>
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>SKU</TableHead>
                            <TableHead>Producto</TableHead>
                            <TableHead>Categoría</TableHead>
                            <TableHead className="text-right">Precio</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                                    No hay materiales recientes.
                                </TableCell>
                            </TableRow>
                        ) : (
                            items.map((item) => (
                                <TableRow key={item.id || item.sku}>
                                    <TableCell className="font-mono text-xs text-muted-foreground">{item.sku}</TableCell>
                                    <TableCell className="font-medium max-w-[300px] truncate" title={item.name}>
                                        {item.name}
                                        <div className="text-xs text-muted-foreground truncate">{item.description}</div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="secondary" className="text-[10px] whitespace-nowrap">
                                            {item.category.split('>').pop()?.trim() || item.category}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right font-bold">
                                        {formatCurrency(item.price)} / {item.unit}
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}

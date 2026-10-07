'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getLatestMaterialsAction } from '@/actions/material-catalog/get-latest-materials.action';
import { MaterialItem } from '@/backend/material-catalog/domain/material-item';
import { useActiveMaterialRules } from '@/components/prices/rules/useActiveMaterialRules';
import { EffectivePriceCell, AdjustmentBadge } from '@/components/prices/rules/PriceCells';

export function LatestMaterialsList() {
    const [items, setItems] = useState<MaterialItem[]>([]);
    const [loading, setLoading] = useState(false);
    const { computeEffective } = useActiveMaterialRules();

    const loadItems = async () => {
        setLoading(true);
        try {
            const data = await getLatestMaterialsAction(10);
            setItems(data);
        } catch (err) {
            // p.ej. "No autorizado" si la sesión caducó.
            console.error('[LatestMaterialsList] load failed:', err);
            setItems([]);
        } finally {
            setLoading(false);
        }
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
                            <TableHead className="text-center">Regla</TableHead>
                            <TableHead className="text-right">Precio</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                                    No hay materiales recientes.
                                </TableCell>
                            </TableRow>
                        ) : (
                            items.map((item) => {
                                const eff = computeEffective(item.sku, item.category, item.price);
                                return (
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
                                    <TableCell className="text-center">
                                        {eff.appliedRule && eff.adjustmentPct !== null ? (
                                            <AdjustmentBadge pct={eff.adjustmentPct} />
                                        ) : (
                                            <span className="text-xs text-muted-foreground">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <EffectivePriceCell eff={eff} unit={item.unit} />
                                    </TableCell>
                                </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}

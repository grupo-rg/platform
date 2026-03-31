'use client';

import { useState } from 'react';
import { PendingPriceItem } from '@/backend/budget/domain/pending-price-item';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Check, X, Edit, ExternalLink, Loader2 } from 'lucide-react';
import { approvePendingItemAction, rejectPendingItemAction } from './actions';
import { useToast } from '@/hooks/use-toast';

interface PendingItemsTableProps {
    initialItems: PendingPriceItem[];
}

export function PendingItemsTable({ initialItems }: PendingItemsTableProps) {
    const [items, setItems] = useState<PendingPriceItem[]>(initialItems);
    const [selectedItem, setSelectedItem] = useState<PendingPriceItem | null>(null);
    const [isApproveOpen, setIsApproveOpen] = useState(false);
    const [isRejectionOpen, setIsRejectionOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    // Form State for Editing before Approval
    const [formData, setFormData] = useState({
        code: '',
        description: '',
        price: 0,
        unit: ''
    });

    const openApprove = (item: PendingPriceItem) => {
        setSelectedItem(item);
        // Generate a smart code suggestion based on query (e.g., first 3 letters + random)
        const codeSuggestion = 'EST-' + Math.floor(Math.random() * 1000);
        setFormData({
            code: codeSuggestion,
            description: item.suggestedDescription,
            price: item.suggestedPrice,
            unit: item.suggestedUnit
        });
        setIsApproveOpen(true);
    };

    const handleApprove = async () => {
        if (!selectedItem) return;
        setIsLoading(true);
        try {
            await approvePendingItemAction({
                id: selectedItem.id,
                finalCode: formData.code,
                finalDescription: formData.description,
                finalPrice: Number(formData.price),
                finalUnit: formData.unit
            });

            toast({ title: 'Item Aprobado', description: 'Se ha añadido al libro de precios oficial.' });
            setItems(items.filter(i => i.id !== selectedItem.id));
            setIsApproveOpen(false);
        } catch (error) {
            console.error(error);
            toast({ title: 'Error', description: 'No se pudo aprobar el item.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReject = async (item: PendingPriceItem) => {
        if (!confirm('¿Estás seguro de rechazar este item?')) return;
        try {
            await rejectPendingItemAction(item.id);
            setItems(items.filter(i => i.id !== item.id));
            toast({ title: 'Item Rechazado', description: 'Se ha eliminado de la lista.' });
        } catch (error) {
            console.error(error);
        }
    };

    if (items.length === 0) {
        return <div className="text-center py-10 text-muted-foreground">No hay partidas pendientes de revisión.</div>;
    }

    return (
        <div>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Búsqueda Original</TableHead>
                        <TableHead>Sugerencia IA</TableHead>
                        <TableHead>Precio Sugerido</TableHead>
                        <TableHead>Acciones</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {items.map((item) => (
                        <TableRow key={item.id}>
                            <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                                {new Date(item.createdAt).toLocaleDateString()}
                            </TableCell>
                            <TableCell className="font-medium text-sm">
                                {item.searchQuery}
                                {item.originalUserRequestId && (
                                    <Badge variant="outline" className="ml-2 text-[10px]">Req: {item.originalUserRequestId}</Badge>
                                )}
                            </TableCell>
                            <TableCell className="max-w-[300px]">
                                <p className="truncate text-sm" title={item.suggestedDescription}>{item.suggestedDescription}</p>
                                <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                                    <ExternalLink className="w-3 h-3" />
                                    <span className="truncate max-w-[200px]">{item.sourceUrl}</span>
                                </div>
                            </TableCell>
                            <TableCell className="font-bold">
                                {item.suggestedPrice.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })} / {item.suggestedUnit}
                            </TableCell>
                            <TableCell>
                                <div className="flex items-center gap-2">
                                    <Button size="sm" variant="default" className="bg-green-600 hover:bg-green-700 h-8 w-8 p-0" onClick={() => openApprove(item)}>
                                        <Check className="w-4 h-4" />
                                    </Button>
                                    <Button size="sm" variant="destructive" className="h-8 w-8 p-0" onClick={() => handleReject(item)}>
                                        <X className="w-4 h-4" />
                                    </Button>
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>

            {/* Approve Modal */}
            <Dialog open={isApproveOpen} onOpenChange={setIsApproveOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Aprobar e Incorporar al Libro de Precios</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Código (Ref)</Label>
                                <Input value={formData.code} onChange={e => setFormData({ ...formData, code: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                                <Label>Unidad</Label>
                                <Input value={formData.unit} onChange={e => setFormData({ ...formData, unit: e.target.value })} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Descripción Técnica</Label>
                            <Textarea
                                className="h-24"
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Precio Unitario (€)</Label>
                            <Input
                                type="number"
                                step="0.01"
                                value={formData.price}
                                onChange={e => setFormData({ ...formData, price: parseFloat(e.target.value) })}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsApproveOpen(false)}>Cancelar</Button>
                        <Button onClick={handleApprove} disabled={isLoading}>
                            {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            Aprobar y Guardar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

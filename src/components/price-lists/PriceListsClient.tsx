'use client';

import React, { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copy, Download, Loader2, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import type { CompanyConfig } from '@/backend/platform/domain/company-config';
import {
    countPriceListItems,
    formatDateEs,
    PRICE_LIST_STATUS_LABELS,
    type PriceList,
} from '@/backend/price-list/domain/price-list';
import { deletePriceListAction, duplicatePriceListAction, listPriceListsAction } from '@/actions/price-list/price-list.action';
import { downloadBlob, priceListFileName, renderPriceListBlob, usePdfCompany } from './pdf-helpers';

export function PriceListsClient({ initialLists, company }: { initialLists: PriceList[]; company: CompanyConfig }) {
    const { toast } = useToast();
    const router = useRouter();
    const pdfCompany = usePdfCompany(company);
    const [lists, setLists] = useState(initialLists);
    const [query, setQuery] = useState('');
    const [toDelete, setToDelete] = useState<PriceList | null>(null);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return lists;
        return lists.filter((l) =>
            [l.reference, l.title, l.clientName, l.clientEmail].some((v) => (v || '').toLowerCase().includes(q)),
        );
    }, [lists, query]);

    const refresh = async () => {
        const res = await listPriceListsAction();
        if (res.success) setLists(res.data);
    };

    const duplicate = (l: PriceList) =>
        startTransition(async () => {
            const res = await duplicatePriceListAction(l.id);
            if (res.success) {
                toast({ title: 'Lista duplicada', description: `${res.data.reference} · ${res.data.title}` });
                await refresh();
            } else {
                toast({ title: 'No se pudo duplicar', description: res.error, variant: 'destructive' });
            }
        });

    const remove = (l: PriceList) =>
        startTransition(async () => {
            const res = await deletePriceListAction(l.id);
            if (res.success) {
                toast({ title: 'Lista eliminada' });
                setLists((prev) => prev.filter((x) => x.id !== l.id));
            } else {
                toast({ title: 'No se pudo eliminar', description: res.error, variant: 'destructive' });
            }
        });

    const download = async (l: PriceList) => {
        setDownloadingId(l.id);
        try {
            downloadBlob(await renderPriceListBlob(l, pdfCompany), priceListFileName(l));
        } catch (e: any) {
            console.error('[PriceListsClient] pdf', e);
            toast({ title: 'Error al generar el PDF', description: e?.message, variant: 'destructive' });
        } finally {
            setDownloadingId(null);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                <div className="relative w-full sm:max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por referencia, título o cliente" className="pl-8" />
                </div>
                <div className="flex items-center gap-2">
                    {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    <Button asChild>
                        <Link href="/dashboard/price-lists/new">
                            <Plus className="h-4 w-4 mr-1" /> Nueva lista
                        </Link>
                    </Button>
                </div>
            </div>

            <div className="rounded-md border overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Referencia</TableHead>
                            <TableHead>Título</TableHead>
                            <TableHead>Cliente</TableHead>
                            <TableHead>Fecha</TableHead>
                            <TableHead className="text-right">Líneas</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead className="w-[100px]" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                                    {lists.length === 0 ? 'Aún no hay listas de precios. Crea la primera con «Nueva lista».' : 'Ninguna lista coincide con la búsqueda.'}
                                </TableCell>
                            </TableRow>
                        )}
                        {filtered.map((l) => (
                            <TableRow key={l.id} className="cursor-pointer" onClick={() => router.push(`/dashboard/price-lists/${l.id}`)}>
                                <TableCell className="font-mono text-xs whitespace-nowrap">{l.reference}</TableCell>
                                <TableCell className="font-medium">{l.title}</TableCell>
                                <TableCell>{l.clientName || <span className="text-muted-foreground">Uso interno</span>}</TableCell>
                                <TableCell className="whitespace-nowrap">{formatDateEs(l.date)}</TableCell>
                                <TableCell className="text-right">{countPriceListItems(l.items)}</TableCell>
                                <TableCell>
                                    <Badge variant={l.status === 'issued' ? 'default' : 'secondary'}>{PRICE_LIST_STATUS_LABELS[l.status]}</Badge>
                                </TableCell>
                                <TableCell onClick={(e) => e.stopPropagation()} className="whitespace-nowrap">
                                    <Button variant="ghost" size="icon" onClick={() => download(l)} disabled={downloadingId === l.id} aria-label="Descargar PDF">
                                        {downloadingId === l.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                    </Button>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" aria-label="Acciones">
                                                <MoreHorizontal className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onClick={() => router.push(`/dashboard/price-lists/${l.id}`)}>
                                                <Pencil className="h-4 w-4 mr-2" /> Editar
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => duplicate(l)}>
                                                <Copy className="h-4 w-4 mr-2" /> Duplicar
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => download(l)}>
                                                <Download className="h-4 w-4 mr-2" /> Descargar PDF
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem className="text-destructive" onClick={() => setToDelete(l)}>
                                                <Trash2 className="h-4 w-4 mr-2" /> Eliminar
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar la lista {toDelete?.reference}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Se eliminará «{toDelete?.title}» con todas sus líneas. Esta acción no se puede deshacer.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                const l = toDelete;
                                setToDelete(null);
                                if (l) remove(l);
                            }}
                        >
                            Eliminar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

'use client';

import { PriceBookItem } from "@/backend/price-book/domain/price-book-item";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader, SheetDescription } from "@/components/ui/sheet";
import { useState } from "react";
import { PriceItemDetail } from "./PriceItemDetail";

interface PriceListProps {
    items: PriceBookItem[];
    loading: boolean;
}

export function PriceList({ items, loading }: PriceListProps) {
    const [page, setPage] = useState(1);
    const itemsPerPage = 50;

    const totalPages = Math.ceil(items.length / itemsPerPage);
    const paginatedItems = items.slice((page - 1) * itemsPerPage, page * itemsPerPage);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin mb-4 text-primary" />
                <p>Loading Price Book...</p>
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground border border-dashed border-border rounded-lg bg-muted/20">
                <p>No items found.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="bg-card border border-border rounded-lg shadow-sm">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50 backdrop-blur rounded-t-lg">
                    <span className="text-xs text-muted-foreground font-mono">Items ({items.length})</span>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={page === 1}
                            onClick={() => setPage(p => p - 1)}
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                        >
                            &lt;
                        </Button>
                        <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={page === totalPages}
                            onClick={() => setPage(p => p + 1)}
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                        >
                            &gt;
                        </Button>
                    </div>
                </div>

                <div className="relative">
                    <Table>
                        <TableHeader className="bg-card hover:bg-card sticky top-16 z-30 shadow-sm">
                            <TableRow className="border-b border-border hover:bg-transparent">
                                <TableHead className="w-[100px] text-muted-foreground text-xs uppercase tracking-wider font-semibold">Code</TableHead>
                                <TableHead className="w-[150px] text-muted-foreground text-xs uppercase tracking-wider font-semibold">Chapter</TableHead>
                                <TableHead className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Description</TableHead>
                                <TableHead className="w-[80px] text-muted-foreground text-xs uppercase tracking-wider font-semibold text-right">Unit</TableHead>
                                <TableHead className="w-[100px] text-muted-foreground text-xs uppercase tracking-wider font-semibold text-right">Price</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {paginatedItems.map((item) => (
                                <TableRow
                                    key={item.id || item.code}
                                    className="border-b border-border hover:bg-muted/30 transition-colors group"
                                >
                                    <TableCell className="font-mono text-xs text-primary font-medium py-3">
                                        <Sheet>
                                            <SheetTrigger asChild>
                                                <span className="flex items-center gap-2 cursor-pointer hover:underline underline-offset-4 w-fit">
                                                    {item.code}
                                                </span>
                                            </SheetTrigger>
                                            <SheetContent
                                                side="right"
                                                className="w-full sm:max-w-2xl lg:max-w-3xl xl:max-w-4xl bg-card border-l border-border text-foreground p-6 overflow-y-auto"
                                            >
                                                <SheetHeader className="sr-only">
                                                    <SheetTitle>Detalle de partida {item.code}</SheetTitle>
                                                    <SheetDescription>
                                                        Descompuesto y precios del catálogo COAATMCA para la partida {item.code}.
                                                    </SheetDescription>
                                                </SheetHeader>
                                                <PriceItemDetail item={item} />
                                            </SheetContent>
                                        </Sheet>
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground py-3 uppercase tracking-tight">
                                        {item.chapter ? item.chapter.substring(0, 15) : '-'}
                                    </TableCell>
                                    <TableCell className="text-sm text-foreground/80 py-3 max-w-[400px]">
                                        <div className="truncate group-hover:whitespace-normal group-hover:transition-all" title={item.description}>
                                            {item.description}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right py-3">
                                        <Badge variant="outline" className="border-border text-muted-foreground font-mono text-[10px] h-5 rounded-sm px-1.5">
                                            {item.unit}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-sm text-foreground/90 py-3 font-semibold">
                                        {new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(item.priceTotal || 0)}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </div>
        </div>
    );
}

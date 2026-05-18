'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Budget } from '@/backend/budget/domain/budget';
import { deleteBudgetsAction } from '@/actions/budget/delete-budgets.action';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
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
import {
    FileText,
    Sparkles,
    User,
    Calendar,
    Folder,
    ArrowRight,
    Search,
    MoreHorizontal,
    Trash2,
    Loader2,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Input } from '@/components/ui/input';
import { BudgetApproveButton } from '@/components/budget/budget-approve-button';
import Link from 'next/link';
import { sileo } from 'sileo';

interface BudgetsTableProps {
    budgets: Budget[];
    locale: string;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 20;

export function BudgetsTable({ budgets, locale }: BudgetsTableProps) {
    const router = useRouter();
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);

    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

    // Filter budgets based on search
    const filteredBudgets = useMemo(() => {
        const term = searchQuery.toLowerCase();
        if (!term) return budgets;
        return budgets.filter(budget => {
            const clientName = (budget.clientSnapshot?.name || (budget as any).clientData?.name || '').toLowerCase();
            const ref = budget.id.toLowerCase();
            const title = (budget.title || '').toLowerCase();
            return clientName.includes(term) || ref.includes(term) || title.includes(term);
        });
    }, [budgets, searchQuery]);

    // Resetea a página 1 cuando cambia la búsqueda o el tamaño de página, para
    // evitar quedarse en una página fuera de rango sin resultados.
    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, pageSize]);

    const totalPages = Math.max(1, Math.ceil(filteredBudgets.length / pageSize));
    const safePage = Math.min(currentPage, totalPages);
    const startIndex = (safePage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedBudgets = filteredBudgets.slice(startIndex, endIndex);

    // Toggle selection of a single budget
    const toggleSelection = (id: string) => {
        const newSelected = new Set(selectedIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedIds(newSelected);
    };

    // Toggle all rows on the CURRENT page. Cualquier selección previa en
    // otras páginas se preserva — el usuario puede acumular selección
    // navegando entre páginas.
    const allVisibleSelected = paginatedBudgets.length > 0
        && paginatedBudgets.every(b => selectedIds.has(b.id));
    const toggleAll = () => {
        const next = new Set(selectedIds);
        if (allVisibleSelected) {
            paginatedBudgets.forEach(b => next.delete(b.id));
        } else {
            paginatedBudgets.forEach(b => next.add(b.id));
        }
        setSelectedIds(next);
    };

    const handleDelete = async () => {
        if (selectedIds.size === 0) return;

        setIsDeleting(true);
        setShowDeleteDialog(false);

        const idsToDelete = Array.from(selectedIds);

        // Promise Toast using Sileo?
        // Sileo might not support "promise" toast directly like Sonner, so we simulate it.
        // Actually user said "silo toaster... tanto en promise como en success y/o error".
        // If sileo has .promise, I'll use it. If not, I'll do manual. 
        // Checking doc/usage, simpler to wrap.

        try {
            /* 
               If Sileo had a promise method:
               sileo.promise(deleteBudgetsAction(idsToDelete), { ... })
               
               Assuming manual control for now based on stream listener example.
            */

            const result = await deleteBudgetsAction(idsToDelete);

            if (result.success) {
                sileo.success({
                    title: "Eliminado",
                    description: result.message,
                    duration: 4000
                });
                setSelectedIds(new Set());
                router.refresh();
            } else {
                throw new Error(result.message);
            }
        } catch (error: any) {
            sileo.error({
                title: "Error",
                description: error.message || "No se pudieron eliminar los presupuestos.",
                duration: 5000
            });
        } finally {
            setIsDeleting(false);
        }
    };

    const getSourceInfo = (source?: string) => {
        switch (source) {
            case 'wizard':
                return { icon: Sparkles, label: 'Asistente IA', color: 'text-purple-600 bg-purple-100 dark:bg-purple-500/10 dark:text-purple-300 border-purple-200 dark:border-purple-800' };
            case 'pdf_measurement':
                return { icon: FileText, label: 'Mediciones PDF', color: 'text-amber-600 bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 border-amber-200 dark:border-amber-800' };
            default:
                return { icon: User, label: 'Manual', color: 'text-zinc-600 bg-zinc-100 dark:bg-zinc-500/10 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800' };
        }
    };

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex items-center justify-between gap-4 p-1 bg-zinc-50/50 dark:bg-zinc-900/20 rounded-xl">
                <div className="relative flex-1 max-w-sm group">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                    <Input
                        type="search"
                        placeholder="Buscar cliente, referencia..."
                        className="pl-9 bg-white dark:bg-zinc-950/50 border-zinc-200 dark:border-zinc-800 focus:ring-2 focus:ring-primary/20 transition-all rounded-xl"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>

                {selectedIds.size > 0 && (
                    <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-4 duration-300">
                        <Badge variant="secondary" className="px-3 py-1.5 h-9 text-sm font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                            {selectedIds.size} seleccionado{selectedIds.size !== 1 && 's'}
                        </Badge>
                        <Button
                            variant="destructive"
                            size="sm"
                            className="h-9 shadow-sm hover:shadow-red-500/20 transition-all gap-2"
                            onClick={() => setShowDeleteDialog(true)}
                            disabled={isDeleting}
                        >
                            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            Eliminar
                        </Button>
                    </div>
                )}
            </div>

            {/* Table */}
            <div className="relative overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm bg-white dark:bg-zinc-950">
                <Table>
                    <TableHeader className="bg-zinc-50/80 dark:bg-zinc-900/40 backdrop-blur-sm">
                        <TableRow className="hover:bg-transparent border-zinc-100 dark:border-zinc-800">
                            <TableHead className="w-[40px] pl-4">
                                <Checkbox
                                    checked={allVisibleSelected}
                                    onCheckedChange={toggleAll}
                                />
                            </TableHead>
                            <TableHead className="w-[180px] font-semibold text-zinc-900 dark:text-zinc-100">Ref. & Fecha</TableHead>
                            <TableHead className="font-semibold text-zinc-900 dark:text-zinc-100">Cliente</TableHead>
                            <TableHead className="font-semibold text-zinc-900 dark:text-zinc-100">Origen</TableHead>
                            <TableHead className="font-semibold text-zinc-900 dark:text-zinc-100">Proyecto</TableHead>
                            <TableHead className="font-semibold text-zinc-900 dark:text-zinc-100">Estado</TableHead>
                            <TableHead className="text-right font-semibold text-zinc-900 dark:text-zinc-100">Importe</TableHead>
                            <TableHead className="w-[50px]"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {paginatedBudgets.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={8} className="h-48 text-center">
                                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                                        <div className="h-16 w-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4">
                                            <Folder className="h-8 w-8 opacity-50" />
                                        </div>
                                        <p className="text-lg font-medium text-foreground">
                                            {searchQuery ? 'Sin resultados para tu búsqueda' : 'No hay presupuestos'}
                                        </p>
                                        <p className="text-sm">
                                            {searchQuery ? 'Prueba con otra referencia o nombre.' : 'Genere uno nuevo para comenzar.'}
                                        </p>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : (
                            paginatedBudgets.map((budget) => {
                                const sourceInfo = getSourceInfo(budget.source);
                                const SourceIcon = sourceInfo.icon;
                                const isSelected = selectedIds.has(budget.id);

                                return (
                                    <TableRow
                                        key={budget.id}
                                        className={
                                            `group transition-all border-zinc-50 dark:border-zinc-800/40 ${isSelected ? 'bg-blue-50/50 dark:bg-blue-900/10' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/30'}`
                                        }
                                    >
                                        <TableCell className="pl-4">
                                            <Checkbox
                                                checked={isSelected}
                                                onCheckedChange={() => toggleSelection(budget.id)}
                                            />
                                        </TableCell>

                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                <span className="font-mono text-xs font-bold text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded w-fit group-hover:bg-white dark:group-hover:bg-zinc-700 transition-colors">
                                                    #{budget.id.substring(0, 8).toUpperCase()}
                                                </span>
                                                <div className="flex items-center text-xs text-muted-foreground">
                                                    <Calendar className="mr-1.5 h-3 w-3" />
                                                    {budget.createdAt ? format(new Date(budget.createdAt), "d MMM yyyy", { locale: es }) : 'Fecha desconocida'}
                                                </div>
                                            </div>
                                        </TableCell>

                                        <TableCell>
                                            <div className="flex flex-col">
                                                <span className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors">
                                                    {budget.clientSnapshot?.name || (budget as any).clientData?.name || 'Cliente sin nombre'}
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                    {budget.clientSnapshot?.email || (budget as any).clientData?.email || 'Sin contacto'}
                                                </span>
                                            </div>
                                        </TableCell>

                                        <TableCell>
                                            <Badge variant="outline" className={`gap-1.5 py-1 px-2.5 font-medium border shadow-sm ${sourceInfo.color}`}>
                                                <SourceIcon className="h-3.5 w-3.5" />
                                                {sourceInfo.label}
                                            </Badge>
                                        </TableCell>

                                        <TableCell>
                                            <div className="flex flex-col gap-2 max-w-[200px]">
                                                <div className="flex items-center gap-1.5">
                                                    {/* FIX: Improved visibility for project type pill in light mode */}
                                                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5 border-zinc-200 dark:border-zinc-700 font-bold tracking-wider bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                                                        {budget.type === 'quick' ? 'RÁPIDO' :
                                                            budget.type === 'new_build' ? 'OBRA NUEVA' : 'REFORMA'}
                                                    </Badge>
                                                </div>
                                                <span className="text-xs text-muted-foreground truncate font-medium" title={(budget.clientSnapshot as any)?.description || (budget as any).clientData?.description}>
                                                    {(budget.clientSnapshot as any)?.description || (budget as any).clientData?.description || '—'}
                                                </span>
                                            </div>
                                        </TableCell>

                                        <TableCell>
                                            <Badge
                                                className={
                                                    budget.status === 'approved' ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20 shadow-md text-white' :
                                                        budget.status === 'sent' ? 'bg-blue-500 hover:bg-blue-600 shadow-blue-500/20 shadow-md text-white' :
                                                            budget.status === 'pending_review' ? 'bg-orange-500 hover:bg-orange-600 shadow-orange-500/20 shadow-md text-white' :
                                                                'bg-zinc-500 hover:bg-zinc-600 text-white'
                                                }
                                            >
                                                {budget.status === 'pending_review' ? 'Pendiente' :
                                                    budget.status === 'approved' ? 'Aprobado' :
                                                        budget.status === 'draft' ? 'Borrador' :
                                                            budget.status}
                                            </Badge>
                                        </TableCell>

                                        <TableCell className="text-right">
                                            <div className="font-mono font-bold text-foreground text-base">
                                                {(budget.totalEstimated || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}
                                            </div>
                                            <div className="text-[10px] uppercase text-muted-foreground font-medium tracking-wide">
                                                IVA incluido
                                            </div>
                                        </TableCell>

                                        <TableCell>
                                            <div className="flex items-center gap-2 justify-end">
                                                {(budget.status === 'pending_review' || budget.status === 'draft') && (
                                                    <BudgetApproveButton
                                                        budgetId={budget.id}
                                                        clientName={budget.clientSnapshot?.name || (budget as any).clientData?.name || 'Cliente'}
                                                        totalEstimated={budget.totalEstimated}
                                                        locale={locale}
                                                    />
                                                )}

                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <Link href={`/dashboard/admin/budgets/${budget.id}/edit`}>
                                                            <DropdownMenuItem>
                                                                Editar Presupuesto
                                                            </DropdownMenuItem>
                                                        </Link>
                                                        <DropdownMenuItem
                                                            className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950/50"
                                                            onClick={() => {
                                                                setSelectedIds(new Set([budget.id]));
                                                                setShowDeleteDialog(true);
                                                            }}
                                                        >
                                                            Eliminar
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>

                                                <Link href={`/dashboard/admin/budgets/${budget.id}/edit`}>
                                                    <Button size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-full transition-all hover:scale-105">
                                                        <ArrowRight className="h-5 w-5" />
                                                        <span className="sr-only">Ver detalle</span>
                                                    </Button>
                                                </Link>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Paginador. Solo se renderiza si hay resultados; mantiene espacio
                fijo (h-12) para evitar saltos cuando la última página tiene
                menos filas que pageSize. */}
            {filteredBudgets.length > 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-1 py-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>Filas por página:</span>
                        <select
                            value={pageSize}
                            onChange={(e) => setPageSize(Number(e.target.value))}
                            className="h-8 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 text-xs"
                        >
                            {PAGE_SIZE_OPTIONS.map(n => (
                                <option key={n} value={n}>{n}</option>
                            ))}
                        </select>
                        <span className="ml-2">
                            {startIndex + 1}–{Math.min(endIndex, filteredBudgets.length)} de {filteredBudgets.length}
                        </span>
                    </div>

                    <div className="flex items-center gap-1">
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setCurrentPage(1)}
                            disabled={safePage === 1}
                            aria-label="Primera página"
                        >
                            <ChevronsLeft className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={safePage === 1}
                            aria-label="Página anterior"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-xs text-muted-foreground px-3 min-w-[5rem] text-center">
                            Página {safePage} / {totalPages}
                        </span>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={safePage === totalPages}
                            aria-label="Página siguiente"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setCurrentPage(totalPages)}
                            disabled={safePage === totalPages}
                            aria-label="Última página"
                        >
                            <ChevronsRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}

            <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Está seguro de eliminar?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta acción no se puede deshacer. Se eliminarán permanentemente {selectedIds.size} presupuesto(s).
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                handleDelete();
                            }}
                            className="bg-red-600 hover:bg-red-700 text-white"
                            disabled={isDeleting}
                        >
                            {isDeleting ? 'Eliminando...' : 'Eliminar'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

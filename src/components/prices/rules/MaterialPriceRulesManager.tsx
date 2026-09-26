'use client';

/**
 * Panel gestor de reglas de ajuste de precio de materiales (TAREA 2).
 * Lista todas las reglas y permite crear / editar / activar-desactivar / borrar,
 * con previsualización de impacto dentro del diálogo de alta/edición.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Loader2, Plus, Pencil, Trash2, RefreshCw, SlidersHorizontal, Info, ChevronDown } from 'lucide-react';
import type { MaterialPriceRule } from '@/backend/material-catalog/domain/material-price-rule';
import { MaterialRuleDialog, type RuleInput } from './MaterialRuleDialog';
import { formatSignedPct } from './PriceCells';
import { listMaterialPriceRulesAction } from '@/actions/material-catalog/list-material-price-rules.action';
import { toggleMaterialPriceRuleAction } from '@/actions/material-catalog/toggle-material-price-rule.action';
import { deleteMaterialPriceRuleAction } from '@/actions/material-catalog/delete-material-price-rule.action';

const SCOPE_LABEL: Record<MaterialPriceRule['scope'], string> = {
    global: 'Global',
    category: 'Categoría',
    material: 'Material',
    client: 'Cliente',
    budget: 'Presupuesto',
};

const SCOPE_BADGE: Record<MaterialPriceRule['scope'], string> = {
    global: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    category: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    material: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
    client: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
    budget: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
};

function targetLabel(rule: MaterialPriceRule): string {
    switch (rule.scope) {
        case 'category':
            return rule.target.category || '—';
        case 'material':
            return rule.target.sku || '—';
        case 'client':
            return rule.target.leadId || '—';
        case 'budget':
            return rule.target.budgetId || '—';
        default:
            return 'Todo el catálogo';
    }
}

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
        return iso;
    }
}

export interface MaterialPriceRulesManagerProps {
    categorySuggestions?: string[];
    /** Se dispara tras cualquier mutación, por si el padre quiere refrescar precios. */
    onRulesChanged?: () => void;
}

export function MaterialPriceRulesManager({ categorySuggestions = [], onRulesChanged }: MaterialPriceRulesManagerProps) {
    const { toast } = useToast();
    const [rules, setRules] = useState<MaterialPriceRule[]>([]);
    const [loading, setLoading] = useState(false);
    const [scopeFilter, setScopeFilter] = useState<'all' | MaterialPriceRule['scope']>('all');
    const [togglingId, setTogglingId] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<MaterialPriceRule | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);

    const [dialog, setDialog] = useState<{ open: boolean; mode: 'create' | 'edit'; editingId?: string; initial?: Partial<RuleInput> }>(
        { open: false, mode: 'create' },
    );

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await listMaterialPriceRulesAction();
            if (res.success) {
                setRules(res.rules);
            } else {
                toast({ variant: 'destructive', title: 'No se pudieron cargar las reglas', description: res.error });
            }
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        void load();
    }, [load]);

    const afterMutation = useCallback(() => {
        void load();
        onRulesChanged?.();
    }, [load, onRulesChanged]);

    const filtered = useMemo(
        () => (scopeFilter === 'all' ? rules : rules.filter((r) => r.scope === scopeFilter)),
        [rules, scopeFilter],
    );

    const sorted = useMemo(
        () => [...filtered].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')),
        [filtered],
    );

    const handleToggle = async (rule: MaterialPriceRule, next: boolean) => {
        setTogglingId(rule.id);
        try {
            const res = await toggleMaterialPriceRuleAction(rule.id, next);
            if (res.success) {
                setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, active: next } : r)));
                onRulesChanged?.();
            } else {
                toast({ variant: 'destructive', title: 'No se pudo cambiar el estado', description: res.error });
            }
        } finally {
            setTogglingId(null);
        }
    };

    const handleDelete = async () => {
        if (!deleting) return;
        setDeleteBusy(true);
        try {
            const res = await deleteMaterialPriceRuleAction(deleting.id);
            if (res.success) {
                toast({ title: 'Regla borrada' });
                setDeleting(null);
                afterMutation();
            } else {
                toast({ variant: 'destructive', title: 'No se pudo borrar', description: res.error });
            }
        } finally {
            setDeleteBusy(false);
        }
    };

    const openEdit = (rule: MaterialPriceRule) => {
        setDialog({
            open: true,
            mode: 'edit',
            editingId: rule.id,
            initial: {
                scope: rule.scope,
                target: rule.target,
                adjustmentPct: rule.adjustmentPct,
                note: rule.note,
                active: rule.active,
            },
        });
    };

    return (
        <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
                <CardTitle className="flex items-center gap-2 text-lg font-medium">
                    <SlidersHorizontal className="h-5 w-5 text-orange-600" />
                    Reglas de ajuste de precio
                    <Badge variant="secondary">{rules.length}</Badge>
                </CardTitle>
                <div className="flex items-center gap-2">
                    <Select value={scopeFilter} onValueChange={(v) => setScopeFilter(v as typeof scopeFilter)}>
                        <SelectTrigger className="h-9 w-[160px]">
                            <SelectValue placeholder="Filtrar alcance" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos los alcances</SelectItem>
                            {(Object.keys(SCOPE_LABEL) as MaterialPriceRule['scope'][]).map((s) => (
                                <SelectItem key={s} value={s}>
                                    {SCOPE_LABEL[s]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" onClick={load} disabled={loading} title="Recargar">
                        <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                    </Button>
                    <Button onClick={() => setDialog({ open: true, mode: 'create' })}>
                        <Plus className="mr-2 h-4 w-4" /> Nueva regla
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                {/* Banner explicativo — cómo funcionan las reglas de precio de material */}
                <Collapsible defaultOpen className="mb-4">
                    <div className="rounded-lg border border-blue-200 bg-blue-50/60 dark:border-blue-900/50 dark:bg-blue-950/30">
                        <CollapsibleTrigger className="group flex w-full items-center gap-2 px-4 py-3 text-left">
                            <Info className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                            <span className="text-sm font-medium text-blue-900 dark:text-blue-200">
                                Cómo funcionan las reglas de precio
                            </span>
                            <span className="ml-auto hidden text-xs text-blue-700/80 dark:text-blue-300/80 sm:inline">
                                Ajustan el % sin tocar el precio base del catálogo
                            </span>
                            <ChevronDown className="h-4 w-4 shrink-0 text-blue-600 transition-transform group-data-[state=closed]:-rotate-90 dark:text-blue-400" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <div className="space-y-3 px-4 pb-4 pt-1 text-sm leading-relaxed text-blue-900/90 dark:text-blue-100/90">
                                <p>
                                    Ajustan el precio de los materiales por un <strong>porcentaje</strong> (sube con{' '}
                                    <code className="rounded bg-blue-100 px-1 dark:bg-blue-900/50">+</code>, descuenta con{' '}
                                    <code className="rounded bg-blue-100 px-1 dark:bg-blue-900/50">−</code>). El{' '}
                                    <strong>precio base del catálogo nunca se modifica</strong>: el ajuste se calcula al vuelo.
                                </p>
                                <div>
                                    <p className="font-medium">Alcances (de más general a más específico):</p>
                                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                                        <li><strong>Global</strong> — todos los materiales del catálogo.</li>
                                        <li><strong>Categoría</strong> — los materiales de una categoría (y sus subcategorías).</li>
                                        <li><strong>Material</strong> — un material concreto (por SKU/referencia).</li>
                                        <li><strong>Cliente</strong> — los presupuestos de un cliente concreto.</li>
                                        <li><strong>Presupuesto</strong> — un presupuesto concreto.</li>
                                    </ul>
                                </div>
                                <p>
                                    <strong>Precedencia — gana la más específica:</strong> Presupuesto › Cliente › Material › Categoría ›
                                    Global. Si a un material le aplican varias reglas, solo se aplica <strong>una</strong>: la más
                                    específica que exista.
                                </p>
                                <p>
                                    <strong>Cuándo se aplica:</strong> en presupuestos <strong>nuevos</strong> y al re-tasar en el editor.
                                    Los presupuestos ya guardados <strong>no</strong> se recalculan (conservan su precio). Puedes{' '}
                                    <strong>desactivar</strong> una regla sin borrarla.
                                </p>
                            </div>
                        </CollapsibleContent>
                    </div>
                </Collapsible>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Alcance</TableHead>
                                <TableHead>Objetivo</TableHead>
                                <TableHead className="text-right">Ajuste</TableHead>
                                <TableHead className="text-center">Activa</TableHead>
                                <TableHead>Nota</TableHead>
                                <TableHead>Auditoría</TableHead>
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sorted.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                                        {loading ? 'Cargando…' : 'No hay reglas todavía. Crea la primera con "Nueva regla".'}
                                    </TableCell>
                                </TableRow>
                            ) : (
                                sorted.map((rule) => (
                                    <TableRow key={rule.id} className={cn(!rule.active && 'opacity-60')}>
                                        <TableCell>
                                            <Badge className={cn('font-medium', SCOPE_BADGE[rule.scope])}>
                                                {SCOPE_LABEL[rule.scope]}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="max-w-[220px] truncate font-mono text-xs" title={targetLabel(rule)}>
                                            {targetLabel(rule)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <span
                                                className={cn(
                                                    'font-mono font-semibold',
                                                    rule.adjustmentPct < 0
                                                        ? 'text-emerald-600 dark:text-emerald-400'
                                                        : 'text-amber-600 dark:text-amber-400',
                                                )}
                                            >
                                                {formatSignedPct(rule.adjustmentPct)}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            {togglingId === rule.id ? (
                                                <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                                            ) : (
                                                <Switch checked={rule.active} onCheckedChange={(v) => handleToggle(rule, v)} />
                                            )}
                                        </TableCell>
                                        <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground" title={rule.note}>
                                            {rule.note || '—'}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            <div className="truncate max-w-[160px]" title={rule.updatedBy}>
                                                {rule.updatedBy}
                                            </div>
                                            <div>{formatDate(rule.updatedAt)}</div>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-1">
                                                <Button variant="ghost" size="icon" onClick={() => openEdit(rule)} title="Editar">
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="text-destructive hover:text-destructive"
                                                    onClick={() => setDeleting(rule)}
                                                    title="Borrar"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>

            <MaterialRuleDialog
                open={dialog.open}
                onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
                mode={dialog.mode}
                editingId={dialog.editingId}
                initial={dialog.initial}
                categorySuggestions={categorySuggestions}
                onSaved={afterMutation}
            />

            <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Borrar esta regla?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {deleting && (
                                <>
                                    Se eliminará la regla de <strong>{SCOPE_LABEL[deleting.scope]}</strong> (
                                    {formatSignedPct(deleting.adjustmentPct)}). Esta acción no se puede deshacer.
                                </>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleteBusy}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                void handleDelete();
                            }}
                            disabled={deleteBusy}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {deleteBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Borrar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}

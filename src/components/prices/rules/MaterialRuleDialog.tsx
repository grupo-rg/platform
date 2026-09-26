'use client';

/**
 * Diálogo de creación / edición de una regla de ajuste de precio de materiales,
 * con previsualización de impacto (dry-run) antes de guardar.
 *
 * Reutilizable para:
 *   - Alta genérica (mode='create', sin preset).
 *   - Edición (mode='edit' + editingId + initial con los valores actuales).
 *   - Acciones rápidas con scope fijo (lockScope + initial con el target).
 *
 * NO importa nada de `_shared` (arrastra código server-only). El tipo de input
 * se deriva estructuralmente del dominio, que es un módulo puro.
 */

import { useEffect, useMemo, useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency, cn } from '@/lib/utils';
import { Loader2, Eye, Save, AlertTriangle } from 'lucide-react';
import type { MaterialPriceRule } from '@/backend/material-catalog/domain/material-price-rule';
import { LeadCombobox } from './LeadCombobox';
import { createMaterialPriceRuleAction } from '@/actions/material-catalog/create-material-price-rule.action';
import { updateMaterialPriceRuleAction } from '@/actions/material-catalog/update-material-price-rule.action';
import { previewMaterialPriceRuleAction } from '@/actions/material-catalog/preview-material-price-rule.action';

type RuleScope = MaterialPriceRule['scope'];
type RuleTarget = MaterialPriceRule['target'];

/** Estructura compatible con `MaterialPriceRuleInput` (validado en el server). */
export interface RuleInput {
    scope: RuleScope;
    target: RuleTarget;
    adjustmentPct: number;
    active?: boolean;
    note?: string;
}

type PreviewResponse = Awaited<ReturnType<typeof previewMaterialPriceRuleAction>>;

const SCOPE_LABELS: Record<RuleScope, string> = {
    global: 'Global (todo el catálogo)',
    category: 'Categoría',
    material: 'Material (SKU)',
    client: 'Cliente',
    budget: 'Presupuesto',
};

export interface MaterialRuleDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    mode: 'create' | 'edit';
    editingId?: string;
    initial?: Partial<RuleInput> & { leadLabel?: string };
    /** Bloquea el selector de scope (acciones rápidas con scope fijo). */
    lockScope?: boolean;
    /** Sugerencias de categorías (nivel padre) para autocompletar el target. */
    categorySuggestions?: string[];
    onSaved?: () => void;
}

function scopeTargetErrorClient(scope: RuleScope, target: RuleTarget): string | null {
    switch (scope) {
        case 'global':
            return null;
        case 'category':
            return target.category?.trim() ? null : 'Indica la categoría objetivo.';
        case 'material':
            return target.sku?.trim() ? null : 'Indica el SKU del material.';
        case 'client':
            return target.leadId?.trim() ? null : 'Selecciona el cliente.';
        case 'budget':
            return target.budgetId?.trim() ? null : 'Indica el id del presupuesto.';
        default:
            return 'Scope inválido.';
    }
}

export function MaterialRuleDialog({
    open,
    onOpenChange,
    mode,
    editingId,
    initial,
    lockScope,
    categorySuggestions = [],
    onSaved,
}: MaterialRuleDialogProps) {
    const { toast } = useToast();

    const [scope, setScope] = useState<RuleScope>('global');
    const [category, setCategory] = useState('');
    const [sku, setSku] = useState('');
    const [leadId, setLeadId] = useState('');
    const [leadLabel, setLeadLabel] = useState('');
    const [budgetId, setBudgetId] = useState('');
    const [pctStr, setPctStr] = useState('0');
    const [note, setNote] = useState('');
    const [active, setActive] = useState(true);

    const [saving, setSaving] = useState(false);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [preview, setPreview] = useState<PreviewResponse | null>(null);

    // (Re)inicializa el formulario cada vez que se abre.
    useEffect(() => {
        if (!open) return;
        setScope(initial?.scope ?? 'global');
        setCategory(initial?.target?.category ?? '');
        setSku(initial?.target?.sku ?? '');
        setLeadId(initial?.target?.leadId ?? '');
        setLeadLabel(initial?.leadLabel ?? '');
        setBudgetId(initial?.target?.budgetId ?? '');
        setPctStr(initial?.adjustmentPct !== undefined ? String(initial.adjustmentPct) : '0');
        setNote(initial?.note ?? '');
        setActive(initial?.active ?? true);
        setPreview(null);
        setPreviewLoading(false);
        setSaving(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const pct = useMemo(() => {
        const n = Number.parseFloat(pctStr.replace(',', '.'));
        return Number.isFinite(n) ? n : NaN;
    }, [pctStr]);

    const target = useMemo<RuleTarget>(() => {
        switch (scope) {
            case 'category':
                return { category: category.trim() };
            case 'material':
                return { sku: sku.trim() };
            case 'client':
                return { leadId: leadId.trim() };
            case 'budget':
                return { budgetId: budgetId.trim() };
            default:
                return {};
        }
    }, [scope, category, sku, leadId, budgetId]);

    const targetError = scopeTargetErrorClient(scope, target);
    const pctError = Number.isFinite(pct) ? null : 'Introduce un porcentaje numérico.';
    const canSubmit = !targetError && !pctError && !saving;

    const factor = Number.isFinite(pct) ? 1 + pct / 100 : 1;
    const exampleBase = 100;
    const exampleEffective = Math.round(exampleBase * factor * 100) / 100;

    const buildSpec = (): RuleInput => ({
        scope,
        target,
        adjustmentPct: pct,
        note: note.trim() || undefined,
        active,
    });

    const handlePreview = async () => {
        if (targetError || pctError) {
            toast({ variant: 'destructive', title: 'Revisa los campos', description: targetError || pctError || '' });
            return;
        }
        setPreviewLoading(true);
        setPreview(null);
        try {
            const res = await previewMaterialPriceRuleAction(buildSpec());
            setPreview(res);
            if (!res.success) {
                toast({ variant: 'destructive', title: 'No se pudo previsualizar', description: res.error });
            }
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error de previsualización', description: e?.message || '' });
        } finally {
            setPreviewLoading(false);
        }
    };

    const handleSave = async () => {
        if (targetError || pctError) {
            toast({ variant: 'destructive', title: 'Revisa los campos', description: targetError || pctError || '' });
            return;
        }
        setSaving(true);
        try {
            const spec = buildSpec();
            const res =
                mode === 'edit' && editingId
                    ? await updateMaterialPriceRuleAction(editingId, spec)
                    : await createMaterialPriceRuleAction(spec);

            if (res.success) {
                toast({
                    title: mode === 'edit' ? 'Regla actualizada' : 'Regla creada',
                    description: `${SCOPE_LABELS[scope]} · ${pct > 0 ? '+' : ''}${pct} %`,
                });
                onOpenChange(false);
                onSaved?.();
            } else {
                toast({ variant: 'destructive', title: 'No se pudo guardar', description: res.error });
            }
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error al guardar', description: e?.message || '' });
        } finally {
            setSaving(false);
        }
    };

    const datalistId = 'material-rule-category-suggestions';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{mode === 'edit' ? 'Editar regla de precio' : 'Nueva regla de precio'}</DialogTitle>
                    <DialogDescription>
                        Ajusta el precio de los materiales por porcentaje. Gana siempre la regla más específica
                        (presupuesto &gt; cliente &gt; material &gt; categoría &gt; global).
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Scope */}
                    <div className="space-y-2">
                        <Label>Alcance</Label>
                        <Select value={scope} onValueChange={(v) => setScope(v as RuleScope)} disabled={lockScope}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {(Object.keys(SCOPE_LABELS) as RuleScope[]).map((s) => (
                                    <SelectItem key={s} value={s}>
                                        {SCOPE_LABELS[s]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Target según scope */}
                    {scope === 'category' && (
                        <div className="space-y-2">
                            <Label>Categoría objetivo</Label>
                            <Input
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                placeholder="Ej. 'Fontanería' o 'Fontanería > Tubos'"
                                list={datalistId}
                            />
                            <datalist id={datalistId}>
                                {categorySuggestions.map((c) => (
                                    <option key={c} value={c} />
                                ))}
                            </datalist>
                            <p className="text-xs text-muted-foreground">
                                Coincide con la categoría exacta y con todas sus subcategorías (descendientes).
                            </p>
                        </div>
                    )}

                    {scope === 'material' && (
                        <div className="space-y-2">
                            <Label>SKU del material</Label>
                            <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Ej. '104562'" />
                        </div>
                    )}

                    {scope === 'client' && (
                        <div className="space-y-2">
                            <Label>Cliente</Label>
                            <LeadCombobox
                                value={leadId}
                                valueLabel={leadLabel}
                                onChange={(id, label) => {
                                    setLeadId(id);
                                    setLeadLabel(label);
                                }}
                            />
                        </div>
                    )}

                    {scope === 'budget' && (
                        <div className="space-y-2">
                            <Label>Id de presupuesto</Label>
                            <Input
                                value={budgetId}
                                onChange={(e) => setBudgetId(e.target.value)}
                                placeholder="Id del documento de presupuesto"
                            />
                        </div>
                    )}

                    {/* Ajuste porcentual */}
                    <div className="space-y-2">
                        <Label>Ajuste porcentual</Label>
                        <div className="flex items-center gap-2">
                            <div className="flex rounded-md border">
                                <Button
                                    type="button"
                                    variant={Number.isFinite(pct) && pct < 0 ? 'default' : 'ghost'}
                                    size="sm"
                                    className="rounded-r-none"
                                    onClick={() => setPctStr(String(-Math.abs(Number.isFinite(pct) ? pct : 0) || -0))}
                                >
                                    Descuento −
                                </Button>
                                <Button
                                    type="button"
                                    variant={Number.isFinite(pct) && pct > 0 ? 'default' : 'ghost'}
                                    size="sm"
                                    className="rounded-l-none"
                                    onClick={() => setPctStr(String(Math.abs(Number.isFinite(pct) ? pct : 0)))}
                                >
                                    Recargo +
                                </Button>
                            </div>
                            <div className="relative flex-1">
                                <Input
                                    type="number"
                                    step="0.5"
                                    value={pctStr}
                                    onChange={(e) => setPctStr(e.target.value)}
                                    className="pr-7"
                                />
                                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                    %
                                </span>
                            </div>
                        </div>
                        {pctError ? (
                            <p className="text-xs text-destructive">{pctError}</p>
                        ) : (
                            <p className="text-xs text-muted-foreground">
                                Factor ×{factor.toFixed(4)} · ejemplo: {formatCurrency(exampleBase)} →{' '}
                                <span className="font-medium">{formatCurrency(exampleEffective)}</span>
                            </p>
                        )}
                    </div>

                    {/* Nota */}
                    <div className="space-y-2">
                        <Label>Nota (opcional)</Label>
                        <Textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Motivo del ajuste, vigencia, etc."
                            rows={2}
                        />
                    </div>

                    {/* Activa */}
                    <div className="flex items-center justify-between rounded-md border p-3">
                        <div>
                            <Label className="cursor-pointer">Regla activa</Label>
                            <p className="text-xs text-muted-foreground">
                                Solo las reglas activas se aplican al calcular precios.
                            </p>
                        </div>
                        <Switch checked={active} onCheckedChange={setActive} />
                    </div>

                    {targetError && (
                        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                            <AlertTriangle className="h-4 w-4 shrink-0" />
                            {targetError}
                        </div>
                    )}

                    {/* Preview */}
                    <div className="space-y-2 rounded-md border p-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Previsualización de impacto</span>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={handlePreview}
                                disabled={previewLoading || !!targetError || !!pctError}
                            >
                                {previewLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
                                Previsualizar
                            </Button>
                        </div>

                        {preview && preview.success && (
                            <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2 text-sm">
                                    <Badge variant="secondary">
                                        {preview.affectedCountEstimate.toLocaleString('es-ES')} materiales
                                    </Badge>
                                    {preview.estimated && (
                                        <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
                                            estimado
                                        </Badge>
                                    )}
                                    <span className="text-xs text-muted-foreground">
                                        muestra de {preview.sampleSize}
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground">{preview.note}</p>
                                {preview.sample.length > 0 && (
                                    <ScrollArea className="max-h-52 rounded-md border">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Material</TableHead>
                                                    <TableHead className="text-right">Base</TableHead>
                                                    <TableHead className="text-right">Efectivo</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {preview.sample.map((row) => (
                                                    <TableRow key={row.sku}>
                                                        <TableCell>
                                                            <div className="font-medium text-xs">{row.name}</div>
                                                            <div className="font-mono text-[10px] text-muted-foreground">{row.sku}</div>
                                                        </TableCell>
                                                        <TableCell className="text-right font-mono text-xs text-muted-foreground line-through">
                                                            {formatCurrency(row.basePrice)}
                                                        </TableCell>
                                                        <TableCell
                                                            className={cn(
                                                                'text-right font-mono text-xs font-semibold',
                                                                row.effectivePrice < row.basePrice
                                                                    ? 'text-emerald-600 dark:text-emerald-400'
                                                                    : 'text-amber-600 dark:text-amber-400',
                                                            )}
                                                        >
                                                            {formatCurrency(row.effectivePrice)}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </ScrollArea>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                        Cancelar
                    </Button>
                    <Button onClick={handleSave} disabled={!canSubmit}>
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        {mode === 'edit' ? 'Guardar cambios' : 'Crear regla'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

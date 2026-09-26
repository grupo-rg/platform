'use client';

/**
 * Sección "por cliente" (TAREA 3): alta rápida de una regla de scope `client`
 * (selector de lead + % + nota) y listado de las reglas de cliente existentes.
 *
 * Reutiliza `LeadCombobox` para elegir el cliente y `createMaterialPriceRuleAction`
 * para el alta. La edición avanzada abre `MaterialRuleDialog`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Loader2, UserPlus, Pencil, Trash2 } from 'lucide-react';
import type { MaterialPriceRule } from '@/backend/material-catalog/domain/material-price-rule';
import { LeadCombobox } from './LeadCombobox';
import { MaterialRuleDialog, type RuleInput } from './MaterialRuleDialog';
import { formatSignedPct } from './PriceCells';
import { createMaterialPriceRuleAction } from '@/actions/material-catalog/create-material-price-rule.action';
import { listMaterialPriceRulesAction } from '@/actions/material-catalog/list-material-price-rules.action';
import { toggleMaterialPriceRuleAction } from '@/actions/material-catalog/toggle-material-price-rule.action';
import { deleteMaterialPriceRuleAction } from '@/actions/material-catalog/delete-material-price-rule.action';
import { listLeadsForSelectorAction } from '@/actions/lead/list-leads-for-selector.action';

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
        return iso;
    }
}

export function ClientRulesSection({ onRulesChanged }: { onRulesChanged?: () => void }) {
    const { toast } = useToast();

    const [rules, setRules] = useState<MaterialPriceRule[]>([]);
    const [leadNames, setLeadNames] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);

    // Formulario de alta rápida.
    const [leadId, setLeadId] = useState('');
    const [leadLabel, setLeadLabel] = useState('');
    const [pctStr, setPctStr] = useState('0');
    const [note, setNote] = useState('');
    const [creating, setCreating] = useState(false);

    const [togglingId, setTogglingId] = useState<string | null>(null);
    const [editing, setEditing] = useState<{ open: boolean; rule?: MaterialPriceRule }>({ open: false });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [rulesRes, leadsRes] = await Promise.all([
                listMaterialPriceRulesAction(),
                listLeadsForSelectorAction({ limit: 200 }),
            ]);
            if (rulesRes.success) {
                setRules(rulesRes.rules.filter((r) => r.scope === 'client'));
            } else {
                toast({ variant: 'destructive', title: 'No se pudieron cargar las reglas', description: rulesRes.error });
            }
            if (leadsRes.success && leadsRes.leads) {
                const map: Record<string, string> = {};
                for (const l of leadsRes.leads) map[l.id] = l.name;
                setLeadNames(map);
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

    const pct = useMemo(() => {
        const n = Number.parseFloat(pctStr.replace(',', '.'));
        return Number.isFinite(n) ? n : NaN;
    }, [pctStr]);

    const canCreate = !!leadId.trim() && Number.isFinite(pct) && !creating;

    const handleCreate = async () => {
        if (!canCreate) {
            toast({
                variant: 'destructive',
                title: 'Faltan datos',
                description: !leadId.trim() ? 'Selecciona un cliente.' : 'Introduce un porcentaje válido.',
            });
            return;
        }
        setCreating(true);
        try {
            const spec: RuleInput = {
                scope: 'client',
                target: { leadId: leadId.trim() },
                adjustmentPct: pct,
                note: note.trim() || undefined,
                active: true,
            };
            const res = await createMaterialPriceRuleAction(spec);
            if (res.success) {
                toast({ title: 'Regla de cliente creada', description: `${leadLabel || leadId} · ${formatSignedPct(pct)}` });
                setLeadId('');
                setLeadLabel('');
                setPctStr('0');
                setNote('');
                afterMutation();
            } else {
                toast({ variant: 'destructive', title: 'No se pudo crear', description: res.error });
            }
        } finally {
            setCreating(false);
        }
    };

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

    const handleDelete = async (rule: MaterialPriceRule) => {
        const res = await deleteMaterialPriceRuleAction(rule.id);
        if (res.success) {
            toast({ title: 'Regla borrada' });
            afterMutation();
        } else {
            toast({ variant: 'destructive', title: 'No se pudo borrar', description: res.error });
        }
    };

    const leadDisplay = (rule: MaterialPriceRule) => {
        const id = rule.target.leadId || '';
        return leadNames[id] || id || '—';
    };

    return (
        <div className="space-y-6">
            {/* Alta rápida */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-lg font-medium">
                        <UserPlus className="h-5 w-5 text-teal-600" />
                        Ajuste de precios por cliente
                    </CardTitle>
                    <CardDescription>
                        Crea un recargo o descuento que se aplicará a todos los materiales en los presupuestos de un
                        cliente concreto.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,2fr)_140px_auto] md:items-end">
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
                        <div className="space-y-2">
                            <Label>Ajuste %</Label>
                            <div className="relative">
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
                        <Button onClick={handleCreate} disabled={!canCreate} className="md:mb-0">
                            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                            Crear regla
                        </Button>
                    </div>
                    <div className="mt-4 space-y-2">
                        <Label>Nota (opcional)</Label>
                        <Textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Ej. 'Descuento acordado en contrato marco 2026'"
                            rows={2}
                        />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                        Negativo = descuento, positivo = recargo. Ejemplo: −5 aplica un 5 % de descuento.
                    </p>
                </CardContent>
            </Card>

            {/* Reglas de cliente existentes */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base font-medium">
                        Reglas de cliente
                        <Badge variant="secondary">{rules.length}</Badge>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Cliente</TableHead>
                                    <TableHead className="text-right">Ajuste</TableHead>
                                    <TableHead className="text-center">Activa</TableHead>
                                    <TableHead>Nota</TableHead>
                                    <TableHead>Actualizada</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rules.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                                            {loading ? 'Cargando…' : 'Aún no hay reglas por cliente.'}
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    rules.map((rule) => (
                                        <TableRow key={rule.id} className={cn(!rule.active && 'opacity-60')}>
                                            <TableCell>
                                                <div className="font-medium">{leadDisplay(rule)}</div>
                                                <div className="font-mono text-[10px] text-muted-foreground">{rule.target.leadId}</div>
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
                                            <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground" title={rule.note}>
                                                {rule.note || '—'}
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">{formatDate(rule.updatedAt)}</TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => setEditing({ open: true, rule })}
                                                        title="Editar"
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="text-destructive hover:text-destructive"
                                                        onClick={() => void handleDelete(rule)}
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
            </Card>

            <MaterialRuleDialog
                open={editing.open}
                onOpenChange={(open) => setEditing((e) => ({ ...e, open }))}
                mode="edit"
                editingId={editing.rule?.id}
                lockScope
                initial={
                    editing.rule
                        ? {
                              scope: 'client',
                              target: editing.rule.target,
                              adjustmentPct: editing.rule.adjustmentPct,
                              note: editing.rule.note,
                              active: editing.rule.active,
                              leadLabel: leadNames[editing.rule.target.leadId || ''] || undefined,
                          }
                        : undefined
                }
                onSaved={afterMutation}
            />
        </div>
    );
}

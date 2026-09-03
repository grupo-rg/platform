'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, XCircle, HelpCircle, FlaskConical, Pencil, Loader2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
    saveModelConfigAction,
    testModelAction,
    type ProbeResult,
} from '@/actions/admin/model-registry.actions';
import type { ModelConfigDoc } from '@/backend/ai/core/config/model-registry.types';

const EMBEDDING_ROLE = 'embedding';

function HealthBadge({ status }: { status: ModelConfigDoc['health']['status'] }) {
    if (status === 'ok') {
        return (
            <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white gap-1">
                <CheckCircle2 className="h-3 w-3" /> ok
            </Badge>
        );
    }
    if (status === 'failed') {
        return (
            <Badge variant="destructive" className="gap-1">
                <XCircle className="h-3 w-3" /> failed
            </Badge>
        );
    }
    return (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
            <HelpCircle className="h-3 w-3" /> unchecked
        </Badge>
    );
}

function paramsSummary(d: ModelConfigDoc): string {
    const parts: string[] = [];
    if (d.params.temperature != null) parts.push(`t=${d.params.temperature}`);
    if (d.params.maxOutputTokens != null) parts.push(`max=${d.params.maxOutputTokens}`);
    if (d.params.outputDimensionality != null) parts.push(`dim=${d.params.outputDimensionality}`);
    return parts.length ? parts.join(' · ') : '—';
}

interface EditState {
    modelId: string;
    region: string;
    pinnedVersion: string;
    temperature: string;
    maxOutputTokens: string;
    outputDimensionality: string;
    enabled: boolean;
    notes: string;
}

function toEditState(d: ModelConfigDoc): EditState {
    return {
        modelId: d.modelId,
        region: d.region,
        pinnedVersion: d.pinnedVersion ?? '',
        temperature: d.params.temperature == null ? '' : String(d.params.temperature),
        maxOutputTokens: d.params.maxOutputTokens == null ? '' : String(d.params.maxOutputTokens),
        outputDimensionality:
            d.params.outputDimensionality == null ? '' : String(d.params.outputDimensionality),
        enabled: d.enabled,
        notes: d.notes ?? '',
    };
}

function numOrNull(v: string): number | null {
    const t = v.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}

export function ModelsTable({ initialRoles }: { initialRoles: ModelConfigDoc[] }) {
    const [roles, setRoles] = useState<ModelConfigDoc[]>(initialRoles);
    const [editing, setEditing] = useState<ModelConfigDoc | null>(null);
    const [form, setForm] = useState<EditState | null>(null);
    const [probe, setProbe] = useState<ProbeResult | null>(null);
    const [isTesting, startTest] = useTransition();
    const [isSaving, startSave] = useTransition();
    const { toast } = useToast();
    const router = useRouter();

    const isEmbedding = editing?.role === EMBEDDING_ROLE;

    const openEdit = (d: ModelConfigDoc) => {
        setEditing(d);
        setForm(toEditState(d));
        setProbe(null);
    };

    const closeEdit = () => {
        setEditing(null);
        setForm(null);
        setProbe(null);
    };

    const buildInput = () => ({
        role: editing!.role,
        provider: editing!.provider,
        modelId: form!.modelId.trim(),
        pinnedVersion: form!.pinnedVersion.trim() || null,
        region: form!.region.trim() || editing!.region,
        params: {
            temperature: numOrNull(form!.temperature),
            maxOutputTokens: numOrNull(form!.maxOutputTokens),
            outputDimensionality: numOrNull(form!.outputDimensionality),
        },
        enabled: form!.enabled,
        notes: form!.notes.trim() || null,
    });

    // Quick [Test] from the table row (uses the stored config).
    const testRow = (d: ModelConfigDoc) => {
        startTest(async () => {
            const res = await testModelAction({
                role: d.role,
                provider: d.provider,
                modelId: d.modelId,
                params: { outputDimensionality: d.params.outputDimensionality },
            });
            if (!res.success) {
                toast({ variant: 'destructive', title: `Prueba: ${d.role}`, description: res.error });
                return;
            }
            const p = res.probe;
            toast({
                variant: p.ok ? 'default' : 'destructive',
                title: `Prueba: ${d.role} ${p.ok ? 'OK' : 'FALLÓ'}`,
                description: p.error || p.note || `${p.latencyMs} ms${p.dim ? ` · ${p.dim} dims` : ''}`,
            });
        });
    };

    const testInModal = () => {
        if (!editing || !form) return;
        startTest(async () => {
            const input = buildInput();
            const res = await testModelAction({
                role: input.role,
                provider: input.provider,
                modelId: input.modelId,
                params: { outputDimensionality: input.params.outputDimensionality },
            });
            if (!res.success) {
                setProbe({ ok: false, latencyMs: 0, error: res.error });
                return;
            }
            setProbe(res.probe);
        });
    };

    const save = () => {
        if (!editing || !form) return;
        startSave(async () => {
            const res = await saveModelConfigAction(buildInput());
            if (!res.success) {
                toast({
                    variant: 'destructive',
                    title:
                        res.code === 'embedding_requires_revectorization'
                            ? 'Cambio de embeddings bloqueado'
                            : 'No se guardó',
                    description: res.error,
                });
                if (res.code === 'probe_failed') {
                    setProbe({ ok: false, latencyMs: 0, error: res.error });
                }
                return;
            }
            setRoles((prev) => prev.map((r) => (r.role === res.data.role ? res.data : r)));
            toast({
                title: `Rol '${res.data.role}' actualizado`,
                description: `${res.data.modelId} · probe ${res.probe.latencyMs} ms`,
            });
            closeEdit();
            router.refresh();
        });
    };

    return (
        <>
            <Card>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Rol</TableHead>
                                    <TableHead>Proveedor</TableHead>
                                    <TableHead>modelId</TableHead>
                                    <TableHead>pinnedVersion</TableHead>
                                    <TableHead>Región</TableHead>
                                    <TableHead>Params</TableHead>
                                    <TableHead className="text-center">Activo</TableHead>
                                    <TableHead>Salud</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {roles.map((d) => (
                                    <TableRow key={d.role}>
                                        <TableCell className="font-medium whitespace-nowrap">
                                            {d.role}
                                            {d.role === EMBEDDING_ROLE && (
                                                <Badge variant="outline" className="ml-2 text-[10px]">
                                                    especial
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-xs">{d.provider}</TableCell>
                                        <TableCell className="font-mono text-xs whitespace-nowrap">
                                            {d.modelId}
                                        </TableCell>
                                        <TableCell className="font-mono text-[11px] text-muted-foreground">
                                            {d.pinnedVersion || '—'}
                                        </TableCell>
                                        <TableCell className="text-xs whitespace-nowrap">{d.region}</TableCell>
                                        <TableCell className="font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                                            {paramsSummary(d)}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <Badge
                                                variant={d.enabled ? 'default' : 'outline'}
                                                className="text-[10px]"
                                            >
                                                {d.enabled ? 'sí' : 'no'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <HealthBadge status={d.health.status} />
                                        </TableCell>
                                        <TableCell className="text-right whitespace-nowrap">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => testRow(d)}
                                                disabled={isTesting || d.provider === 'local'}
                                            >
                                                <FlaskConical className="h-3.5 w-3.5 mr-1" /> Probar
                                            </Button>
                                            <Button variant="ghost" size="sm" onClick={() => openEdit(d)}>
                                                <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <Dialog open={!!editing} onOpenChange={(o) => !o && closeEdit()}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Editar rol: {editing?.role}</DialogTitle>
                        <DialogDescription>
                            El guardado ejecuta una prueba contra el modelo antes de escribir. Si la
                            prueba falla, la configuración activa no se toca.
                        </DialogDescription>
                    </DialogHeader>

                    {editing && form && (
                        <div className="space-y-4">
                            {isEmbedding && (
                                <div className="rounded-md border border-amber-400/50 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-300 flex gap-2">
                                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                                    <span>
                                        Rol de <strong>embeddings</strong>: cambiar el modelo o la
                                        dimensionalidad invalida todos los vectores almacenados
                                        (búsqueda semántica rota en silencio). El swap de un clic está
                                        bloqueado; requiere un flujo de re-vectorización controlado
                                        (fuera de alcance aquí). Puede editar región, notas o el estado
                                        Activo.
                                    </span>
                                </div>
                            )}

                            <div className="space-y-1.5">
                                <Label htmlFor="modelId">modelId</Label>
                                <Input
                                    id="modelId"
                                    value={form.modelId}
                                    disabled={isEmbedding}
                                    onChange={(e) => setForm({ ...form, modelId: e.target.value })}
                                    className="font-mono text-sm"
                                />
                                <p className="text-[11px] text-muted-foreground">
                                    Fallback (code default): <code>{editing.fallbackModelId}</code>. Si
                                    desactiva el rol o el modelId es inválido, se usa este.
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label htmlFor="region">Región</Label>
                                    <Input
                                        id="region"
                                        value={form.region}
                                        onChange={(e) => setForm({ ...form, region: e.target.value })}
                                        className="font-mono text-sm"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="pinned">pinnedVersion</Label>
                                    <Input
                                        id="pinned"
                                        value={form.pinnedVersion}
                                        placeholder="(opcional)"
                                        onChange={(e) =>
                                            setForm({ ...form, pinnedVersion: e.target.value })
                                        }
                                        className="font-mono text-sm"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                <div className="space-y-1.5">
                                    <Label htmlFor="temp">temperature</Label>
                                    <Input
                                        id="temp"
                                        value={form.temperature}
                                        placeholder="null"
                                        onChange={(e) =>
                                            setForm({ ...form, temperature: e.target.value })
                                        }
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="max">maxOutTokens</Label>
                                    <Input
                                        id="max"
                                        value={form.maxOutputTokens}
                                        placeholder="null"
                                        onChange={(e) =>
                                            setForm({ ...form, maxOutputTokens: e.target.value })
                                        }
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="dim">outputDim</Label>
                                    <Input
                                        id="dim"
                                        value={form.outputDimensionality}
                                        placeholder="null"
                                        disabled={isEmbedding}
                                        onChange={(e) =>
                                            setForm({ ...form, outputDimensionality: e.target.value })
                                        }
                                    />
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="notes">Notas</Label>
                                <Textarea
                                    id="notes"
                                    value={form.notes}
                                    rows={2}
                                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <Label htmlFor="enabled" className="cursor-pointer">
                                    Activo (si no, usa el fallback)
                                </Label>
                                <Switch
                                    id="enabled"
                                    checked={form.enabled}
                                    onCheckedChange={(v) => setForm({ ...form, enabled: v })}
                                />
                            </div>

                            {probe && (
                                <div
                                    className={`rounded-md p-2.5 text-xs flex items-center gap-2 ${
                                        probe.ok
                                            ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                                            : 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300'
                                    }`}
                                >
                                    {probe.ok ? (
                                        <CheckCircle2 className="h-4 w-4" />
                                    ) : (
                                        <XCircle className="h-4 w-4" />
                                    )}
                                    <span>
                                        {probe.ok ? 'Prueba OK' : 'Prueba falló'} · {probe.latencyMs} ms
                                        {probe.dim ? ` · ${probe.dim} dims` : ''}
                                        {probe.error ? ` — ${probe.error}` : ''}
                                        {probe.note ? ` — ${probe.note}` : ''}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}

                    <DialogFooter className="gap-2">
                        <Button
                            variant="outline"
                            onClick={testInModal}
                            disabled={isTesting || isSaving || editing?.provider === 'local'}
                        >
                            {isTesting ? (
                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : (
                                <FlaskConical className="h-4 w-4 mr-1" />
                            )}
                            Probar
                        </Button>
                        <Button onClick={save} disabled={isSaving || isTesting}>
                            {isSaving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                            Guardar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

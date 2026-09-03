'use client';

import { useState } from 'react';
import { Info, Loader2, RotateCcw, Save } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import {
    CalibrationFactors,
    CalibrationSource,
    calibrationConfidence,
    normalizeChapterKey,
} from '@/backend/calibration/domain/calibration-factors';
import {
    resetCalibrationChapterAction,
    saveCalibrationChapterAction,
    saveCalibrationGlobalAction,
    saveCalibrationGuardAction,
    setCalibrationChapterLockAction,
} from './calibration-actions';

function sourceBadgeVariant(source: CalibrationSource): 'default' | 'secondary' | 'outline' {
    if (source === 'manual') return 'default';
    if (source === 'learned') return 'secondary';
    return 'outline';
}

function fmt(n: number | null | undefined): string {
    return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : '—';
}

function fmtDate(iso: string | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

/** Cabecera de tabla con tooltip explicativo (para columnas con jerga). */
function HeadTip({ label, tip }: { label: string; tip: string }) {
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 cursor-help">
                        {label}
                        <Info className="h-3 w-3 text-muted-foreground/60" />
                    </span>
                </TooltipTrigger>
                <TooltipContent><p className="max-w-[260px]">{tip}</p></TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

interface CalibrationPanelProps {
    initialFactors: CalibrationFactors | null;
}

export function CalibrationPanel({ initialFactors }: CalibrationPanelProps) {
    const { toast } = useToast();
    const [factors, setFactors] = useState<CalibrationFactors | null>(initialFactors);
    const [busy, setBusy] = useState<string | null>(null);

    // Draft buffers (explicit "Guardar" per edit; lock switch applies immediately).
    const [globalDraft, setGlobalDraft] = useState<string>(
        initialFactors ? String(initialFactors.global.factor) : '',
    );
    const [factorDrafts, setFactorDrafts] = useState<Record<string, string>>({});
    const [newChapter, setNewChapter] = useState<string>('');
    const [newChapterFactor, setNewChapterFactor] = useState<string>('');
    const [guardDraft, setGuardDraft] = useState<Record<string, string>>(
        initialFactors
            ? {
                  min_samples: String(initialFactors.guard.min_samples),
                  clamp_min: String(initialFactors.guard.clamp_min),
                  clamp_max: String(initialFactors.guard.clamp_max),
                  outlier_ratio_cap: String(initialFactors.guard.outlier_ratio_cap),
              }
            : {},
    );

    if (!factors) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Calibración de precios (catálogo → real)</CardTitle>
                    <CardDescription>
                        Solo administradores. No se pudieron cargar los factores de calibración
                        (se requiere sesión de administrador).
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }

    const guard = factors.guard;

    // Reconcile local drafts + toasts after any successful mutation.
    function applyResult(next: CalibrationFactors, message: string) {
        setFactors(next);
        setGlobalDraft(String(next.global.factor));
        setFactorDrafts({});
        setGuardDraft({
            min_samples: String(next.guard.min_samples),
            clamp_min: String(next.guard.clamp_min),
            clamp_max: String(next.guard.clamp_max),
            outlier_ratio_cap: String(next.guard.outlier_ratio_cap),
        });
        toast({ title: 'Calibración actualizada', description: message });
    }

    function fail(error: unknown) {
        console.error(error);
        toast({
            variant: 'destructive',
            title: 'Error',
            description: 'No se pudo guardar. Revisa que tengas permisos de administrador.',
        });
    }

    async function run(id: string, fn: () => Promise<CalibrationFactors>, message: string) {
        setBusy(id);
        try {
            const next = await fn();
            applyResult(next, message);
        } catch (error) {
            fail(error);
        } finally {
            setBusy(null);
        }
    }

    async function onSaveGlobal() {
        const v = parseFloat(globalDraft);
        if (!Number.isFinite(v)) return;
        await run('global', () => saveCalibrationGlobalAction(v), 'Factor global guardado.');
    }

    async function onSaveChapter(chapterKey: string, locked: boolean) {
        const draft = factorDrafts[chapterKey];
        const stored = factors!.chapters[chapterKey];
        const raw = draft !== undefined ? draft : String(stored?.manual_factor ?? stored?.factor ?? '');
        const v = parseFloat(raw);
        if (!Number.isFinite(v)) return;
        await run(
            `ch:${chapterKey}`,
            () => saveCalibrationChapterAction(chapterKey, v, locked),
            `Capítulo ${chapterKey} guardado.`,
        );
    }

    async function onToggleLock(chapterKey: string, locked: boolean) {
        await run(
            `lock:${chapterKey}`,
            () => setCalibrationChapterLockAction(chapterKey, locked),
            `Bloqueo ${locked ? 'activado' : 'desactivado'} para ${chapterKey}.`,
        );
    }

    async function onReset(chapterKey: string) {
        await run(
            `reset:${chapterKey}`,
            () => resetCalibrationChapterAction(chapterKey),
            `Capítulo ${chapterKey} restablecido al global.`,
        );
    }

    async function onAddChapter() {
        const key = normalizeChapterKey(newChapter);
        const v = parseFloat(newChapterFactor);
        if (!key || !Number.isFinite(v)) {
            toast({
                variant: 'destructive',
                title: 'Datos incompletos',
                description: 'Indica un nombre de capítulo y un factor válido.',
            });
            return;
        }
        setBusy('add');
        try {
            const next = await saveCalibrationChapterAction(key, v, false);
            applyResult(next, `Capítulo ${key} añadido.`);
            setNewChapter('');
            setNewChapterFactor('');
        } catch (error) {
            fail(error);
        } finally {
            setBusy(null);
        }
    }

    async function onSaveGuard() {
        const patch = {
            min_samples: parseInt(guardDraft.min_samples ?? '', 10),
            clamp_min: parseFloat(guardDraft.clamp_min ?? ''),
            clamp_max: parseFloat(guardDraft.clamp_max ?? ''),
            outlier_ratio_cap: parseFloat(guardDraft.outlier_ratio_cap ?? ''),
        };
        await run('guard', () => saveCalibrationGuardAction(patch), 'Parámetros de aprendizaje guardados.');
    }

    const chapterKeys = Object.keys(factors.chapters).sort((a, b) => a.localeCompare(b));

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Calibración de precios (catálogo → real)</CardTitle>
                    <CardDescription>
                        Factor multiplicador aplicado al precio de catálogo (nivel PEM, antes de GG+BI
                        e IVA) para acercarlo al precio real del constructor. Se aplica por capítulo;
                        los capítulos sin muestras usan el factor global. Nada se aplica de forma oculta:
                        lo que ves aquí es exactamente lo que aplica el motor de precios.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Cómo funciona — banner explicativo */}
                    <div className="flex gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
                        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <div className="space-y-1.5 text-muted-foreground">
                            <p className="font-medium text-foreground">Cómo funciona</p>
                            <p>
                                El motor parte del precio de <strong>catálogo</strong> (COAATMCA/BC3) y lo multiplica por este
                                factor para acercarlo a tu precio real, <strong>a nivel PEM</strong> (antes de GG+BI e IVA):{' '}
                                <code className="rounded bg-muted px-1 py-0.5 text-xs">PVP = catálogo × calibración × (GG+BI) × IVA</code>.
                            </p>
                            <p>
                                Arranca con una <strong>semilla</strong> (global 1,36) y <strong>aprende solo</strong>: cada
                                corrección de precio que haces en el editor ajusta el factor <em>aprendido</em> de ese capítulo
                                (mediana robusta). Por debajo de las <strong>muestras mínimas</strong> se usa tu valor
                                manual/semilla; al alcanzarlas, el aprendido. Puedes fijar cualquier capítulo con el <strong>candado</strong>.
                            </p>
                        </div>
                    </div>

                    {/* Global default */}
                    <div className="rounded-lg border p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                            <div className="space-y-1">
                                <Label htmlFor="cal-global">Factor global (×)</Label>
                                <p className="text-sm text-muted-foreground">
                                    Se aplica a capítulos con 0 muestras o nombres de baja confianza.
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Badge variant={sourceBadgeVariant(factors.global.source)}>
                                    {factors.global.source}
                                </Badge>
                                <Input
                                    id="cal-global"
                                    type="number"
                                    step="0.01"
                                    className="w-28"
                                    value={globalDraft}
                                    onChange={(e) => setGlobalDraft(e.target.value)}
                                />
                                <Button onClick={onSaveGlobal} disabled={busy === 'global'}>
                                    {busy === 'global' ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                        <Save className="mr-2 h-4 w-4" />
                                    )}
                                    Guardar
                                </Button>
                            </div>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                            Última actualización: {fmtDate(factors.global.last_updated)} · por{' '}
                            {factors.global.updated_by}
                        </p>
                    </div>

                    {/* Per-chapter table */}
                    <div className="rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Capítulo</TableHead>
                                    <TableHead>Factor efectivo (×)</TableHead>
                                    <TableHead><HeadTip label="Origen" tip="De dónde sale el factor: seed (semilla inicial), manual (lo fijaste tú) o learned (aprendido de tus correcciones)." /></TableHead>
                                    <TableHead><HeadTip label="Confianza" tip="Cuántas correcciones se han acumulado para este capítulo. Bajo el umbral de muestras mínimas se usa el valor manual/semilla; al alcanzarlo, se aplica el aprendido." /></TableHead>
                                    <TableHead><HeadTip label="Aprendido / Manual" tip="apr. = factor que la IA aprendió de tus correcciones (mediana). man. = el valor que fijaste tú. El «Factor efectivo» de la izquierda es el que realmente se aplica." /></TableHead>
                                    <TableHead><HeadTip label="Bloqueo" tip="Si lo activas, siempre se aplica tu valor manual aunque haya suficientes muestras aprendidas (el aprendido se sigue calculando pero no se aplica)." /></TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {chapterKeys.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                                            Aún no hay capítulos calibrados. Se irán creando al aprender de
                                            correcciones, o puedes añadir uno manualmente abajo.
                                        </TableCell>
                                    </TableRow>
                                )}
                                {chapterKeys.map((key) => {
                                    const ch = factors.chapters[key];
                                    const locked = ch.manual_locked === true;
                                    const conf = calibrationConfidence(ch.sample_count, guard.min_samples);
                                    const draftVal =
                                        factorDrafts[key] !== undefined
                                            ? factorDrafts[key]
                                            : String(ch.manual_factor ?? ch.factor);
                                    const rowBusy = busy?.endsWith(`:${key}`) ?? false;
                                    return (
                                        <TableRow key={key}>
                                            <TableCell className="font-medium">{key}</TableCell>
                                            <TableCell>
                                                <Input
                                                    type="number"
                                                    step="0.01"
                                                    className="w-24"
                                                    value={draftVal}
                                                    onChange={(e) =>
                                                        setFactorDrafts((prev) => ({ ...prev, [key]: e.target.value }))
                                                    }
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={sourceBadgeVariant(ch.source)}>{ch.source}</Badge>
                                            </TableCell>
                                            <TableCell className="min-w-[120px]">
                                                <div className="space-y-1">
                                                    <Progress value={conf.progress} className="h-1.5" />
                                                    <span className="text-xs text-muted-foreground">
                                                        {conf.label}
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                <span className="text-muted-foreground">apr.</span> {fmt(ch.learned_factor)}
                                                {' · '}
                                                <span className="text-muted-foreground">man.</span> {fmt(ch.manual_factor)}
                                            </TableCell>
                                            <TableCell>
                                                <Switch
                                                    checked={locked}
                                                    disabled={busy === `lock:${key}`}
                                                    onCheckedChange={(v) => onToggleLock(key, v)}
                                                    aria-label="Bloquear valor manual"
                                                />
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Button
                                                        size="sm"
                                                        variant="secondary"
                                                        disabled={rowBusy}
                                                        onClick={() => onSaveChapter(key, locked)}
                                                    >
                                                        {busy === `ch:${key}` ? (
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                        ) : (
                                                            <Save className="h-4 w-4" />
                                                        )}
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        title="Restablecer al global"
                                                        disabled={rowBusy}
                                                        onClick={() => onReset(key)}
                                                    >
                                                        {busy === `reset:${key}` ? (
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                        ) : (
                                                            <RotateCcw className="h-4 w-4" />
                                                        )}
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Add chapter */}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <div className="flex-1 space-y-1">
                            <Label htmlFor="cal-new-chapter">Añadir capítulo</Label>
                            <Input
                                id="cal-new-chapter"
                                placeholder="p. ej. DEMOLICIONES"
                                value={newChapter}
                                onChange={(e) => setNewChapter(e.target.value)}
                            />
                        </div>
                        <div className="w-32 space-y-1">
                            <Label htmlFor="cal-new-factor">Factor (×)</Label>
                            <Input
                                id="cal-new-factor"
                                type="number"
                                step="0.01"
                                placeholder="1.42"
                                value={newChapterFactor}
                                onChange={(e) => setNewChapterFactor(e.target.value)}
                            />
                        </div>
                        <Button variant="outline" onClick={onAddChapter} disabled={busy === 'add'}>
                            {busy === 'add' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Añadir
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Learning guard rails */}
            <Card>
                <CardHeader>
                    <CardTitle>Parámetros de aprendizaje</CardTitle>
                    <CardDescription>
                        Umbral de muestras para auto-aplicar el factor aprendido, límites de recorte y
                        rechazo de valores atípicos. Aplican a todos los capítulos salvo overrides.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                        <div className="space-y-1">
                            <Label htmlFor="g-min">Muestras mínimas</Label>
                            <Input
                                id="g-min"
                                type="number"
                                step="1"
                                value={guardDraft.min_samples ?? ''}
                                onChange={(e) => setGuardDraft((p) => ({ ...p, min_samples: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="g-cmin">Recorte mín. (×)</Label>
                            <Input
                                id="g-cmin"
                                type="number"
                                step="0.05"
                                value={guardDraft.clamp_min ?? ''}
                                onChange={(e) => setGuardDraft((p) => ({ ...p, clamp_min: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="g-cmax">Recorte máx. (×)</Label>
                            <Input
                                id="g-cmax"
                                type="number"
                                step="0.05"
                                value={guardDraft.clamp_max ?? ''}
                                onChange={(e) => setGuardDraft((p) => ({ ...p, clamp_max: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="g-out">Tope atípicos (×)</Label>
                            <Input
                                id="g-out"
                                type="number"
                                step="0.1"
                                value={guardDraft.outlier_ratio_cap ?? ''}
                                onChange={(e) =>
                                    setGuardDraft((p) => ({ ...p, outlier_ratio_cap: e.target.value }))
                                }
                            />
                        </div>
                    </div>
                    <Button className="mt-4" onClick={onSaveGuard} disabled={busy === 'guard'}>
                        {busy === 'guard' ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Save className="mr-2 h-4 w-4" />
                        )}
                        Guardar parámetros
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}

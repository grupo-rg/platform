'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    ArrowLeft,
    BadgeCheck,
    Clock,
    Download,
    Eye,
    FolderPlus,
    GripVertical,
    Loader2,
    Plus,
    RefreshCw,
    Save,
    Trash2,
    Upload,
    FileDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { cn, formatNumberES, parseNumberES, toEditableNumberES } from '@/lib/utils';
import type { CompanyConfig } from '@/backend/platform/domain/company-config';
import type { DocumentTemplate, ResolvedDocumentTemplate } from '@/backend/document-template/domain/document-template';
import { builtinTemplateFor } from '@/backend/document-template/domain/template-resolution';
import {
    buildHourlyRateStarterRows,
    countPriceListItems,
    DEFAULT_PRICE_LIST_UNIT,
    DEFAULT_VAT_RATE,
    moveRow,
    newRowId,
    PRICE_LIST_STATUS_LABELS,
    PRICE_LIST_UNITS,
    todayIso,
    type PriceList,
    type PriceListInput,
    type PriceListRow,
} from '@/backend/price-list/domain/price-list';
import { createPriceListAction, updatePriceListAction } from '@/actions/price-list/price-list.action';
import { createDocumentTemplateAction } from '@/actions/document-template/document-template.action';
import { BlocksEditor, TemplateSyntaxHelp } from '@/components/document-templates/BlocksEditor';
import { downloadBlob, priceListFileName, renderPriceListBlob, usePdfCompany } from './pdf-helpers';

const BUILTIN_OPTION = '__builtin__';

const BLOCK_PRESETS = [
    { title: 'Materiales no incluidos', format: 'list' as const },
    { title: 'Incluido en el precio', format: 'list' as const },
    { title: 'Condiciones', format: 'text' as const },
    { title: 'Forma de pago', format: 'text' as const },
    { title: 'Observaciones', format: 'text' as const },
];

function toInput(list: PriceList): PriceListInput {
    const { id: _i, reference: _r, createdAt: _c, updatedAt: _u, createdBy: _b, ...rest } = list;
    return rest;
}

function newDraft(starter: ResolvedDocumentTemplate | null): PriceListInput {
    const tpl = starter ?? builtinTemplateFor('price_list');
    return {
        title: 'Lista de precios',
        date: todayIso(),
        pricesIncludeVat: false,
        vatRate: DEFAULT_VAT_RATE,
        status: 'draft',
        items: [],
        intro: '',
        blocks: tpl.blocks.map((b) => ({ ...b })),
        disclaimer: tpl.disclaimer ?? '',
        documentTemplateId: tpl.templateId ?? null,
    };
}

/** Limpia strings vacíos opcionales antes de guardar. */
function normalize(d: PriceListInput): PriceListInput {
    const opt = (v?: string) => (v && v.trim() !== '' ? v : undefined);
    return {
        ...d,
        clientName: opt(d.clientName),
        clientEmail: opt(d.clientEmail),
        clientAddress: opt(d.clientAddress),
        validUntil: opt(d.validUntil),
        intro: opt(d.intro),
        notes: opt(d.notes),
        disclaimer: opt(d.disclaimer),
    };
}

interface PriceListEditorProps {
    initialList: PriceList | null;
    starter: ResolvedDocumentTemplate | null;
    templates: DocumentTemplate[];
    company: CompanyConfig;
}

export function PriceListEditor({ initialList, starter, templates, company }: PriceListEditorProps) {
    const { toast } = useToast();
    const router = useRouter();
    const pdfCompany = usePdfCompany(company);
    const [saved, setSaved] = useState<PriceList | null>(initialList);
    const [draft, setDraft] = useState<PriceListInput>(() => (initialList ? toInput(initialList) : newDraft(starter)));
    const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(normalize(initialList ? toInput(initialList) : newDraft(starter))));
    const [pending, startTransition] = useTransition();
    const isDirty = !saved || JSON.stringify(normalize(draft)) !== savedSnapshot;

    const set = useCallback((patch: Partial<PriceListInput>) => setDraft((d) => ({ ...d, ...patch })), []);
    const setItems = useCallback((fn: (items: PriceListRow[]) => PriceListRow[]) => setDraft((d) => ({ ...d, items: fn(d.items) })), []);

    // Aviso al salir con cambios sin guardar.
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (isDirty) e.preventDefault();
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [isDirty]);

    const persist = (next: PriceListInput, okMsg: string) =>
        startTransition(async () => {
            const payload = normalize(next);
            const res = saved ? await updatePriceListAction(saved.id, payload) : await createPriceListAction(payload);
            if (!res.success) {
                toast({ title: 'No se pudo guardar', description: res.error, variant: 'destructive' });
                return;
            }
            setSaved(res.data);
            setDraft(toInput(res.data));
            setSavedSnapshot(JSON.stringify(normalize(toInput(res.data))));
            toast({ title: okMsg, description: `${res.data.reference} · ${res.data.title}` });
            if (!saved) router.replace(`/dashboard/price-lists/${res.data.id}`);
        });

    const save = () => persist(draft, saved ? 'Lista guardada' : 'Lista creada');
    const markIssued = () => persist({ ...draft, status: 'issued' }, 'Lista marcada como emitida');

    // ── Filas ────────────────────────────────────────────────────────────
    const addItem = (afterSectionId?: string) =>
        setItems((items) => {
            const row: PriceListRow = { id: newRowId(), type: 'item', description: '', unit: DEFAULT_PRICE_LIST_UNIT, unitPrice: null };
            if (!afterSectionId) return [...items, row];
            const sIdx = items.findIndex((r) => r.id === afterSectionId);
            let insertAt = items.length;
            for (let i = sIdx + 1; i < items.length; i++) {
                if (items[i].type === 'section') {
                    insertAt = i;
                    break;
                }
            }
            return [...items.slice(0, insertAt), row, ...items.slice(insertAt)];
        });
    const addSection = () => setItems((items) => [...items, { id: newRowId(), type: 'section', description: 'Nueva sección' }]);
    const updateRow = (id: string, patch: Partial<PriceListRow>) => setItems((items) => items.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const removeRow = (id: string) => setItems((items) => items.filter((r) => r.id !== id));
    const startHourly = () => setItems((items) => [...items, ...buildHourlyRateStarterRows(newRowId)]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    const onDragEnd = (e: DragEndEvent) => {
        const { active, over } = e;
        if (!over || active.id === over.id) return;
        setItems((items) => moveRow(items, items.findIndex((r) => r.id === active.id), items.findIndex((r) => r.id === over.id)));
    };

    // ── Bloques desde / hacia plantilla ─────────────────────────────────
    const [loadOpen, setLoadOpen] = useState(false);
    const [loadChoice, setLoadChoice] = useState<string>(draft.documentTemplateId || BUILTIN_OPTION);
    const loadBlocks = () => {
        const chosen = templates.find((t) => t.id === loadChoice);
        const src = chosen
            ? { blocks: chosen.blocks, disclaimer: chosen.disclaimer, id: chosen.id }
            : { ...builtinTemplateFor('price_list'), id: null };
        set({ blocks: src.blocks.map((b) => ({ ...b })), disclaimer: src.disclaimer ?? '', documentTemplateId: src.id });
        setLoadOpen(false);
        toast({ title: 'Bloques cargados', description: 'Guarda la lista para conservarlos.' });
    };

    const [saveTplOpen, setSaveTplOpen] = useState(false);
    const [tplName, setTplName] = useState('');
    const saveAsTemplate = () =>
        startTransition(async () => {
            const res = await createDocumentTemplateAction({
                name: tplName.trim() || `Bloques de ${draft.title}`,
                kind: 'price_list',
                isDefault: false,
                blocks: draft.blocks ?? [],
                disclaimer: draft.disclaimer?.trim() ? draft.disclaimer : undefined,
            });
            if (res.success) {
                toast({ title: 'Plantilla creada', description: `«${res.data.name}» disponible en Ajustes › Plantillas PDF.` });
                setSaveTplOpen(false);
                setTplName('');
            } else {
                toast({ title: 'No se pudo crear la plantilla', description: res.error, variant: 'destructive' });
            }
        });

    // ── PDF: vista previa y descarga ────────────────────────────────────
    const pdfData = useMemo(
        () => ({ ...normalize(draft), reference: saved?.reference || 'BORRADOR' }),
        [draft, saved?.reference],
    );
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [rendering, setRendering] = useState(false);
    const previewUrlRef = useRef<string | null>(null);

    const renderPreview = useCallback(async () => {
        setRendering(true);
        try {
            const blob = await renderPriceListBlob(pdfData, pdfCompany);
            const url = URL.createObjectURL(blob);
            if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
            previewUrlRef.current = url;
            setPreviewUrl(url);
        } catch (e: any) {
            console.error('[PriceListEditor] preview', e);
            toast({ title: 'Error al generar la vista previa', description: e?.message, variant: 'destructive' });
        } finally {
            setRendering(false);
        }
    }, [pdfData, pdfCompany, toast]);

    useEffect(() => {
        if (previewOpen) renderPreview();
        // Solo al abrir: el usuario refresca con «Actualizar» (evita re-renderizar el PDF en cada tecla).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [previewOpen]);
    useEffect(() => () => {
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    }, []);

    const download = async () => {
        setRendering(true);
        try {
            downloadBlob(await renderPriceListBlob(pdfData, pdfCompany), priceListFileName(pdfData));
        } catch (e: any) {
            toast({ title: 'Error al generar el PDF', description: e?.message, variant: 'destructive' });
        } finally {
            setRendering(false);
        }
    };

    const rowIds = draft.items.map((r) => r.id);
    const itemCount = countPriceListItems(draft.items);

    return (
        <div className="p-4 md:p-6 max-w-[1400px] mx-auto w-full space-y-6 pb-24">
            {/* Barra superior */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <Button variant="ghost" size="icon" asChild>
                        <Link href="/dashboard/price-lists" aria-label="Volver a listas de precios">
                            <ArrowLeft className="h-5 w-5" />
                        </Link>
                    </Button>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono">{saved?.reference || 'Nueva lista'}</span>
                            <Badge variant={draft.status === 'issued' ? 'default' : 'secondary'}>{PRICE_LIST_STATUS_LABELS[draft.status]}</Badge>
                            {isDirty && <span className="text-amber-600">· Cambios sin guardar</span>}
                        </div>
                        <h1 className="text-xl md:text-2xl font-bold tracking-tight truncate">{draft.title || 'Sin título'}</h1>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => setPreviewOpen(true)}>
                        <Eye className="h-4 w-4 mr-1" /> Vista previa
                    </Button>
                    <Button variant="outline" onClick={download} disabled={rendering}>
                        {rendering ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />} Descargar PDF
                    </Button>
                    {draft.status !== 'issued' && (
                        <Button variant="outline" onClick={markIssued} disabled={pending}>
                            <BadgeCheck className="h-4 w-4 mr-1" /> Marcar como emitida
                        </Button>
                    )}
                    <Button onClick={save} disabled={pending || (!!saved && !isDirty)}>
                        {pending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />} Guardar
                    </Button>
                </div>
            </div>

            {/* Cabecera */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Cabecera</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-6 gap-4">
                    <div className="md:col-span-4 space-y-1">
                        <Label>Título del documento</Label>
                        <Input value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="p.ej. Tarifa de precios por hora 2026" />
                    </div>
                    <div className="md:col-span-1 space-y-1">
                        <Label>Fecha</Label>
                        <Input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} />
                    </div>
                    <div className="md:col-span-1 space-y-1">
                        <Label>Válida hasta</Label>
                        <Input type="date" value={draft.validUntil ?? ''} onChange={(e) => set({ validUntil: e.target.value })} />
                    </div>
                    <div className="md:col-span-2 space-y-1">
                        <Label>Cliente (opcional)</Label>
                        <Input value={draft.clientName ?? ''} onChange={(e) => set({ clientName: e.target.value })} placeholder="Vacío = uso interno" />
                    </div>
                    <div className="md:col-span-2 space-y-1">
                        <Label>Email del cliente</Label>
                        <Input type="email" value={draft.clientEmail ?? ''} onChange={(e) => set({ clientEmail: e.target.value })} />
                    </div>
                    <div className="md:col-span-2 space-y-1">
                        <Label>Dirección del cliente</Label>
                        <Input value={draft.clientAddress ?? ''} onChange={(e) => set({ clientAddress: e.target.value })} />
                    </div>
                    <div className="md:col-span-2 space-y-1">
                        <Label>Precios</Label>
                        <Select value={draft.pricesIncludeVat ? 'with' : 'without'} onValueChange={(v) => set({ pricesIncludeVat: v === 'with' })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="without">Precios sin IVA</SelectItem>
                                <SelectItem value="with">Precios con IVA incluido</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="md:col-span-1 space-y-1">
                        <Label>Tipo de IVA (%)</Label>
                        <Input
                            inputMode="decimal"
                            value={toEditableNumberES(draft.vatRate)}
                            onChange={(e) => set({ vatRate: Math.min(100, Math.max(0, parseNumberES(e.target.value))) })}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Introducción */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Introducción</CardTitle>
                    <CardDescription>Texto opcional que aparece antes de la tabla de precios.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Textarea
                        value={draft.intro ?? ''}
                        onChange={(e) => set({ intro: e.target.value })}
                        rows={4}
                        placeholder="Describe el alcance de la tarifa, a quién va dirigida, etc."
                    />
                </CardContent>
            </Card>

            {/* Tabla de precios */}
            <Card>
                <CardHeader className="pb-3 flex flex-row items-start justify-between gap-2 space-y-0">
                    <div>
                        <CardTitle className="text-base">Precios</CardTitle>
                        <CardDescription>
                            {itemCount} línea{itemCount === 1 ? '' : 's'} · arrastra <GripVertical className="inline h-3 w-3" /> para reordenar. Las secciones son opcionales.
                        </CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                    {draft.items.length === 0 && (
                        <div className="rounded-lg border border-dashed p-6 text-center space-y-3">
                            <p className="text-sm text-muted-foreground">La lista está vacía. Añade líneas y secciones, o empieza con una tarifa por horas.</p>
                            <Button variant="secondary" onClick={startHourly}>
                                <Clock className="h-4 w-4 mr-1" /> Empezar con tarifa por horas
                            </Button>
                            <p className="text-xs text-muted-foreground">
                                Crea Albañilería, Fontanería, Electricidad y Pintura con Oficial 1ª, Oficial 2ª, Peón y Desplazamiento, sin precios.
                            </p>
                        </div>
                    )}

                    {draft.items.length > 0 && (
                        <div className="overflow-x-auto">
                            <div className="min-w-[720px]">
                                <div className="grid grid-cols-[32px_110px_1fr_120px_140px_40px] gap-2 px-1 pb-1 text-xs font-medium uppercase text-muted-foreground">
                                    <span />
                                    <span>Código</span>
                                    <span>Descripción</span>
                                    <span>Unidad</span>
                                    <span className="text-right">Precio (€)</span>
                                    <span />
                                </div>
                                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                                    <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
                                        <div className="space-y-1">
                                            {draft.items.map((row) => (
                                                <SortableRow
                                                    key={row.id}
                                                    row={row}
                                                    onChange={(patch) => updateRow(row.id, patch)}
                                                    onRemove={() => removeRow(row.id)}
                                                    onAddLine={row.type === 'section' ? () => addItem(row.id) : undefined}
                                                />
                                            ))}
                                        </div>
                                    </SortableContext>
                                </DndContext>
                            </div>
                        </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => addItem()}>
                            <Plus className="h-4 w-4 mr-1" /> Añadir línea
                        </Button>
                        <Button variant="outline" size="sm" onClick={addSection}>
                            <FolderPlus className="h-4 w-4 mr-1" /> Añadir sección
                        </Button>
                        {draft.items.length > 0 && (
                            <Button variant="ghost" size="sm" onClick={startHourly}>
                                <Clock className="h-4 w-4 mr-1" /> Añadir tarifa por horas
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Notas */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Notas</CardTitle>
                    <CardDescription>Recuadro de notas tras la tabla (opcional).</CardDescription>
                </CardHeader>
                <CardContent>
                    <Textarea value={draft.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} rows={2} />
                </CardContent>
            </Card>

            {/* Bloques de contenido */}
            <Card>
                <CardHeader className="pb-3 flex flex-col md:flex-row md:items-start justify-between gap-2 space-y-0">
                    <div>
                        <CardTitle className="text-base">Bloques de contenido</CardTitle>
                        <CardDescription>
                            Se imprimen tras la tabla, en este orden. Son de esta lista: cambiarlos no afecta a la plantilla.
                        </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => setLoadOpen(true)}>
                            <Upload className="h-4 w-4 mr-1" /> Cargar bloques desde plantilla
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setSaveTplOpen(true)} disabled={(draft.blocks ?? []).length === 0}>
                            <FileDown className="h-4 w-4 mr-1" /> Guardar estos bloques como plantilla
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <TemplateSyntaxHelp kind="price_list" />
                    <BlocksEditor blocks={draft.blocks ?? []} onChange={(blocks) => set({ blocks })} presets={BLOCK_PRESETS} />
                    <div className="space-y-1">
                        <Label>Aviso final (cursiva)</Label>
                        <Textarea value={draft.disclaimer ?? ''} onChange={(e) => set({ disclaimer: e.target.value })} rows={2} />
                    </div>
                </CardContent>
            </Card>

            {/* Cargar bloques */}
            <Dialog open={loadOpen} onOpenChange={setLoadOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Cargar bloques desde plantilla</DialogTitle>
                        <DialogDescription>Reemplaza los bloques y el aviso actuales de esta lista por los de la plantilla elegida.</DialogDescription>
                    </DialogHeader>
                    <Select value={loadChoice} onValueChange={setLoadChoice}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value={BUILTIN_OPTION}>Condiciones estándar de lista de precios</SelectItem>
                            {templates.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                    {t.name}{t.isDefault ? ' (predeterminada)' : ''}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setLoadOpen(false)}>Cancelar</Button>
                        <Button onClick={loadBlocks}>Cargar y reemplazar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Guardar como plantilla */}
            <Dialog open={saveTplOpen} onOpenChange={setSaveTplOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Guardar bloques como plantilla</DialogTitle>
                        <DialogDescription>Se creará una plantilla de tipo «Lista de precios» con estos bloques y el aviso final.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1">
                        <Label>Nombre de la plantilla</Label>
                        <Input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder={`Bloques de ${draft.title}`} />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setSaveTplOpen(false)}>Cancelar</Button>
                        <Button onClick={saveAsTemplate} disabled={pending}>
                            {pending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Crear plantilla
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Vista previa */}
            <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
                <DialogContent className="max-w-5xl w-[calc(100vw-2rem)] h-[90vh] flex flex-col gap-3">
                    <DialogHeader>
                        <DialogTitle>Vista previa del PDF</DialogTitle>
                        <DialogDescription>Refleja el estado actual del editor (incluidos cambios sin guardar).</DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 min-h-0 rounded-md border bg-muted/40 relative">
                        {previewUrl ? (
                            <iframe src={previewUrl} title="Vista previa de la lista de precios" className="w-full h-full rounded-md" />
                        ) : null}
                        {rendering && (
                            <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                                <Loader2 className="h-6 w-6 animate-spin" />
                            </div>
                        )}
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={renderPreview} disabled={rendering}>
                            <RefreshCw className="h-4 w-4 mr-1" /> Actualizar
                        </Button>
                        <Button onClick={download} disabled={rendering}>
                            <Download className="h-4 w-4 mr-1" /> Descargar PDF
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

// ─── Fila arrastrable ─────────────────────────────────────────────────────

function SortableRow({
    row,
    onChange,
    onRemove,
    onAddLine,
}: {
    row: PriceListRow;
    onChange: (patch: Partial<PriceListRow>) => void;
    onRemove: () => void;
    onAddLine?: () => void;
}) {
    const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
    const style = { transform: CSS.Transform.toString(transform), transition };
    const handle = (
        <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            className="h-9 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
            aria-label="Arrastrar para reordenar"
        >
            <GripVertical className="h-4 w-4" />
        </button>
    );

    if (row.type === 'section') {
        return (
            <div ref={setNodeRef} style={style} className={cn('grid grid-cols-[32px_1fr_auto_40px] gap-2 items-center rounded-md bg-muted px-1 py-1 mt-3', isDragging && 'opacity-60 shadow-lg z-10 relative')}>
                {handle}
                <Input
                    value={row.description}
                    onChange={(e) => onChange({ description: e.target.value })}
                    className="h-9 font-semibold uppercase tracking-wide bg-background"
                    placeholder="Nombre de la sección (p.ej. Fontanería)"
                    aria-label="Nombre de la sección"
                />
                <Button type="button" variant="ghost" size="sm" onClick={onAddLine} className="h-8">
                    <Plus className="h-4 w-4 mr-1" /> Línea
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onRemove} aria-label="Eliminar sección">
                    <Trash2 className="h-4 w-4" />
                </Button>
            </div>
        );
    }

    return (
        <div ref={setNodeRef} style={style} className={cn('grid grid-cols-[32px_110px_1fr_120px_140px_40px] gap-2 items-center px-1', isDragging && 'opacity-60 shadow-lg z-10 relative bg-background')}>
            {handle}
            <Input value={row.code ?? ''} onChange={(e) => onChange({ code: e.target.value || undefined })} className="h-9 font-mono text-xs" placeholder="—" aria-label="Código" />
            <Input value={row.description} onChange={(e) => onChange({ description: e.target.value })} className="h-9" placeholder="Descripción (p.ej. Oficial 1ª)" aria-label="Descripción" />
            <Select value={row.unit || DEFAULT_PRICE_LIST_UNIT} onValueChange={(v) => onChange({ unit: v })}>
                <SelectTrigger className="h-9" aria-label="Unidad"><SelectValue /></SelectTrigger>
                <SelectContent>
                    {[...PRICE_LIST_UNITS, ...(row.unit && !(PRICE_LIST_UNITS as readonly string[]).includes(row.unit) ? [row.unit] : [])].map((u) => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <PriceInput value={row.unitPrice ?? null} onChange={(v) => onChange({ unitPrice: v })} />
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onRemove} aria-label="Eliminar línea">
                <Trash2 className="h-4 w-4" />
            </Button>
        </div>
    );
}

/** Precio en formato es-ES ("1.234,56"); vacío = pendiente (null). */
function PriceInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
    const [text, setText] = useState(value === null ? '' : formatNumberES(value, 2));
    const [focused, setFocused] = useState(false);
    useEffect(() => {
        if (!focused) setText(value === null ? '' : formatNumberES(value, 2));
    }, [value, focused]);
    return (
        <Input
            inputMode="decimal"
            value={text}
            placeholder="A completar"
            className="h-9 text-right font-mono"
            aria-label="Precio unitario"
            onFocus={() => {
                setFocused(true);
                setText(value === null ? '' : toEditableNumberES(value));
            }}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
                setFocused(false);
                const trimmed = text.trim();
                const next = trimmed === '' ? null : Math.round(parseNumberES(trimmed) * 100) / 100;
                onChange(next);
                setText(next === null ? '' : formatNumberES(next, 2));
            }}
        />
    );
}

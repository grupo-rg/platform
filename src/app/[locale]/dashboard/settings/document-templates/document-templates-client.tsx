'use client';

import React, { useState, useTransition } from 'react';
import { Copy, FileText, Loader2, MoreHorizontal, Pencil, Plus, Star, Trash2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
    DOCUMENT_TEMPLATE_KIND_LABELS,
    DOCUMENT_TEMPLATE_KINDS,
    newBlockId,
    type DocumentKind,
    type DocumentTemplate,
    type DocumentTemplateInput,
    type DocumentTemplateKind,
} from '@/backend/document-template/domain/document-template';
import {
    createDocumentTemplateAction,
    deleteDocumentTemplateAction,
    duplicateDocumentTemplateAction,
    listDocumentTemplatesAction,
    seedBuiltinDocumentTemplateAction,
    setDefaultDocumentTemplateAction,
    updateDocumentTemplateAction,
} from '@/actions/document-template/document-template.action';
import { BlocksEditor, TemplateSyntaxHelp } from '@/components/document-templates/BlocksEditor';

type Editing = { id: string | null; draft: DocumentTemplateInput; wasDefault: boolean };

const emptyDraft = (): DocumentTemplateInput => ({
    name: '',
    kind: 'budget',
    isDefault: false,
    disclaimer: '',
    blocks: [{ id: newBlockId(), title: 'Condiciones', body: '' }],
});

export function DocumentTemplatesClient({ initialTemplates }: { initialTemplates: DocumentTemplate[] }) {
    const { toast } = useToast();
    const [templates, setTemplates] = useState(initialTemplates);
    const [editing, setEditing] = useState<Editing | null>(null);
    const [toDelete, setToDelete] = useState<DocumentTemplate | null>(null);
    const [pending, startTransition] = useTransition();

    const refresh = async () => {
        const res = await listDocumentTemplatesAction();
        if (res.success) setTemplates(res.data);
    };

    const run = (fn: () => Promise<{ success: boolean; error?: string }>, okMsg: string, after?: () => void) =>
        startTransition(async () => {
            const res = await fn();
            if (res.success) {
                toast({ title: okMsg });
                after?.();
                await refresh();
            } else {
                toast({ title: 'No se pudo completar', description: res.error, variant: 'destructive' });
            }
        });

    const openEdit = (t: DocumentTemplate) =>
        setEditing({
            id: t.id,
            wasDefault: t.isDefault,
            draft: { name: t.name, kind: t.kind, isDefault: t.isDefault, disclaimer: t.disclaimer ?? '', blocks: t.blocks.map((b) => ({ ...b })) },
        });

    const save = () => {
        if (!editing) return;
        const draft = { ...editing.draft, disclaimer: editing.draft.disclaimer?.trim() ? editing.draft.disclaimer : undefined };
        if (!draft.name.trim()) {
            toast({ title: 'Pon un nombre a la plantilla', variant: 'destructive' });
            return;
        }
        run(
            () => (editing.id ? updateDocumentTemplateAction(editing.id, draft) : createDocumentTemplateAction(draft)),
            editing.id ? 'Plantilla guardada' : 'Plantilla creada',
            () => setEditing(null),
        );
    };

    const seed = (kind: DocumentKind) => run(() => seedBuiltinDocumentTemplateAction(kind), 'Plantilla creada desde la estándar');

    const setDraft = (patch: Partial<DocumentTemplateInput>) =>
        setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-2 justify-between">
                <div className="flex flex-wrap gap-2">
                    <Button onClick={() => setEditing({ id: null, draft: emptyDraft(), wasDefault: false })} disabled={pending}>
                        <Plus className="h-4 w-4 mr-1" /> Nueva plantilla
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" disabled={pending}>
                                <Wand2 className="h-4 w-4 mr-1" /> Crear desde la plantilla actual
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                            <DropdownMenuItem onClick={() => seed('budget')}>Condiciones estándar de presupuesto</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => seed('price_list')}>Condiciones estándar de lista de precios</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                {pending && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground self-center" />}
            </div>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Nombre</TableHead>
                            <TableHead>Tipo</TableHead>
                            <TableHead>Bloques</TableHead>
                            <TableHead>Predeterminada</TableHead>
                            <TableHead className="w-[60px]" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {templates.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                                    Aún no hay plantillas: los PDFs usan las condiciones estándar. Pulsa «Crear desde la plantilla actual» para editarlas.
                                </TableCell>
                            </TableRow>
                        )}
                        {templates.map((t) => (
                            <TableRow key={t.id}>
                                <TableCell className="font-medium">
                                    <button type="button" className="hover:underline text-left" onClick={() => openEdit(t)}>
                                        {t.name}
                                    </button>
                                </TableCell>
                                <TableCell>{DOCUMENT_TEMPLATE_KIND_LABELS[t.kind]}</TableCell>
                                <TableCell>{t.blocks.length}</TableCell>
                                <TableCell>
                                    {t.isDefault ? (
                                        <Badge className="gap-1"><Star className="h-3 w-3" /> Predeterminada</Badge>
                                    ) : (
                                        <span className="text-muted-foreground text-sm">—</span>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" aria-label="Acciones">
                                                <MoreHorizontal className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onClick={() => openEdit(t)}><Pencil className="h-4 w-4 mr-2" /> Editar</DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => run(() => duplicateDocumentTemplateAction(t.id), 'Plantilla duplicada')}>
                                                <Copy className="h-4 w-4 mr-2" /> Duplicar
                                            </DropdownMenuItem>
                                            {!t.isDefault && (
                                                <DropdownMenuItem onClick={() => run(() => setDefaultDocumentTemplateAction(t.id), 'Marcada como predeterminada')}>
                                                    <Star className="h-4 w-4 mr-2" /> Marcar como predeterminada
                                                </DropdownMenuItem>
                                            )}
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                className="text-destructive"
                                                onClick={() => {
                                                    if (t.isDefault) {
                                                        toast({
                                                            title: 'Es la plantilla predeterminada',
                                                            description: 'Marca otra plantilla de este tipo como predeterminada antes de eliminarla.',
                                                            variant: 'destructive',
                                                        });
                                                        return;
                                                    }
                                                    setToDelete(t);
                                                }}
                                            >
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

            {/* Editor */}
            <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
                <DialogContent className="max-w-3xl w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <FileText className="h-5 w-5" /> {editing?.id ? 'Editar plantilla' : 'Nueva plantilla'}
                        </DialogTitle>
                        <DialogDescription>Bloques de condiciones que se imprimen al final del PDF.</DialogDescription>
                    </DialogHeader>
                    {editing && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div className="sm:col-span-2 space-y-1">
                                    <Label>Nombre</Label>
                                    <Input value={editing.draft.name} onChange={(e) => setDraft({ name: e.target.value })} placeholder="p.ej. Condiciones reforma integral" />
                                </div>
                                <div className="space-y-1">
                                    <Label>Tipo de documento</Label>
                                    <Select value={editing.draft.kind} onValueChange={(v) => setDraft({ kind: v as DocumentTemplateKind })}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {DOCUMENT_TEMPLATE_KINDS.map((k) => (
                                                <SelectItem key={k} value={k}>{DOCUMENT_TEMPLATE_KIND_LABELS[k]}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Switch
                                    id="tpl-default"
                                    checked={!!editing.draft.isDefault}
                                    disabled={editing.wasDefault}
                                    onCheckedChange={(v) => setDraft({ isDefault: v })}
                                />
                                <Label htmlFor="tpl-default" className="text-sm">
                                    Predeterminada para «{DOCUMENT_TEMPLATE_KIND_LABELS[editing.draft.kind]}»
                                    {editing.wasDefault && ' (para quitarla, marca otra como predeterminada)'}
                                </Label>
                            </div>
                            <TemplateSyntaxHelp kind={editing.draft.kind === 'any' ? undefined : editing.draft.kind} />
                            <div className="space-y-2">
                                <Label>Bloques</Label>
                                <BlocksEditor blocks={editing.draft.blocks} onChange={(blocks) => setDraft({ blocks })} />
                            </div>
                            <div className="space-y-1">
                                <Label>Aviso / disclaimer (cursiva, tras los totales o al final de la lista)</Label>
                                <Textarea
                                    value={editing.draft.disclaimer ?? ''}
                                    onChange={(e) => setDraft({ disclaimer: e.target.value })}
                                    rows={3}
                                    placeholder="* Este documento es una estimación…"
                                />
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
                        <Button onClick={save} disabled={pending}>
                            {pending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Guardar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar la plantilla «{toDelete?.name}»?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Los presupuestos que la tuvieran asignada pasarán a usar la plantilla predeterminada. Esta acción no se puede deshacer.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                const t = toDelete;
                                setToDelete(null);
                                if (t) run(() => deleteDocumentTemplateAction(t.id), 'Plantilla eliminada');
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

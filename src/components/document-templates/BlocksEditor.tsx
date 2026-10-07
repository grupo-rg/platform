'use client';

import React from 'react';
import { ArrowDown, ArrowUp, List, Plus, Trash2, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { newBlockId, TEMPLATE_PLACEHOLDERS, type TemplateBlock } from '@/backend/document-template/domain/document-template';

function moveRow<T>(rows: readonly T[], from: number, to: number): T[] {
    const next = [...rows];
    if (to < 0 || to >= next.length) return next;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
}

interface BlocksEditorProps {
    blocks: TemplateBlock[];
    onChange: (blocks: TemplateBlock[]) => void;
    /** Sugerencias de títulos para bloques nuevos (atajos). */
    presets?: Array<{ title: string; format?: 'text' | 'list' }>;
    disabled?: boolean;
}

/**
 * Editor de bloques título + cuerpo (plantillas de condiciones y bloques libres
 * de las listas de precios). Reordenar con flechas; formato texto o lista.
 */
export function BlocksEditor({ blocks, onChange, presets, disabled }: BlocksEditorProps) {
    const update = (id: string, patch: Partial<TemplateBlock>) =>
        onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    const remove = (id: string) => onChange(blocks.filter((b) => b.id !== id));
    const move = (index: number, delta: number) => onChange(moveRow(blocks, index, index + delta));
    const add = (title = '', format: 'text' | 'list' = 'text') =>
        onChange([...blocks, { id: newBlockId(), title, body: '', format }]);

    return (
        <div className="space-y-3">
            {blocks.length === 0 && (
                <p className="text-sm text-muted-foreground border border-dashed rounded-md p-4 text-center">
                    Sin bloques. Añade uno con los botones de abajo.
                </p>
            )}
            {blocks.map((block, index) => {
                const isList = block.format === 'list';
                return (
                    <div key={block.id} className="rounded-lg border bg-card p-3 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-mono text-muted-foreground w-6">{index + 1}.</span>
                            <Input
                                value={block.title}
                                onChange={(e) => update(block.id, { title: e.target.value })}
                                placeholder="Título del bloque (opcional)"
                                className="flex-1 min-w-[180px] h-9"
                                disabled={disabled}
                            />
                            <Select
                                value={isList ? 'list' : 'text'}
                                onValueChange={(v) => update(block.id, { format: v as 'text' | 'list' })}
                                disabled={disabled}
                            >
                                <SelectTrigger className="w-[150px] h-9">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="text">Texto</SelectItem>
                                    <SelectItem value="list">Lista de viñetas</SelectItem>
                                </SelectContent>
                            </Select>
                            <div className="flex items-center gap-1">
                                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => move(index, -1)} disabled={disabled || index === 0} aria-label="Subir bloque">
                                    <ArrowUp className="h-4 w-4" />
                                </Button>
                                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => move(index, 1)} disabled={disabled || index === blocks.length - 1} aria-label="Bajar bloque">
                                    <ArrowDown className="h-4 w-4" />
                                </Button>
                                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => remove(block.id)} disabled={disabled} aria-label="Eliminar bloque">
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                        <Textarea
                            value={block.body}
                            onChange={(e) => update(block.id, { body: e.target.value })}
                            placeholder={isList ? 'Un elemento por línea' : 'Texto del bloque. **negrita**, "- " viñeta, "✔ " punto destacado'}
                            rows={isList ? 4 : 6}
                            className="font-mono text-sm"
                            disabled={disabled}
                        />
                        <div className="flex items-center gap-2">
                            <Switch
                                id={`hl-${block.id}`}
                                checked={block.variant === 'highlight'}
                                onCheckedChange={(v) => update(block.id, { variant: v ? 'highlight' : undefined })}
                                disabled={disabled}
                            />
                            <Label htmlFor={`hl-${block.id}`} className="text-xs text-muted-foreground">
                                Destacado (recuadro gris centrado)
                            </Label>
                        </div>
                    </div>
                );
            })}
            <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => add('', 'text')} disabled={disabled}>
                    <Type className="h-4 w-4 mr-1" /> Bloque de texto
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => add('', 'list')} disabled={disabled}>
                    <List className="h-4 w-4 mr-1" /> Lista de viñetas
                </Button>
                {presets?.map((p) => (
                    <Button key={p.title} type="button" variant="ghost" size="sm" onClick={() => add(p.title, p.format ?? 'text')} disabled={disabled}>
                        <Plus className="h-4 w-4 mr-1" /> {p.title}
                    </Button>
                ))}
            </div>
        </div>
    );
}

/** Ayuda de marcado y marcadores, compartida por los editores. */
export function TemplateSyntaxHelp({ kind }: { kind?: 'budget' | 'price_list' }) {
    const placeholders = TEMPLATE_PLACEHOLDERS.filter((p) => !kind || (p.appliesTo as readonly string[]).includes(kind));
    return (
        <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <p>
                <strong>Formato:</strong> línea en blanco = nuevo párrafo · <code>**texto**</code> = negrita · línea que empieza por{' '}
                <code>- </code> = viñeta · <code>✔ </code> = punto destacado · línea entera en <code>**negrita**</code> = encabezado (p.ej. pregunta).
            </p>
            <p>
                <strong>Marcadores:</strong>{' '}
                {placeholders.map((p, i) => (
                    <span key={p.key}>
                        {i > 0 && ' · '}
                        <code>{`{{${p.key}}}`}</code> {p.label}
                    </span>
                ))}
                . En los documentos donde no aplican se dejan vacíos.
            </p>
        </div>
    );
}

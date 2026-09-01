'use client';

import React from 'react';
import { Plus, Trash2, Hammer, Package, Wrench, Boxes, Percent, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatCurrency } from '@/lib/utils';
import { EditableBudgetLineItem } from '@/types/budget-editor';

type CompType = 'LABOR' | 'MATERIAL' | 'MACHINERY' | 'OTHER';

const NEW_CHAPTER = '__new__';

interface CompRow {
    kind: 'normal' | 'percent';
    concept: string;
    type: CompType;
    price: string;    // solo `normal`
    yield: string;    // solo `normal` — rendimiento
    wastePct: string; // solo `normal` — merma %
    pct: string;      // solo `percent` — % sobre el subtotal de directos
}

const emptyRow = (type: CompType = 'LABOR'): CompRow =>
    ({ kind: 'normal', concept: '', type, price: '', yield: '1', wastePct: '0', pct: '' });

const emptyPercentRow = (): CompRow =>
    ({ kind: 'percent', concept: 'Medios auxiliares', type: 'OTHER', price: '', yield: '', wastePct: '', pct: '2' });

const num = (s: string): number => {
    const v = parseFloat(String(s).replace(',', '.'));
    return isNaN(v) ? 0 : v;
};

/** Total de una línea NORMAL: precio × rendimiento × (1 + merma). */
const normalRowTotal = (r: CompRow): number => num(r.price) * num(r.yield) * (1 + num(r.wastePct) / 100);

/**
 * Sugiere el siguiente código incrementando la ÚLTIMA tirada de dígitos,
 * preservando el ancho (ceros a la izquierda). Ej: "C.1.010" → "C.1.011".
 */
const suggestNextCode = (code?: string | null): string => {
    if (!code) return '';
    const m = String(code).match(/^(.*?)(\d+)(\D*)$/);
    if (!m) return '';
    const [, prefix, digits, suffix] = m;
    const next = String(Number(digits) + 1).padStart(digits.length, '0');
    return `${prefix}${next}${suffix}`;
};

/** Último código de partida del capítulo (por mayor `order`). */
const lastCodeInChapter = (items: EditableBudgetLineItem[] | undefined, chapter: string): string => {
    if (!items || !chapter) return '';
    const inCh = items
        .filter(i => i.chapter === chapter && i.item?.code)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const last = inCh[inCh.length - 1];
    return (last?.item?.code as string) || '';
};

const TYPE_META: Record<CompType, { label: string }> = {
    LABOR: { label: 'Mano de obra' },
    MATERIAL: { label: 'Material' },
    MACHINERY: { label: 'Maquinaria' },
    OTHER: { label: 'Otro' },
};

export function ManualPartidaDialog({
    open,
    onOpenChange,
    chapters,
    onAdd,
    initialChapter,
    items,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    chapters: string[];
    onAdd: (item: Partial<EditableBudgetLineItem>) => void;
    /** Capítulo preseleccionado (p.ej. al abrir desde el menú de un capítulo). */
    initialChapter?: string;
    /** Partidas actuales — para auto-sugerir el siguiente código del capítulo. */
    items?: EditableBudgetLineItem[];
}) {
    const [chapter, setChapter] = React.useState('');
    const [newChapter, setNewChapter] = React.useState('');
    const [code, setCode] = React.useState('');
    const [codeTouched, setCodeTouched] = React.useState(false);
    const [unit, setUnit] = React.useState('ud');
    const [quantity, setQuantity] = React.useState('1');
    const [description, setDescription] = React.useState('');
    const [rows, setRows] = React.useState<CompRow[]>([]);
    const [priceInput, setPriceInput] = React.useState('');
    const [priceTouched, setPriceTouched] = React.useState(false);

    const effectiveChapter = chapter === NEW_CHAPTER ? newChapter.trim() : chapter;

    const suggestedCode = React.useMemo(
        () => suggestNextCode(lastCodeInChapter(items, effectiveChapter)),
        [items, effectiveChapter]
    );

    React.useEffect(() => {
        if (open) {
            const start = initialChapter && chapters.includes(initialChapter)
                ? initialChapter
                : (chapters[0] || NEW_CHAPTER);
            setChapter(start);
            setNewChapter('');
            setCode(''); setCodeTouched(false);
            setUnit('ud'); setQuantity('1'); setDescription('');
            setRows([]); setPriceInput(''); setPriceTouched(false);
        }
    }, [open, initialChapter, chapters]);

    React.useEffect(() => {
        if (open && !codeTouched) setCode(suggestedCode);
    }, [open, codeTouched, suggestedCode]);

    const hasBreakdown = rows.length > 0;

    // Subtotal de costes directos (líneas normales) — base de los medios auxiliares.
    const directTotal = rows.filter(r => r.kind === 'normal').reduce((s, r) => s + normalRowTotal(r), 0);
    const rowTotal = (r: CompRow): number => (r.kind === 'percent' ? directTotal * num(r.pct) / 100 : normalRowTotal(r));
    const breakdownSum = rows.reduce((s, r) => s + rowTotal(r), 0);

    // El precio unitario sigue al descompuesto salvo que el usuario lo sobrescriba.
    const unitPrice = hasBreakdown
        ? (priceTouched ? num(priceInput) : breakdownSum)
        : num(priceInput);
    const totalPrice = unitPrice * num(quantity);

    // Alerta de cuadre: sólo con descompuesto y precio sobrescrito divergente.
    const divergence = hasBreakdown ? unitPrice - breakdownSum : 0;
    const mismatch = hasBreakdown && Math.abs(divergence) > 0.01;

    const canSave = description.trim().length > 0 && num(quantity) > 0 && unitPrice > 0 && effectiveChapter.length > 0;

    const updateRow = (i: number, patch: Partial<CompRow>) =>
        setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

    const handleSave = () => {
        const breakdown = hasBreakdown
            ? rows.map(r => {
                  if (r.kind === 'percent') {
                      const pct = num(r.pct);
                      return {
                          code: '%',
                          concept: r.concept.trim() || 'Medios auxiliares',
                          type: 'OTHER' as CompType,
                          unit: '%',
                          price: directTotal,   // base sobre la que se aplica
                          quantity: pct,         // el % (convención: total = price × quantity/100)
                          yield: pct,
                          waste: 0,
                          total: directTotal * pct / 100,
                          is_variable: false,
                      };
                  }
                  const y = num(r.yield);
                  const w = num(r.wastePct) / 100;
                  return {
                      code: undefined,
                      concept: r.concept.trim() || TYPE_META[r.type].label,
                      type: r.type,
                      unit: undefined,
                      price: num(r.price),
                      yield: y,
                      quantity: y,
                      waste: w,
                      total: normalRowTotal(r),
                  };
              })
            : undefined;

        const item: Partial<EditableBudgetLineItem> = {
            type: 'PARTIDA',
            chapter: effectiveChapter || 'General',
            originalTask: description.trim(),
            item: {
                code: code.trim(),
                description: description.trim(),
                unit: unit.trim() || 'ud',
                quantity: num(quantity),
                unitPrice,
                totalPrice,
                breakdown: breakdown as any,
            },
            originalState: {
                unitPrice,
                quantity: num(quantity),
                description: description.trim(),
                unit: unit.trim() || 'ud',
            },
        };
        onAdd(item);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto bg-white dark:bg-zinc-950 border-slate-200 dark:border-white/10">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Plus className="w-5 h-5 text-primary" /> Nueva partida (manual)
                    </DialogTitle>
                </DialogHeader>

                {/* Cabecera de la partida */}
                <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_0.8fr_0.8fr] gap-3">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-500">Capítulo</label>
                        <select
                            value={chapter}
                            onChange={e => setChapter(e.target.value)}
                            className="h-10 rounded-md border border-slate-200 dark:border-white/10 bg-transparent px-2 text-sm"
                        >
                            {chapters.map(c => <option key={c} value={c}>{c}</option>)}
                            <option value={NEW_CHAPTER}>➕ Nuevo capítulo…</option>
                        </select>
                        {chapter === NEW_CHAPTER && (
                            <Input
                                autoFocus
                                value={newChapter}
                                onChange={e => setNewChapter(e.target.value)}
                                placeholder="Nombre del nuevo capítulo"
                                className="mt-1"
                            />
                        )}
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-500">Código</label>
                        <Input
                            value={code}
                            onChange={e => { setCode(e.target.value); setCodeTouched(true); }}
                            placeholder="ej. 01.05"
                        />
                        {!codeTouched && suggestedCode && (
                            <span className="text-[11px] text-slate-400">Sugerido a partir de la última partida</span>
                        )}
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-500">Unidad</label>
                        <Input value={unit} onChange={e => setUnit(e.target.value)} placeholder="ud, m², m³…" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-500">Cantidad</label>
                        <Input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} className="text-right font-mono" />
                    </div>
                </div>

                <div className="flex flex-col gap-1 mt-1">
                    <label className="text-xs font-medium text-slate-500">Descripción</label>
                    <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Descripción de la partida…" rows={2} />
                </div>

                {/* Descompuestos */}
                <div className="mt-2 border border-slate-200 dark:border-white/10 rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10">
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Descompuesto {hasBreakdown && `(${rows.length})`}</span>
                        <div className="flex gap-1">
                            <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setRows(p => [...p, emptyRow('LABOR')])}>
                                <Hammer className="w-3 h-3" /> M.O.
                            </Button>
                            <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setRows(p => [...p, emptyRow('MATERIAL')])}>
                                <Package className="w-3 h-3" /> Material
                            </Button>
                            <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setRows(p => [...p, emptyRow('MACHINERY')])}>
                                <Wrench className="w-3 h-3" /> Maquinaria
                            </Button>
                            <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setRows(p => [...p, emptyPercentRow()])}>
                                <Percent className="w-3 h-3" /> Medios aux.
                            </Button>
                        </div>
                    </div>

                    {rows.length === 0 ? (
                        <div className="px-3 py-4 text-center text-xs text-slate-400">
                            Sin descompuesto. Añade líneas arriba, o escribe el precio unitario abajo.
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100 dark:divide-white/5">
                            <div className="grid grid-cols-[1fr_120px_90px_80px_80px_100px_32px] gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
                                <span>Concepto</span><span>Tipo</span><span className="text-right">Precio</span><span className="text-right">Rend./%</span><span className="text-right">Merma %</span><span className="text-right">Total</span><span></span>
                            </div>
                            {rows.map((r, i) => (
                                <div key={i} className="grid grid-cols-[1fr_120px_90px_80px_80px_100px_32px] gap-2 px-3 py-1.5 items-center">
                                    <Input value={r.concept} onChange={e => updateRow(i, { concept: e.target.value })} placeholder={r.kind === 'percent' ? 'Medios auxiliares' : TYPE_META[r.type].label} className="h-8 text-sm" />
                                    {r.kind === 'percent' ? (
                                        <span className="text-xs px-2 py-1 rounded bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 font-medium text-center inline-flex items-center justify-center gap-1"><Percent className="w-3 h-3" /> Medios aux.</span>
                                    ) : (
                                        <select value={r.type} onChange={e => updateRow(i, { type: e.target.value as CompType })} className="h-8 text-xs rounded-md border border-slate-200 dark:border-white/10 bg-transparent px-1">
                                            {(Object.keys(TYPE_META) as CompType[]).map(t => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
                                        </select>
                                    )}
                                    {r.kind === 'percent' ? (
                                        <span className="text-right font-mono text-xs text-slate-400 self-center" title="Base: subtotal de costes directos">s/ {formatCurrency(directTotal)}</span>
                                    ) : (
                                        <Input type="number" value={r.price} onChange={e => updateRow(i, { price: e.target.value })} className="h-8 text-right font-mono text-sm" />
                                    )}
                                    {r.kind === 'percent' ? (
                                        <Input type="number" value={r.pct} onChange={e => updateRow(i, { pct: e.target.value })} className="h-8 text-right font-mono text-sm" placeholder="%" />
                                    ) : (
                                        <Input type="number" value={r.yield} onChange={e => updateRow(i, { yield: e.target.value })} className="h-8 text-right font-mono text-sm" />
                                    )}
                                    {r.kind === 'percent' ? (
                                        <span className="text-right text-xs text-slate-300">—</span>
                                    ) : (
                                        <Input type="number" value={r.wastePct} onChange={e => updateRow(i, { wastePct: e.target.value })} className="h-8 text-right font-mono text-sm" />
                                    )}
                                    <span className="text-right font-mono text-sm font-semibold">{formatCurrency(rowTotal(r))}</span>
                                    <button type="button" onClick={() => setRows(p => p.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-red-500 flex justify-center">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                            {/* Subtotales */}
                            <div className="flex justify-end gap-6 px-3 py-1.5 text-xs text-slate-500">
                                <span>Directos: <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{formatCurrency(directTotal)}</span></span>
                                <span>Σ descompuesto: <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{formatCurrency(breakdownSum)}</span></span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Precio + total */}
                <div className="flex flex-wrap items-end justify-between gap-4 mt-1">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-500">
                            Precio unitario {hasBreakdown && <span className="text-slate-400">(auto del descompuesto — editable)</span>}
                        </label>
                        <Input
                            type="number"
                            value={priceTouched || !hasBreakdown ? priceInput : String(Number(breakdownSum.toFixed(2)))}
                            onChange={e => { setPriceInput(e.target.value); setPriceTouched(true); }}
                            placeholder="0,00"
                            className="w-44 text-right font-mono"
                        />
                    </div>
                    <div className="text-right">
                        <div className="text-xs text-slate-500">Total partida</div>
                        <div className="font-mono text-xl font-bold text-primary">{formatCurrency(totalPrice)}</div>
                    </div>
                </div>

                {/* Alerta de cuadre */}
                {hasBreakdown && (
                    mismatch ? (
                        <div className="flex items-center gap-2 rounded-md border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            <span>
                                El precio unitario no cuadra con el descompuesto: Σ = {formatCurrency(breakdownSum)}, precio = {formatCurrency(unitPrice)} (diferencia {formatCurrency(divergence)}).
                            </span>
                            <Button type="button" size="sm" variant="outline" className="h-6 text-xs ml-auto shrink-0" onClick={() => { setPriceInput(String(Number(breakdownSum.toFixed(2)))); setPriceTouched(true); }}>
                                Cuadrar
                            </Button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 rounded-md border border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                            <span>El descompuesto cuadra con el precio unitario.</span>
                        </div>
                    )
                )}

                <DialogFooter className="mt-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={handleSave} disabled={!canSave} className="gap-1.5">
                        <Plus className="w-4 h-4" /> Añadir partida
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

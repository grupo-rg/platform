'use client';

import React from 'react';
import { Plus, Trash2, Hammer, Package, Wrench, Boxes } from 'lucide-react';
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

interface CompRow {
    concept: string;
    type: CompType;
    price: string;   // strings mientras se edita; se parsean al guardar
    yield: string;   // rendimiento
    wastePct: string; // merma en %
}

const emptyRow = (type: CompType = 'LABOR'): CompRow => ({ concept: '', type, price: '', yield: '1', wastePct: '0' });

const num = (s: string): number => {
    const v = parseFloat(String(s).replace(',', '.'));
    return isNaN(v) ? 0 : v;
};

const rowTotal = (r: CompRow): number => num(r.price) * num(r.yield) * (1 + num(r.wastePct) / 100);

const TYPE_META: Record<CompType, { label: string; icon: React.ReactNode }> = {
    LABOR: { label: 'Mano de obra', icon: <Hammer className="w-3.5 h-3.5" /> },
    MATERIAL: { label: 'Material', icon: <Package className="w-3.5 h-3.5" /> },
    MACHINERY: { label: 'Maquinaria', icon: <Wrench className="w-3.5 h-3.5" /> },
    OTHER: { label: 'Otro', icon: <Boxes className="w-3.5 h-3.5" /> },
};

export function ManualPartidaDialog({
    open,
    onOpenChange,
    chapters,
    onAdd,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    chapters: string[];
    onAdd: (item: Partial<EditableBudgetLineItem>) => void;
}) {
    const [chapter, setChapter] = React.useState('');
    const [code, setCode] = React.useState('');
    const [unit, setUnit] = React.useState('ud');
    const [quantity, setQuantity] = React.useState('1');
    const [description, setDescription] = React.useState('');
    const [rows, setRows] = React.useState<CompRow[]>([]);
    const [manualPrice, setManualPrice] = React.useState(''); // usado si no hay descompuestos

    React.useEffect(() => {
        if (open) {
            setChapter(chapters[0] || 'General');
            setCode(''); setUnit('ud'); setQuantity('1'); setDescription('');
            setRows([]); setManualPrice('');
        }
    }, [open, chapters]);

    const hasBreakdown = rows.length > 0;
    const unitPrice = hasBreakdown ? rows.reduce((s, r) => s + rowTotal(r), 0) : num(manualPrice);
    const totalPrice = unitPrice * num(quantity);
    const canSave = description.trim().length > 0 && num(quantity) > 0 && unitPrice > 0;

    const updateRow = (i: number, patch: Partial<CompRow>) =>
        setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

    const handleSave = () => {
        const breakdown = hasBreakdown
            ? rows.map(r => {
                  const y = num(r.yield);
                  const w = num(r.wastePct) / 100;
                  return {
                      concept: r.concept.trim() || TYPE_META[r.type].label,
                      type: r.type,
                      price: num(r.price),
                      unit: undefined,
                      yield: y,
                      quantity: y,   // alias que algunas partes del editor leen
                      waste: w,
                      total: rowTotal(r),
                  };
              })
            : undefined;

        const item: Partial<EditableBudgetLineItem> = {
            type: 'PARTIDA',
            chapter: chapter.trim() || 'General',
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
                        <Input list="manual-chapters" value={chapter} onChange={e => setChapter(e.target.value)} placeholder="Elige o escribe un capítulo" />
                        <datalist id="manual-chapters">
                            {chapters.map(c => <option key={c} value={c} />)}
                        </datalist>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-500">Código</label>
                        <Input value={code} onChange={e => setCode(e.target.value)} placeholder="ej. 01.05" />
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
                        </div>
                    </div>

                    {rows.length === 0 ? (
                        <div className="px-3 py-4 text-center text-xs text-slate-400">
                            Sin descompuesto. Añade líneas arriba, o escribe el precio unitario abajo.
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100 dark:divide-white/5">
                            <div className="grid grid-cols-[1fr_110px_90px_80px_80px_100px_32px] gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
                                <span>Concepto</span><span>Tipo</span><span className="text-right">Precio</span><span className="text-right">Rend.</span><span className="text-right">Merma %</span><span className="text-right">Total</span><span></span>
                            </div>
                            {rows.map((r, i) => (
                                <div key={i} className="grid grid-cols-[1fr_110px_90px_80px_80px_100px_32px] gap-2 px-3 py-1.5 items-center">
                                    <Input value={r.concept} onChange={e => updateRow(i, { concept: e.target.value })} placeholder={TYPE_META[r.type].label} className="h-8 text-sm" />
                                    <select value={r.type} onChange={e => updateRow(i, { type: e.target.value as CompType })} className="h-8 text-xs rounded-md border border-slate-200 dark:border-white/10 bg-transparent px-1">
                                        {(Object.keys(TYPE_META) as CompType[]).map(t => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
                                    </select>
                                    <Input type="number" value={r.price} onChange={e => updateRow(i, { price: e.target.value })} className="h-8 text-right font-mono text-sm" />
                                    <Input type="number" value={r.yield} onChange={e => updateRow(i, { yield: e.target.value })} className="h-8 text-right font-mono text-sm" />
                                    <Input type="number" value={r.wastePct} onChange={e => updateRow(i, { wastePct: e.target.value })} className="h-8 text-right font-mono text-sm" />
                                    <span className="text-right font-mono text-sm font-semibold">{formatCurrency(rowTotal(r))}</span>
                                    <button type="button" onClick={() => setRows(p => p.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-red-500 flex justify-center">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Precio + total */}
                <div className="flex flex-wrap items-end justify-between gap-4 mt-1">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-500">Precio unitario {hasBreakdown && <span className="text-slate-400">(auto del descompuesto)</span>}</label>
                        {hasBreakdown ? (
                            <div className="font-mono text-lg font-semibold text-slate-800 dark:text-white">{formatCurrency(unitPrice)}</div>
                        ) : (
                            <Input type="number" value={manualPrice} onChange={e => setManualPrice(e.target.value)} placeholder="0,00" className="w-40 text-right font-mono" />
                        )}
                    </div>
                    <div className="text-right">
                        <div className="text-xs text-slate-500">Total partida</div>
                        <div className="font-mono text-xl font-bold text-primary">{formatCurrency(totalPrice)}</div>
                    </div>
                </div>

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

'use client';

import { useEffect, useState, useRef } from 'react';
import { Project } from '@/backend/project/domain/project';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Dialog, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
    Upload, Plus, Trash2, Sparkles, FileText, Loader2,
} from 'lucide-react';
import { createExpenseAction } from '@/actions/expense/create-expense.action';
import { uploadInvoiceAction } from '@/actions/expense/upload-invoice.action';
import { Badge } from '@/components/ui/badge';

type Mode = 'manual' | 'ai';

interface LineInput {
    description: string;
    quantity: number;
    unitPrice: number;
    budgetChapter?: string;
    phaseId?: string;
}

interface CreateExpenseModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projects: Project[];
    locale: string;
    /**
     * Si se pasa, el modal preselecciona ese proyecto, oculta el selector y no
     * permite cambiarlo. Útil cuando el modal se abre dentro del contexto de
     * un proyecto concreto (ej: tab Económico del detalle de obra), donde
     * mostrar un dropdown con una sola opción solo añade fricción.
     */
    lockedProjectId?: string;
}

export function CreateExpenseModal({ open, onOpenChange, projects, locale, lockedProjectId }: CreateExpenseModalProps) {
    const [mode, setMode] = useState<Mode>('ai');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form state
    const [selectedProjectId, setSelectedProjectId] = useState<string>(lockedProjectId || '');
    const [providerName, setProviderName] = useState('');
    const [providerCif, setProviderCif] = useState('');
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [invoiceDate, setInvoiceDate] = useState('');
    const [taxRate, setTaxRate] = useState(0.21);
    const [notes, setNotes] = useState('');
    const [lines, setLines] = useState<LineInput[]>([{ description: '', quantity: 1, unitPrice: 0 }]);

    // AI state
    const [aiResult, setAiResult] = useState<any>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const selectedProject = projects.find(p => p.id === selectedProjectId);
    const budgetChapters = selectedProject?.phases?.map(p => p.name) || [];

    // Si `lockedProjectId` cambia (modal reutilizado entre obras distintas),
    // alinea el state. Sin esto el modal mostraría la selección anterior.
    useEffect(() => {
        if (lockedProjectId) setSelectedProjectId(lockedProjectId);
    }, [lockedProjectId]);

    const resetForm = () => {
        setSelectedProjectId(lockedProjectId || '');
        setProviderName('');
        setProviderCif('');
        setInvoiceNumber('');
        setInvoiceDate('');
        setTaxRate(0.21);
        setNotes('');
        setLines([{ description: '', quantity: 1, unitPrice: 0 }]);
        setAiResult(null);
        setError(null);
    };

    const handleClose = () => {
        resetForm();
        onOpenChange(false);
    };

    // --- AI Upload ---
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !selectedProjectId) return;

        setLoading(true);
        setError(null);

        try {
            const reader = new FileReader();
            reader.onload = async () => {
                const base64 = (reader.result as string).split(',')[1];

                const result = await uploadInvoiceAction({
                    projectId: selectedProjectId,
                    fileBase64: base64,
                    mimeType: file.type,
                    budgetChapters,
                });

                if (result.success) {
                    setAiResult(result.extracted);
                    handleClose();
                } else {
                    setError(result.error || 'Error al procesar');
                }
                setLoading(false);
            };
            reader.readAsDataURL(file);
        } catch (err: any) {
            setError(err.message);
            setLoading(false);
        }
    };

    // --- Manual Submit ---
    const handleManualSubmit = async () => {
        if (!selectedProjectId || !providerName || lines.length === 0) {
            setError('Completa los campos obligatorios');
            return;
        }

        setLoading(true);
        setError(null);

        const subtotal = lines.reduce((acc, l) => acc + l.quantity * l.unitPrice, 0);
        const taxAmount = subtotal * taxRate;
        const total = subtotal + taxAmount;

        try {
            const result = await createExpenseAction({
                projectId: selectedProjectId,
                providerName,
                providerCif: providerCif || undefined,
                invoiceNumber: invoiceNumber || undefined,
                invoiceDate: invoiceDate || undefined,
                lines: lines.map(l => ({
                    description: l.description,
                    quantity: l.quantity,
                    unitPrice: l.unitPrice,
                    total: l.quantity * l.unitPrice,
                    budgetChapter: l.budgetChapter,
                    phaseId: l.phaseId,
                })),
                subtotal,
                taxRate,
                taxAmount,
                total,
                notes: notes || undefined,
            });

            if (result.success) {
                handleClose();
            } else {
                setError(result.error || 'Error al crear');
            }
        } catch (err: any) {
            setError(err.message);
        }
        setLoading(false);
    };

    const addLine = () => setLines([...lines, { description: '', quantity: 1, unitPrice: 0 }]);
    const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
    const updateLine = (i: number, field: keyof LineInput, value: any) => {
        const updated = [...lines];
        (updated[i] as any)[field] = value;
        setLines(updated);
    };

    const subtotal = lines.reduce((acc, l) => acc + l.quantity * l.unitPrice, 0);
    const taxAmount = subtotal * taxRate;
    const total = subtotal + taxAmount;

    const formatCurrency = (amount: number) =>
        new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(amount);

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <FileText className="w-5 h-5 text-indigo-500" />
                        Registrar Factura / Gasto
                    </DialogTitle>
                    <DialogDescription>
                        Sube un PDF o introduce los datos manualmente.
                    </DialogDescription>
                </DialogHeader>

                {/* Mode selector */}
                <div className="flex gap-2 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                    <button
                        onClick={() => setMode('ai')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-all ${mode === 'ai'
                                ? 'bg-white dark:bg-zinc-900 shadow-sm text-indigo-600 dark:text-indigo-400'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Sparkles className="w-4 h-4" />
                        Subir PDF (AI)
                    </button>
                    <button
                        onClick={() => setMode('manual')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-all ${mode === 'manual'
                                ? 'bg-white dark:bg-zinc-900 shadow-sm text-indigo-600 dark:text-indigo-400'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <FileText className="w-4 h-4" />
                        Manual
                    </button>
                </div>

                {/* Project selector — oculto cuando el modal se abre dentro
                    del contexto de una obra concreta (lockedProjectId). */}
                {!lockedProjectId && (
                    <div className="space-y-2">
                        <Label>Obra *</Label>
                        <select
                            className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm"
                            value={selectedProjectId}
                            onChange={e => setSelectedProjectId(e.target.value)}
                        >
                            <option value="">Seleccionar obra...</option>
                            {projects.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    </div>
                )}

                {/* === AI MODE === */}
                {mode === 'ai' && (
                    <div className="space-y-4">
                        <div
                            onClick={() => selectedProjectId && fileInputRef.current?.click()}
                            className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${selectedProjectId
                                    ? 'border-indigo-300 hover:border-indigo-500 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10'
                                    : 'border-zinc-200 opacity-50 cursor-not-allowed'
                                }`}
                        >
                            {loading ? (
                                <div className="space-y-3">
                                    <Loader2 className="w-10 h-10 mx-auto text-indigo-500 animate-spin" />
                                    <p className="text-sm text-muted-foreground">Extrayendo datos con AI...</p>
                                    <p className="text-xs text-muted-foreground">Esto puede tardar unos segundos</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/30 dark:to-purple-900/30">
                                        <Upload className="w-7 h-7 text-indigo-500" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-foreground">
                                            {selectedProjectId ? 'Haz clic o arrastra un archivo' : 'Primero selecciona una obra'}
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-1">PDF, JPG o PNG de la factura</p>
                                    </div>
                                </div>
                            )}
                        </div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,image/jpeg,image/png"
                            className="hidden"
                            onChange={handleFileUpload}
                        />
                    </div>
                )}

                {/* === MANUAL MODE === */}
                {mode === 'manual' && (
                    <div className="space-y-4">
                        {/* Provider info */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label>Proveedor *</Label>
                                <Input placeholder="Nombre del proveedor" value={providerName} onChange={e => setProviderName(e.target.value)} />
                            </div>
                            <div className="space-y-1">
                                <Label>CIF/NIF</Label>
                                <Input placeholder="B12345678" value={providerCif} onChange={e => setProviderCif(e.target.value)} />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label>Nº Factura</Label>
                                <Input placeholder="F-2026-001" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} />
                            </div>
                            <div className="space-y-1">
                                <Label>Fecha</Label>
                                <Input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
                            </div>
                        </div>

                        {/* Invoice lines */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label>Líneas de factura *</Label>
                                <Button size="sm" variant="outline" onClick={addLine}>
                                    <Plus className="w-3 h-3 mr-1" /> Añadir
                                </Button>
                            </div>
                            {lines.map((line, i) => (
                                <div key={i} className="grid grid-cols-12 gap-2 items-end">
                                    <div className="col-span-5 space-y-1">
                                        {i === 0 && <Label className="text-xs">Descripción</Label>}
                                        <Input
                                            placeholder="Material / concepto"
                                            value={line.description}
                                            onChange={e => updateLine(i, 'description', e.target.value)}
                                        />
                                    </div>
                                    <div className="col-span-2 space-y-1">
                                        {i === 0 && <Label className="text-xs">Cantidad</Label>}
                                        <Input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={line.quantity}
                                            onChange={e => updateLine(i, 'quantity', parseFloat(e.target.value) || 0)}
                                        />
                                    </div>
                                    <div className="col-span-2 space-y-1">
                                        {i === 0 && <Label className="text-xs">P. Unit.</Label>}
                                        <Input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={line.unitPrice}
                                            onChange={e => updateLine(i, 'unitPrice', parseFloat(e.target.value) || 0)}
                                        />
                                    </div>
                                    <div className="col-span-2 text-right text-sm font-medium pt-1">
                                        {formatCurrency(line.quantity * line.unitPrice)}
                                    </div>
                                    <div className="col-span-1">
                                        {lines.length > 1 && (
                                            <Button size="icon" variant="ghost" onClick={() => removeLine(i)} className="h-9 w-9 text-red-400 hover:text-red-600">
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </Button>
                                        )}
                                    </div>
                                    {/* Chapter assignment */}
                                    {budgetChapters.length > 0 && (
                                        <div className="col-span-12">
                                            <select
                                                className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-xs text-muted-foreground"
                                                value={line.budgetChapter || ''}
                                                onChange={e => updateLine(i, 'budgetChapter', e.target.value || undefined)}
                                            >
                                                <option value="">Asignar a capítulo...</option>
                                                {budgetChapters.map(ch => (
                                                    <option key={ch} value={ch}>{ch}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Tax & totals */}
                        <div className="space-y-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <Label className="text-xs">IVA (%)</Label>
                                    <Input
                                        type="number"
                                        min="0"
                                        max="100"
                                        value={taxRate * 100}
                                        onChange={e => setTaxRate((parseFloat(e.target.value) || 0) / 100)}
                                    />
                                </div>
                                <div className="space-y-2 text-right text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Subtotal:</span>
                                        <span>{formatCurrency(subtotal)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">IVA ({(taxRate * 100).toFixed(0)}%):</span>
                                        <span>{formatCurrency(taxAmount)}</span>
                                    </div>
                                    <div className="flex justify-between font-bold text-base">
                                        <span>Total:</span>
                                        <span>{formatCurrency(total)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <Label>Notas</Label>
                            <Textarea placeholder="Observaciones opcionales..." value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
                        </div>
                    </div>
                )}

                {/* Error */}
                {error && (
                    <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                        {error}
                    </div>
                )}

                {/* Footer */}
                {mode === 'manual' && (
                    <DialogFooter>
                        <Button variant="outline" onClick={handleClose}>Cancelar</Button>
                        <Button
                            onClick={handleManualSubmit}
                            disabled={loading || !selectedProjectId || !providerName}
                            className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white"
                        >
                            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                            Registrar Gasto
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}

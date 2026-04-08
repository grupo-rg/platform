import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { BudgetCostBreakdown } from '@/backend/budget/domain/budget';
import { BudgetConfig, ExecutionMode } from '@/types/budget-editor';
import { formatMoneyEUR } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Settings2, X, Check, ArrowRight, FileDown, Trash, Loader2, Download, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PDFDownloadLink } from '@react-pdf/renderer';
import { BudgetDocument } from '@/components/pdf/BudgetDocument';

interface BudgetEconomicSummaryProps {
    costBreakdown: BudgetCostBreakdown;
    executionMode: ExecutionMode;
    budgetConfig?: BudgetConfig;
    onUpdateConfig?: (config: { marginGG?: number; marginBI?: number; tax?: number; }) => void;
    applyMarkup?: (scope: 'global' | 'chapter' | 'item', percentage: number, targetId?: string) => void;
    isReadOnly?: boolean;
    onPdfDownloaded?: (hasLead: boolean) => void;
    initialPdfMeta?: Record<string, any>;
    onSavePdfSettings?: (meta: Record<string, any>) => Promise<void>;
    items?: any;
    chapters?: any;
    clientName?: string;
    budgetNumber?: string;
    renders?: any[];
}

export const BudgetEconomicSummary = ({ 
    costBreakdown, 
    executionMode,
    budgetConfig,
    onUpdateConfig,
    applyMarkup,
    isReadOnly,
    onPdfDownloaded,
    initialPdfMeta,
    onSavePdfSettings,
    items = [],
    chapters = [],
    clientName,
    budgetNumber = 'PRE-0001',
    renders = []
}: BudgetEconomicSummaryProps) => {
    const [isEditing, setIsEditing] = useState(false);
    const [globalMarkup, setGlobalMarkup] = useState<number | ''>('');

    // PDF Config State
    const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
    const [isSavingMeta, setIsSavingMeta] = useState(false);
    const [pdfMeta, setPdfMeta] = useState({
        companyName: initialPdfMeta?.companyName || 'Reformas y Servicios S.L.',
        companyLogo: initialPdfMeta?.companyLogo || '',
        clientName: initialPdfMeta?.clientName || clientName || 'Cliente Demostración',
        clientAddress: initialPdfMeta?.clientAddress || 'Calle Ejemplo 123, Madrid',
        notes: initialPdfMeta?.notes || ''
    });

    const handleSavePdfSettings = async () => {
        if (!onSavePdfSettings) return;
        setIsSavingMeta(true);
        try {
            await onSavePdfSettings(pdfMeta);
        } finally {
            setIsSavingMeta(false);
            setIsPdfModalOpen(false);
        }
    };

    const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setPdfMeta((prev: any) => ({ ...prev, companyLogo: reader.result as string }));
            };
            reader.readAsDataURL(file);
        }
    };

    // Prevent NaN breaking translations
    const safeFormat = (num: number) => formatMoneyEUR(num);

    const toggleEdit = () => {
        setIsEditing(!isEditing);
    };

    return (
        <Card className="border-0 shadow-lg bg-white/90 dark:bg-white/5 backdrop-blur dark:border dark:border-white/10 flex flex-col h-full">
            <CardContent className="p-6 space-y-5 flex-1 flex flex-col">
                <div className="flex justify-between items-center border-b dark:border-white/10 pb-2">
                    <h3 className="font-bold text-slate-800 dark:text-white">Resumen Económico</h3>
                    {!isReadOnly && onUpdateConfig && (
                        <Button
                            variant={isEditing ? "default" : "outline"}
                            size="sm"
                            className={cn(
                                "h-8 text-xs font-semibold gap-1.5 transition-colors shadow-sm",
                                isEditing 
                                    ? "bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-zinc-900" 
                                    : "bg-white text-slate-700 hover:bg-slate-50 dark:bg-zinc-800 dark:text-slate-300 dark:border-zinc-700"
                            )}
                            onClick={toggleEdit}
                        >
                            {isEditing ? <Check className="w-3.5 h-3.5" /> : <Settings2 className="w-3.5 h-3.5 text-slate-500" />}
                            {isEditing ? 'Listo' : 'Ajustes'}
                        </Button>
                    )}
                </div>

                {isEditing ? (
                    <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="space-y-3">
                            <p className="text-xs text-slate-500 dark:text-zinc-400">
                                Modifica los márgenes e impuestos aplicados sobre el PEM.
                            </p>
                            
                            <div className="grid grid-cols-3 items-center gap-3">
                                <label htmlFor="gg-edit" className="text-xs font-medium text-slate-600 dark:text-slate-300">G. Generales</label>
                                <div className="col-span-2 relative">
                                    <Input
                                        id="gg-edit"
                                        type="number"
                                        value={Number.isNaN(budgetConfig?.marginGG) ? '' : budgetConfig?.marginGG}
                                        onChange={(e) => onUpdateConfig?.({ marginGG: Number(e.target.value) })}
                                        className="h-8 text-right pr-7 py-1 text-sm"
                                    />
                                    <span className="absolute right-3 top-1.5 text-slate-400 text-xs font-mono">%</span>
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-3 items-center gap-3">
                                <label htmlFor="bi-edit" className="text-xs font-medium text-slate-600 dark:text-slate-300">Beneficio Ind.</label>
                                <div className="col-span-2 relative">
                                    <Input
                                        id="bi-edit"
                                        type="number"
                                        value={Number.isNaN(budgetConfig?.marginBI) ? '' : budgetConfig?.marginBI}
                                        onChange={(e) => onUpdateConfig?.({ marginBI: Number(e.target.value) })}
                                        className="h-8 text-right pr-7 py-1 text-sm"
                                    />
                                    <span className="absolute right-3 top-1.5 text-slate-400 text-xs font-mono">%</span>
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-3 items-center gap-3">
                                <label htmlFor="iva-edit" className="text-xs font-medium text-slate-600 dark:text-slate-300">IVA</label>
                                <div className="col-span-2 relative">
                                    <Input
                                        id="iva-edit"
                                        type="number"
                                        value={Number.isNaN(budgetConfig?.tax) ? '' : budgetConfig?.tax}
                                        onChange={(e) => onUpdateConfig?.({ tax: Number(e.target.value) })}
                                        className="h-8 text-right pr-7 py-1 text-sm"
                                    />
                                    <span className="absolute right-3 top-1.5 text-slate-400 text-xs font-mono">%</span>
                                </div>
                            </div>
                        </div>

                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm text-slate-600 dark:text-white/70">
                            <span>PEM</span>
                            <span className="font-mono">{safeFormat(costBreakdown.materialExecutionPrice)}</span>
                        </div>

                        <div className="flex justify-between text-sm text-slate-500 dark:text-white/50 pl-2">
                            <span>GG ({budgetConfig?.marginGG ?? 13}%)</span>
                            <span className="font-mono">{safeFormat(costBreakdown.overheadExpenses)}</span>
                        </div>

                        <div className="flex justify-between text-sm text-slate-500 dark:text-white/50 pl-2">
                            <span>BI ({budgetConfig?.marginBI ?? 6}%)</span>
                            <span className="font-mono">{safeFormat(costBreakdown.industrialBenefit)}</span>
                        </div>
                    </div>
                )}

                <div className="border-t dark:border-white/10 pt-3 space-y-2">
                    <div className="flex justify-between font-medium text-slate-700 dark:text-white/80">
                        <span>Base Imponible</span>
                        <span className="font-mono">{safeFormat(costBreakdown.materialExecutionPrice + costBreakdown.overheadExpenses + costBreakdown.industrialBenefit)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-slate-600 dark:text-white/60">
                        <span>IVA ({budgetConfig?.tax ?? 21}%)</span>
                        <span className="font-mono">{safeFormat(costBreakdown.tax)}</span>
                    </div>
                </div>

                <div className="border-t-2 border-primary/10 dark:border-amber-500/20 pt-4 pb-2 flex justify-between items-end">
                    <span className="font-bold text-lg text-primary dark:text-amber-400">Total</span>
                    <span className="font-bold text-2xl text-primary dark:text-amber-400 font-mono tracking-tight">{safeFormat(costBreakdown.total)}</span>
                </div>

                <div className="py-2">
                    <Dialog open={isPdfModalOpen} onOpenChange={setIsPdfModalOpen}>
                        <DialogTrigger asChild>
                            <Button
                                className="w-full bg-slate-900 hover:bg-slate-800 text-white shadow-md dark:bg-white dark:text-black dark:hover:bg-slate-200"
                            >
                                <FileDown className="w-4 h-4 mr-2" />
                                Generar PDF Oficial
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-xl w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto bg-white dark:bg-zinc-950 border-slate-200 dark:border-zinc-800 p-6 sm:p-8 shadow-2xl">
                            <DialogTitle className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Configuración del Documento PDF</DialogTitle>
                            <div className="space-y-5 py-2">
                                <div className="space-y-2">
                                    <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Empresa Emisora</label>
                                    <Input value={pdfMeta.companyName} onChange={e => setPdfMeta((prev: any) => ({ ...prev, companyName: e.target.value }))} placeholder="Nombre de tu empresa" className="h-11 bg-slate-50 dark:bg-zinc-900/50 border-slate-200 dark:border-zinc-800 focus-visible:ring-indigo-500 dark:focus-visible:ring-indigo-500" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Logo de Empresa</label>
                                    <div className="flex items-center gap-4">
                                        {pdfMeta.companyLogo ? (
                                            <div className="relative group">
                                                <img src={pdfMeta.companyLogo} alt="Logo" className="h-12 w-auto object-contain rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1" />
                                                <button
                                                    onClick={() => setPdfMeta((prev: any) => ({ ...prev, companyLogo: '' }))}
                                                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 focus:outline-none"
                                                    title="Eliminar logo"
                                                >
                                                    <Trash className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex-1">
                                                <Input
                                                    type="file"
                                                    accept="image/*"
                                                    onChange={handleLogoUpload}
                                                    className="h-11 bg-slate-50 dark:bg-zinc-900/50 border-slate-200 dark:border-zinc-800 text-sm cursor-pointer file:mr-4 file:py-1.5 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-indigo-50 file:text-indigo-700 dark:file:bg-indigo-900/30 dark:file:text-indigo-400 hover:file:bg-indigo-100 dark:hover:file:bg-indigo-900/50"
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                    <div className="space-y-2">
                                        <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Nombre del Cliente</label>
                                        <Input value={pdfMeta.clientName} onChange={e => setPdfMeta((prev: any) => ({ ...prev, clientName: e.target.value }))} placeholder="Nombre del cliente" className="h-11 bg-slate-50 dark:bg-zinc-900/50 border-slate-200 dark:border-zinc-800 focus-visible:ring-indigo-500" />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Dirección de la Obra</label>
                                        <Input value={pdfMeta.clientAddress} onChange={e => setPdfMeta((prev: any) => ({ ...prev, clientAddress: e.target.value }))} placeholder="Dirección de la obra" className="h-11 bg-slate-50 dark:bg-zinc-900/50 border-slate-200 dark:border-zinc-800 focus-visible:ring-indigo-500" />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Notas Adicionales (Visualización PDF)</label>
                                    <textarea
                                        value={pdfMeta.notes || ''}
                                        onChange={e => setPdfMeta((prev: any) => ({ ...prev, notes: e.target.value }))}
                                        placeholder="Se incluyen 12 meses de garantía..."
                                        className="w-full h-24 p-3 text-sm bg-slate-50 dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 resize-none"
                                    />
                                </div>
                            </div>
                            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-6 mt-2 border-t border-slate-200 dark:border-zinc-800">
                                {onSavePdfSettings && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="w-full sm:w-auto order-2 sm:order-1"
                                        onClick={handleSavePdfSettings}
                                        disabled={isSavingMeta}
                                    >
                                        {isSavingMeta ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                                        Guardar Ajustes
                                    </Button>
                                )}
                                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto order-1 sm:order-2">
                                    <Button variant="outline" className="w-full sm:w-auto" onClick={() => setIsPdfModalOpen(false)}>Cancelar</Button>
                                    <PDFDownloadLink
                                        document={
                                            <BudgetDocument
                                                budgetNumber={budgetNumber}
                                                clientName={pdfMeta.clientName}
                                                clientEmail={pdfMeta.companyName}
                                                clientAddress={pdfMeta.clientAddress}
                                                logoUrl={pdfMeta.companyLogo}
                                                notes={pdfMeta.notes}
                                                items={items}
                                                costBreakdown={costBreakdown}
                                                date={new Date().toLocaleDateString('es-ES')}
                                                budgetConfig={budgetConfig}
                                                executionMode={executionMode} 
                                                renders={renders}
                                            />
                                        }
                                        fileName={`Presupuesto-${budgetNumber}.pdf`}
                                    >
                                        {({ loading }) => (
                                            <Button
                                                disabled={loading}
                                                onClick={() => {
                                                    if (!loading) {
                                                        setIsPdfModalOpen(false);
                                                        if (onPdfDownloaded) onPdfDownloaded(true);
                                                    }
                                                }}
                                                className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center justify-center gap-2"
                                            >
                                                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                                Descargar Documento
                                            </Button>
                                        )}
                                    </PDFDownloadLink>
                                </div>
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>

                {!isReadOnly && applyMarkup && (
                    <div className="mt-auto pt-6 border-t border-slate-100 dark:border-white/5">
                        <h4 className="font-medium text-xs text-slate-800 dark:text-white mb-1">Ajuste Masivo de Precios N%</h4>
                        <p className="text-[10px] text-slate-500 dark:text-zinc-400 mb-3 leading-tight">
                            Aplica un incremento o descuento a todas las partidas del presupuesto.
                        </p>
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <Input
                                    id="n_percent_summary"
                                    type="number"
                                    placeholder="Ej. 10 o -5"
                                    value={globalMarkup}
                                    onChange={(e) => setGlobalMarkup(e.target.value === '' ? '' : Number(e.target.value))}
                                    className="h-8 text-right pr-7 text-sm"
                                />
                                <span className="absolute right-3 top-1.5 text-slate-400 text-xs font-mono">%</span>
                            </div>
                            <Button
                                size="sm"
                                className="h-8 px-3"
                                onClick={() => {
                                    if (applyMarkup && globalMarkup !== '') {
                                        applyMarkup('global', Number(globalMarkup));
                                        setGlobalMarkup('');
                                    }
                                }}
                            >
                                <ArrowRight className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { BudgetCostBreakdown } from '@/backend/budget/domain/budget';
import { BudgetConfig, ExecutionMode } from '@/types/budget-editor';
import { formatMoneyEUR } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Settings2, Check, ArrowRight, FileDown, Loader2, Download, Save, Images, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PDFDownloadLink } from '@react-pdf/renderer';
import { BudgetDocument } from '@/components/pdf/BudgetDocument';
import type { CompanyConfig } from '@/backend/platform/domain/company-config';
import { SendToClientButton } from './SendToClientButton';

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
    /** Datos de empresa emisora. Cargados desde platform/company en el wrapper padre. */
    company: CompanyConfig;
    /** F6 — Necesarios para mostrar el botón "Enviar al cliente" cuando el budget está aprobado. */
    budgetId?: string;
    budgetStatus?: 'draft' | 'pending_review' | 'approved' | 'sent';
    clientEmail?: string;
    clientAddress?: string;
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
    renders = [],
    company,
    budgetId,
    budgetStatus,
    clientEmail,
    clientAddress,
}: BudgetEconomicSummaryProps) => {
    const [isEditing, setIsEditing] = useState(false);
    const [globalMarkup, setGlobalMarkup] = useState<number | ''>('');
    // Phase 15 — desglose GG/BI oculto por defecto (markup distribuido implícitamente).
    // El aparejador puede expandir para auditoría interna.
    const [showBreakdown, setShowBreakdown] = useState(false);

    // Phase 16.B — el logo se persiste como data URL base64 directamente en
    // companyConfig.logoUrl (ver `handleLogoUpload` en settings/company). Esto
    // elimina dependencia de Firebase Storage rules + CORS para el PDF.
    // Si por algún motivo company.logoUrl es una URL externa (legacy), hacemos
    // pre-fetch defensivo a base64 para evitar fallos silenciosos en
    // `@react-pdf/renderer`.
    const [logoForPdf, setLogoForPdf] = useState<string | undefined>(
        company.logoUrl?.startsWith('data:') ? company.logoUrl : undefined
    );
    useEffect(() => {
        let cancelled = false;
        const url = company.logoUrl;
        if (!url) {
            setLogoForPdf(undefined);
            return;
        }
        if (url.startsWith('data:')) {
            setLogoForPdf(url);
            return;
        }
        // Legacy: URL externa (Firebase Storage, etc.). Pre-fetch a data URL.
        (async () => {
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const blob = await res.blob();
                const reader = new FileReader();
                reader.onloadend = () => {
                    if (!cancelled && typeof reader.result === 'string') {
                        setLogoForPdf(reader.result);
                    }
                };
                reader.readAsDataURL(blob);
            } catch (err) {
                console.warn('[BudgetEconomicSummary] No se pudo precargar el logo para PDF:', err);
                if (!cancelled) setLogoForPdf(undefined);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [company.logoUrl]);

    // Versión "PDF-ready" del company config — fuerza data URL para el logo.
    const companyForPdf = logoForPdf
        ? { ...company, logoUrl: logoForPdf }
        : { ...company, logoUrl: undefined };

    // PDF Config State
    const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
    const [isSavingMeta, setIsSavingMeta] = useState(false);
    const [pdfMeta, setPdfMeta] = useState({
        clientName: initialPdfMeta?.clientName || clientName || '',
        clientAddress: initialPdfMeta?.clientAddress || '',
        notes: initialPdfMeta?.notes || '',
    });

    // Anexo visual (antes/después) — opcional, se decide aquí
    const [includeRenders, setIncludeRenders] = useState<boolean>(
        Boolean(initialPdfMeta?.includeRendersInPdf ?? false)
    );
    const [selectedRenderIds, setSelectedRenderIds] = useState<string[]>(
        Array.isArray(initialPdfMeta?.selectedRenderIds) ? initialPdfMeta.selectedRenderIds : []
    );

    const toggleRenderSelected = (id: string) => {
        setSelectedRenderIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };
    const selectAllRenders = () => setSelectedRenderIds(renders.map((r: any) => r.id));
    const clearRenders = () => setSelectedRenderIds([]);

    const handleSavePdfSettings = async () => {
        if (!onSavePdfSettings) return;
        setIsSavingMeta(true);
        try {
            await onSavePdfSettings({
                ...pdfMeta,
                includeRendersInPdf: includeRenders,
                selectedRenderIds,
            });
        } finally {
            setIsSavingMeta(false);
            setIsPdfModalOpen(false);
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
                        {/* Phase 15 — desglose oculto por defecto. Toggle para auditoría. */}
                        {showBreakdown ? (
                            <>
                                <div className="flex justify-between text-sm text-slate-600 dark:text-white/70">
                                    <span>PEM (raw, sin markup)</span>
                                    <span className="font-mono">{safeFormat(costBreakdown.materialExecutionPrice)}</span>
                                </div>
                                <div className="flex justify-between text-sm text-slate-500 dark:text-white/50 pl-2">
                                    <span>GG ({budgetConfig?.marginGG ?? 10}%)</span>
                                    <span className="font-mono">{safeFormat(costBreakdown.overheadExpenses)}</span>
                                </div>
                                <div className="flex justify-between text-sm text-slate-500 dark:text-white/50 pl-2">
                                    <span>BI ({budgetConfig?.marginBI ?? 15}%)</span>
                                    <span className="font-mono">{safeFormat(costBreakdown.industrialBenefit)}</span>
                                </div>
                            </>
                        ) : null}
                        <button
                            type="button"
                            onClick={() => setShowBreakdown(v => !v)}
                            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-white/70 transition-colors"
                        >
                            {showBreakdown ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            {showBreakdown ? 'Ocultar desglose' : 'Ver desglose PEM + GG + BI'}
                        </button>
                    </div>
                )}

                <div className="border-t dark:border-white/10 pt-3 space-y-2">
                    <div className="flex justify-between items-center font-medium text-slate-700 dark:text-white/80">
                        <span className="flex items-center gap-1.5">
                            Base Imponible
                            <span
                                className="cursor-help"
                                title={`Incluye GG ${budgetConfig?.marginGG ?? 10}% + BI ${budgetConfig?.marginBI ?? 15}% distribuidos equitativamente entre partidas (markup implícito sobre raw PEM).`}
                            >
                                <Info className="w-3 h-3 text-slate-400" />
                            </span>
                        </span>
                        <span className="font-mono">{safeFormat(costBreakdown.materialExecutionPrice + costBreakdown.overheadExpenses + costBreakdown.industrialBenefit)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-slate-600 dark:text-white/60">
                        <span>IVA ({budgetConfig?.tax ?? 10}%)</span>
                        <span className="font-mono">{safeFormat(costBreakdown.tax)}</span>
                    </div>
                </div>

                <div className="border-t-2 border-primary/10 dark:border-amber-500/20 pt-4 pb-2 flex justify-between items-end">
                    <span className="font-bold text-lg text-primary dark:text-amber-400">Total</span>
                    <span className="font-bold text-2xl text-primary dark:text-amber-400 font-mono tracking-tight">{safeFormat(costBreakdown.total)}</span>
                </div>

                {budgetStatus === 'approved' && budgetId && clientEmail && (
                    <div className="py-2">
                        <SendToClientButton
                            budgetId={budgetId}
                            budgetNumber={budgetNumber}
                            clientName={pdfMeta.clientName || clientName || 'Cliente'}
                            clientEmail={clientEmail}
                            clientAddress={pdfMeta.clientAddress || clientAddress}
                            items={items}
                            costBreakdown={costBreakdown}
                            company={companyForPdf}
                            executionMode={executionMode}
                            notes={pdfMeta.notes}
                            renders={renders}
                            selectedRenderIds={includeRenders ? selectedRenderIds : []}
                            budgetConfig={budgetConfig}
                        />
                    </div>
                )}

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
                                <div className="flex items-center gap-3 p-3 rounded-md bg-slate-50 dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800">
                                    {company.logoUrl && (
                                        <img src={company.logoUrl} alt={company.name} className="h-10 w-auto object-contain" />
                                    )}
                                    <div className="text-sm">
                                        <p className="font-semibold text-slate-800 dark:text-slate-100">{company.name}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                            Emisor · editar en <a href="/dashboard/settings/company" className="underline underline-offset-2">Ajustes › Empresa</a>
                                        </p>
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

                                {/* Anexo visual — antes/después opcional */}
                                <div className="space-y-3 rounded-md border border-slate-200 dark:border-zinc-800 p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-start gap-2">
                                            <Images className="w-4 h-4 text-slate-500 mt-0.5" />
                                            <div>
                                                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Incluir renders antes/después</p>
                                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                                    {renders.length === 0
                                                        ? 'No hay renders generados. Ve a la pestaña Imágenes IA para crear uno.'
                                                        : `Añade un anexo visual al final del PDF. ${renders.length} render(s) disponibles.`}
                                                </p>
                                            </div>
                                        </div>
                                        <Switch
                                            checked={includeRenders}
                                            disabled={renders.length === 0}
                                            onCheckedChange={(v) => {
                                                setIncludeRenders(v);
                                                if (v && selectedRenderIds.length === 0) {
                                                    setSelectedRenderIds(renders.map((r: any) => r.id));
                                                }
                                            }}
                                        />
                                    </div>

                                    {includeRenders && renders.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <p className="text-xs text-slate-500">
                                                    {selectedRenderIds.length} de {renders.length} seleccionados
                                                </p>
                                                <div className="flex gap-2">
                                                    <button type="button" onClick={selectAllRenders} className="text-xs text-indigo-600 hover:underline">Todos</button>
                                                    <button type="button" onClick={clearRenders} className="text-xs text-slate-500 hover:underline">Ninguno</button>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                                                {renders.map((r: any) => {
                                                    const selected = selectedRenderIds.includes(r.id);
                                                    return (
                                                        <button
                                                            type="button"
                                                            key={r.id}
                                                            onClick={() => toggleRenderSelected(r.id)}
                                                            className={cn(
                                                                'relative aspect-square rounded-md overflow-hidden border-2 transition',
                                                                selected
                                                                    ? 'border-indigo-500 ring-2 ring-indigo-500/30'
                                                                    : 'border-slate-200 dark:border-zinc-800 hover:border-slate-400'
                                                            )}
                                                        >
                                                            <img src={r.url} alt={r.roomType} className="w-full h-full object-cover" />
                                                            {selected && (
                                                                <div className="absolute top-1 right-1 bg-indigo-500 text-white rounded-full p-0.5">
                                                                    <Check className="w-3 h-3" />
                                                                </div>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
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
                                                clientEmail={''}
                                                clientAddress={pdfMeta.clientAddress}
                                                notes={pdfMeta.notes}
                                                items={items}
                                                costBreakdown={costBreakdown}
                                                date={new Date().toLocaleDateString('es-ES')}
                                                budgetConfig={budgetConfig}
                                                executionMode={executionMode}
                                                renders={renders}
                                                selectedRenderIds={includeRenders ? selectedRenderIds : []}
                                                company={companyForPdf}
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

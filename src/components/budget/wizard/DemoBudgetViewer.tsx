'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, CheckCircle2, ChevronDown, Download, Building2, User, Loader2, UploadCloud, Receipt, Eye, Trash2, Edit2, Check, X, Sparkles, Cpu, ThumbsUp, ThumbsDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DemoBudgetDocument } from '@/components/pdf/DemoBudgetDocument';
import { cn } from '@/lib/utils';
import { Budget } from '@/backend/budget/domain/budget';
import { useTranslations } from 'next-intl';
import { Logo } from '@/components/logo';
import { sileo } from 'sileo';
import { savePublicDemoFeedbackAction } from '@/actions/budget/public-feedback.action';
import { useTransition } from 'react';

/** European price format: 1.250,50 € */
function formatEUR(value: number): string {
    return value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

interface DemoBudgetViewerProps {
    budgetData: Budget;
    onDownloadPdf: (customData: CustomPdfData) => Promise<void>;
    isGeneratingPdf: boolean;
}

export interface CustomPdfData {
    companyName: string;
    cif: string;
    address: string;
    clientName: string;
    logoFile: File | null;
}

export function DemoBudgetViewer({ budgetData, onDownloadPdf, isGeneratingPdf }: DemoBudgetViewerProps) {
    const t = useTranslations('budgetRequest.demoViewer');

    // Default open first chapter
    const defaultExpanded: Record<string, boolean> = {};
    if (budgetData.chapters.length > 0) {
        defaultExpanded[budgetData.chapters[0].id] = true;
    }

    const [expandedChapters, setExpandedChapters] = useState<Record<string, boolean>>(defaultExpanded);
    const [editableItems, setEditableItems] = useState<Record<string, { quantity: number; price: number }>>({});

    // UX Enhancements: Local state for mutation
    const [localChapters, setLocalChapters] = useState(budgetData.chapters);
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [editDescription, setEditDescription] = useState<string>('');

    // Customization Form State
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const [companyName, setCompanyName] = useState('');
    const [cif, setCif] = useState('');
    const [address, setAddress] = useState('');
    const [clientName, setClientName] = useState('');
    const [logo, setLogo] = useState<File | null>(null);
    const [isGeneratingLocal, setIsGeneratingLocal] = useState(false);

    // Initialize editable items on mount
    useEffect(() => {
        const initial: Record<string, { quantity: number; price: number }> = {};
        budgetData.chapters.forEach(chapter => {
            chapter.items.forEach(item => {
                initial[item.id] = { quantity: item.quantity, price: item.unitPrice };
            });
        });
        setEditableItems(initial);
    }, [budgetData]);

    const toggleChapter = (id: string) => {
        setExpandedChapters(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const handleItemChange = (itemId: string, field: 'quantity' | 'price', value: string) => {
        const numValue = parseFloat(value) || 0;
        setEditableItems(prev => ({
            ...prev,
            [itemId]: {
                ...prev[itemId] || { quantity: 0, price: 0 },
                [field]: value === '' ? 0 : numValue
            }
        }));
    };

    const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setLogo(e.target.files[0]);
        }
    };

    const handleDeleteItem = (chapterId: string, itemId: string) => {
        setLocalChapters(prev => prev.map(ch => {
            if (ch.id === chapterId) {
                return { ...ch, items: ch.items.filter((i: any) => i.id !== itemId) };
            }
            return ch;
        }));
    };

    const handleStartEdit = (itemId: string, currentDesc: string) => {
        setEditingItemId(itemId);
        setEditDescription(currentDesc);
    };

    const handleSaveEdit = (chapterId: string, itemId: string) => {
        setLocalChapters(prev => prev.map(ch => {
            if (ch.id === chapterId) {
                return {
                    ...ch,
                    items: ch.items.map((i: any) => i.id === itemId ? { ...i, description: editDescription } : i)
                };
            }
            return ch;
        }));
        setEditingItemId(null);
    };

    const handleCancelEdit = () => {
        setEditingItemId(null);
        setEditDescription('');
    };

    const calculateTotals = () => {
        let executionMaterial = 0;
        localChapters.forEach(chapter => {
            chapter.items.forEach((item: any) => {
                const current = editableItems[item.id] || { quantity: item.quantity, price: item.unitPrice };
                executionMaterial += current.quantity * current.price;
            });
        });

        const overheadExpenses = executionMaterial * 0.13;
        const industrialBenefit = executionMaterial * 0.06;
        const subtotal = executionMaterial + overheadExpenses + industrialBenefit;
        const tax = subtotal * 0.21;
        const total = subtotal + tax;

        return { executionMaterial, subtotal, tax, total };
    };

    const totals = calculateTotals();

    const handleDownloadClick = async () => {
        setIsGeneratingLocal(true);
        try {
            const { pdf } = await import('@react-pdf/renderer');

            const pdfItems = localChapters.flatMap(chapter =>
                chapter.items.map((item: any) => {
                    const current = editableItems[item.id] || { quantity: item.quantity, price: item.unitPrice };
                    return {
                        chapter: chapter.name,
                        originalTask: item.description,
                        item: {
                            code: '',
                            description: item.description,
                            unitPrice: current.price,
                            quantity: current.quantity,
                            unit: item.unit || 'ud',
                            totalPrice: current.quantity * current.price,
                        }
                    };
                })
            );

            let logoUrl = undefined;
            if (logo) {
                logoUrl = URL.createObjectURL(logo);
            }

            const doc = (
                <DemoBudgetDocument
                    budgetNumber={`DEMO-${Math.floor(Math.random() * 10000)}`}
                    clientName={clientName || t('pdf.clientNamePlaceholder', { fallback: 'Cliente Demo' })}
                    clientEmail={companyName || 'Empresa de Demostración'}
                    clientAddress={address || ''}
                    items={pdfItems}
                    costBreakdown={{
                        materialExecutionPrice: totals.executionMaterial,
                        overheadExpenses: totals.executionMaterial * 0.13,
                        tax: totals.tax,
                        total: totals.total
                    }}
                    date={new Date().toLocaleDateString('es-ES')}
                    logoUrl={logoUrl}
                />
            );

            const asPdf = pdf(doc);
            const blob = await asPdf.toBlob();

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Presupuesto-${companyName.replace(/\s+/g, '-') || 'Demo'}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            URL.revokeObjectURL(url);
            if (logoUrl) URL.revokeObjectURL(logoUrl);

            onDownloadPdf({
                companyName,
                cif,
                address,
                clientName,
                logoFile: logo
            });

        } catch (error) {
            console.error("Error generating PDF:", error);
        } finally {
            setIsGeneratingLocal(false);
        }
    };

    return (
        <div className="w-full h-[85vh] md:h-[800px] flex flex-col lg:flex-row gap-6 p-2 md:p-6 pb-24 lg:pb-6 overflow-hidden bg-transparent text-foreground font-sans relative">
            {/* Main Editor Section */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="flex-1 flex flex-col bg-white dark:bg-zinc-950 border border-border shadow-2xl overflow-hidden rounded-2xl relative ring-1 ring-border"
            >
                {/* Header */}
                <div className="p-4 md:px-8 md:py-6 border-b border-border bg-white/95 dark:bg-zinc-950/95 backdrop-blur-xl flex justify-between items-center z-10 sticky top-0 relative">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-primary to-transparent opacity-40"></div>
                    <div>
                        <div className="mb-4">
                            <Logo className="h-6 flex items-center" width={80} height={24} />
                        </div>
                        <h2 className="text-2xl font-semibold tracking-tight text-foreground mb-1 flex items-center gap-2">
                            <Receipt className="w-5 h-5 text-primary" />
                            {t('title', { fallback: 'Borrador Interactivo' })}
                        </h2>
                        <p className="text-sm text-muted-foreground font-medium">
                            {t('description', { fallback: 'Edita unidades y precios. Los totales se actualizan en tiempo real.' })}
                        </p>
                        {budgetData.telemetry?.metrics && (
                            <div className="flex items-center gap-3 mt-3 text-xs font-mono text-muted-foreground bg-secondary/50 px-2.5 py-1.5 rounded-lg inline-flex border border-border/50 shadow-sm">
                                <span className="flex items-center gap-1" title="Tiempo de Generación IA"><Sparkles className="w-3.5 h-3.5 text-amber-500" /> {(budgetData.telemetry.metrics.generationTimeMs / 1000).toFixed(1)}s</span>
                                <span className="opacity-30">•</span>
                                <span className="flex items-center gap-1" title="Tokens IA Consumidos"><Cpu className="w-3.5 h-3.5 text-indigo-500" /> {(budgetData.telemetry.metrics.tokens.totalTokens / 1000).toFixed(1)}k tokens</span>
                                <span className="opacity-30">•</span>
                                <span className="flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400" title="Coste Estimado API">{budgetData.telemetry.metrics.costs.fiatAmount} {budgetData.telemetry.metrics.costs.fiatCurrency}</span>
                            </div>
                        )}
                    </div>
                    <div className="text-right hidden sm:block">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-1">Total Proyecto</p>
                        <p className="text-2xl font-mono text-emerald-600 dark:text-emerald-400 tracking-tight">
                            {formatEUR(totals.total)}
                        </p>
                    </div>
                </div>

                {/* Items List */}
                <div className="flex-1 overflow-y-auto custom-scrollbar scroll-smooth">
                    <div className="p-4 md:p-8 space-y-4">
                        {localChapters.map((chapter, index) => {
                            const isExpanded = expandedChapters[chapter.id];

                            // Calculate chapter total real-time
                            let chapterTotal = 0;
                            chapter.items.forEach((item: any) => {
                                const current = editableItems[item.id] || { quantity: item.quantity, price: item.unitPrice };
                                chapterTotal += current.quantity * current.price;
                            });

                            return (
                                <motion.div
                                    key={chapter.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: index * 0.1 }}
                                    className="border border-border bg-white dark:bg-zinc-950 rounded-xl overflow-hidden shadow-sm transition-all focus-within:ring-1 focus-within:ring-border"
                                >
                                    <button
                                        onClick={() => toggleChapter(chapter.id)}
                                        className="w-full flex items-center justify-between p-5 md:px-6 hover:bg-primary/[0.03] transition-colors focus:outline-none"
                                    >
                                        <div className="flex items-center gap-4 text-left">
                                            <div className="w-8 h-8 rounded bg-primary/10 border border-primary/20 flex items-center justify-center font-mono text-xs text-primary font-semibold">
                                                {(index + 1).toString().padStart(2, '0')}
                                            </div>
                                            <h3 className="font-medium text-foreground/90 text-sm tracking-wide uppercase">
                                                {chapter.name}
                                            </h3>
                                        </div>
                                        <div className="flex items-center gap-6">
                                            <div className="text-right">
                                                <span className="font-mono text-sm text-foreground/80 transition-all">
                                                    {formatEUR(chapterTotal)}
                                                </span>
                                            </div>
                                            <motion.div
                                                animate={{ rotate: isExpanded ? 180 : 0 }}
                                                transition={{ duration: 0.2 }}
                                                className="text-muted-foreground"
                                            >
                                                <ChevronDown className="w-5 h-5" />
                                            </motion.div>
                                        </div>
                                    </button>

                                    <AnimatePresence initial={false}>
                                        {isExpanded && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }}
                                            >
                                                <div className="px-2 pb-2">
                                                    <div className="bg-white dark:bg-zinc-900 rounded-lg border border-border p-1 divide-y divide-border">
                                                        {chapter.items.map((item: any) => {
                                                            const current = editableItems[item.id] || { quantity: item.quantity, price: item.unitPrice };
                                                            const itemTotal = current.quantity * current.price;
                                                            const isEditingId = editingItemId === item.id;

                                                            return (
                                                                <div key={item.id} className="group/row flex flex-col xl:flex-row xl:items-start justify-between p-3 gap-4 hover:bg-secondary/30 dark:hover:bg-white/[0.02] transition-colors rounded-md relative select-none">

                                                                    <div className="flex-1 pr-4 pt-1 xl:pt-0">
                                                                        <div className="flex flex-col gap-1.5">
                                                                            <p className="text-sm text-foreground/80 leading-relaxed font-light line-clamp-2 md:line-clamp-none transition-all pr-8 xl:pr-0">
                                                                                {item.description}
                                                                            </p>
                                                                            {/* RLHF Vote Buttons */}
                                                                            <PublicItemVote 
                                                                                budgetId={budgetData.id} 
                                                                                item={item} 
                                                                                currentPrice={current.price} 
                                                                            />
                                                                        </div>
                                                                    </div>

                                                                    <div className="flex items-center justify-between w-full mt-3 xl:mt-0 xl:w-auto gap-2 xl:gap-3 shrink-0 self-end xl:self-start xl:pt-1">
                                                                        {/* Quantity Input */}
                                                                        <div className="relative flex flex-col gap-1 items-end">
                                                                            <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">{t('table.units', { fallback: 'Cant.' })}</span>
                                                                            <span className="font-mono text-sm">
                                                                                {current.quantity} {item.unit || 'u'}
                                                                            </span>
                                                                        </div>

                                                                        <span className="text-muted-foreground font-light mt-4">×</span>

                                                                        {/* Price Input */}
                                                                        <div className="relative flex flex-col gap-1 items-end">
                                                                            <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">{t('table.price', { fallback: 'Precio' })}</span>
                                                                            <span className="font-mono text-sm">
                                                                                {formatEUR(current.price)}
                                                                            </span>
                                                                        </div>

                                                                        {/* Subtotal */}
                                                                        <div className="w-24 text-right flex flex-col gap-1 items-end ml-4">
                                                                            <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Subtotal</span>
                                                                            <span className="font-mono text-foreground/90 text-sm mt-[6px]">
                                                                                {formatEUR(itemTotal)}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            );
                        })}
                    </div>
                </div>
            </motion.div>

            {/* Sidebar Section (Desktop) */}
            <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
                className="hidden lg:flex w-full lg:w-[400px] flex-col gap-4 shrink-0"
            >
                {/* Customization Card */}
                <div className="bg-white dark:bg-zinc-950 border border-border shadow-2xl overflow-hidden rounded-2xl ring-1 ring-border p-6 flex-1 flex flex-col relative">
                    <div className="mb-6 relative z-10">
                        <h3 className="text-lg font-medium text-foreground flex items-center gap-2 mb-2">
                            <Eye className="w-4 h-4 text-muted-foreground" />
                            {t('pdf.title', { fallback: 'Personalizar Documento' })}
                        </h3>
                        <p className="text-sm text-muted-foreground font-light leading-relaxed">
                            {t('pdf.description', { fallback: 'Añade tus datos corporativos. Los cálculos actualizados se incluirán en el documento final.' })}
                        </p>
                    </div>

                    <div className="space-y-5 flex-1 overflow-y-auto custom-scrollbar pr-2 relative z-10">
                        {/* Summary Block */}
                        <div className="p-5 rounded-xl border border-border bg-white dark:bg-zinc-900 space-y-3 relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-zinc-800/10 blur-2xl rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none" />

                            <div className="flex justify-between items-end">
                                <span className="text-xs text-muted-foreground font-medium tracking-wide uppercase">{t('totals.pem', { fallback: 'P.E.M.' })}</span>
                                <span className="font-mono text-sm text-muted-foreground">{formatEUR(totals.executionMaterial)}</span>
                            </div>
                            <div className="flex justify-between items-end">
                                <span className="text-xs text-muted-foreground font-medium tracking-wide uppercase">{t('totals.tax', { fallback: 'IVA (21%)' })}</span>
                                <span className="font-mono text-sm text-muted-foreground">{formatEUR(totals.tax)}</span>
                            </div>

                            <div className="h-px w-full bg-gradient-to-r from-transparent via-border to-transparent my-4" />

                            <div className="flex justify-between items-end">
                                <span className="text-sm text-foreground/80 font-semibold tracking-wide uppercase">{t('totals.total', { fallback: 'Total' })}</span>
                                <span className="font-mono text-xl text-emerald-600 dark:text-emerald-400 tracking-tight font-medium">
                                    {formatEUR(totals.total)}
                                </span>
                            </div>
                        </div>

                        {/* Form Fields */}
                        <div className="space-y-4 pt-2">
                            <div className="space-y-2">
                                <Label htmlFor="companyName" className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">{t('pdf.companyName', { fallback: 'Empresa Emisora' })}</Label>
                                <Input
                                    id="companyName"
                                    placeholder="Nombre corporativo"
                                    value={companyName}
                                    onChange={(e) => setCompanyName(e.target.value)}
                                    className="bg-white dark:bg-zinc-900 border-border focus:border-border h-10 text-sm focus:ring-1 focus:ring-border"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="cif" className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">{t('pdf.cif', { fallback: 'CIF / NIF' })}</Label>
                                    <Input
                                        id="cif"
                                        placeholder="Ej: B12345678"
                                        value={cif}
                                        onChange={(e) => setCif(e.target.value)}
                                        className="bg-white dark:bg-zinc-900 border-border focus:border-border h-10 text-sm focus:ring-1 focus:ring-border"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="clientName" className="text-xs text-muted-foreground uppercase tracking-widest font-semibold flex items-center gap-1">
                                        <User className="w-3 h-3" />
                                        {t('pdf.clientName', { fallback: 'Cliente' })}
                                    </Label>
                                    <Input
                                        id="clientName"
                                        placeholder="Para quién..."
                                        value={clientName}
                                        onChange={(e) => setClientName(e.target.value)}
                                        className="bg-white dark:bg-zinc-900 border-border focus:border-border h-10 text-sm focus:ring-1 focus:ring-border"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="address" className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">{t('pdf.address', { fallback: 'Dirección Comercial' })}</Label>
                                <Input
                                    id="address"
                                    placeholder="Calle Principal 123..."
                                    value={address}
                                    onChange={(e) => setAddress(e.target.value)}
                                    className="bg-white dark:bg-zinc-900 border-border focus:border-border h-10 text-sm focus:ring-1 focus:ring-border"
                                />
                            </div>

                            <div className="space-y-2 pt-2">
                                <Label className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">{t('pdf.logo', { fallback: 'Logotipo (Opcional)' })}</Label>
                                <div className="relative group">
                                    <input
                                        type="file"
                                        id="logo-upload"
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                        accept="image/*"
                                        onChange={handleLogoChange}
                                    />
                                    <div className="border border-dashed border-border rounded-xl bg-white dark:bg-zinc-900 hover:bg-secondary/50 hover:border-primary/50 transition-all p-4 flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-lg bg-background border border-border flex items-center justify-center shrink-0">
                                            <UploadCloud className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-foreground/80 truncate">
                                                {logo ? logo.name : t('pdf.uploadHint', { fallback: 'Sube tu logo corporativo' })}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {logo ? 'Haz clic para cambiar' : 'PNG, JPG hasta 2MB'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Action Area */}
                    <div className="pt-6 mt-6 border-t border-border">
                        <Button
                            onClick={handleDownloadClick}
                            disabled={!companyName || !cif || !address || isGeneratingLocal || isGeneratingPdf}
                            className="w-full h-12 bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-secondary disabled:text-muted-foreground font-medium tracking-wide flex items-center gap-2 group transition-all rounded-lg"
                        >
                            {(isGeneratingLocal || isGeneratingPdf) ? (
                                <>
                                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
                                        <Loader2 className="w-4 h-4" />
                                    </motion.div>
                                    {t('pdf.generating', { fallback: 'Generando Documento...' })}
                                </>
                            ) : (
                                <>
                                    <Download className="w-4 h-4 group-hover:-translate-y-[2px] transition-transform" />
                                    {t('pdf.button', { fallback: 'Descargar Documento Listo' })}
                                </>
                            )}
                        </Button>
                        <p className="text-[10px] text-center text-muted-foreground mt-3 font-medium uppercase tracking-widest">
                            Requiere completar los datos de empresa
                        </p>
                    </div>
                </div>
            </motion.div >

            {/* Mobile Sidebar Sheet */}
            < Sheet open={isMobileSidebarOpen} onOpenChange={setIsMobileSidebarOpen} >
                <SheetContent side="bottom" className="h-[90vh] p-0 bg-transparent border-none sm:max-w-none flex flex-col">
                    <VisuallyHidden.Root><SheetTitle>Opciones de Exportación</SheetTitle></VisuallyHidden.Root>
                    <div className="bg-white dark:bg-zinc-950 border border-border shadow-2xl rounded-t-3xl ring-1 ring-border p-6 flex-1 flex flex-col overflow-hidden relative">
                        <div className="w-12 h-1.5 bg-border rounded-full mx-auto mb-4 shrink-0" />
                        <div className="mb-6 relative z-10 shrink-0">
                            <h3 className="text-lg font-medium text-foreground flex items-center gap-2 mb-2">
                                <Eye className="w-4 h-4 text-muted-foreground" />
                                {t('pdf.title', { fallback: 'Personalizar Documento' })}
                            </h3>
                            <p className="text-sm text-muted-foreground font-light leading-relaxed">
                                {t('pdf.description', { fallback: 'Añade tus datos corporativos. Los cálculos actualizados se incluirán en el documento final.' })}
                            </p>
                        </div>

                        <div className="space-y-5 flex-1 overflow-y-auto custom-scrollbar pr-2 relative z-10">
                            {/* Summary Block */}
                            <div className="p-5 rounded-xl border border-border bg-white dark:bg-zinc-900 space-y-3 relative overflow-hidden shrink-0">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-zinc-800/10 blur-2xl rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none" />

                                <div className="flex justify-between items-end">
                                    <span className="text-xs text-muted-foreground font-medium tracking-wide uppercase">{t('totals.pem', { fallback: 'P.E.M.' })}</span>
                                    <span className="font-mono text-sm text-muted-foreground">{formatEUR(totals.executionMaterial)}</span>
                                </div>
                                <div className="flex justify-between items-end">
                                    <span className="text-xs text-muted-foreground font-medium tracking-wide uppercase">{t('totals.tax', { fallback: 'IVA (21%)' })}</span>
                                    <span className="font-mono text-sm text-muted-foreground">{formatEUR(totals.tax)}</span>
                                </div>

                                <div className="h-px w-full bg-gradient-to-r from-transparent via-border to-transparent my-4" />

                                <div className="flex justify-between items-end">
                                    <span className="text-sm text-foreground/80 font-semibold tracking-wide uppercase">{t('totals.total', { fallback: 'Total' })}</span>
                                    <span className="font-mono text-xl text-emerald-600 dark:text-emerald-400 tracking-tight font-medium">
                                        {formatEUR(totals.total)}
                                    </span>
                                </div>
                            </div>

                            {/* Form Fields Mobile */}
                            <div className="space-y-4 pt-2 pb-6 shrink-0">
                                <div className="space-y-2">
                                    <Label htmlFor="companyNameMobile" className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">{t('pdf.companyName', { fallback: 'Empresa Emisora' })}</Label>
                                    <Input
                                        id="companyNameMobile"
                                        placeholder="Nombre corporativo"
                                        value={companyName}
                                        onChange={(e) => setCompanyName(e.target.value)}
                                        className="bg-white dark:bg-zinc-900 border-border focus:border-border h-10 text-sm focus:ring-1 focus:ring-border"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="cifMobile" className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">{t('pdf.cif', { fallback: 'CIF / NIF' })}</Label>
                                        <Input
                                            id="cifMobile"
                                            placeholder="Ej: B12345678"
                                            value={cif}
                                            onChange={(e) => setCif(e.target.value)}
                                            className="bg-white dark:bg-zinc-900 border-border focus:border-border h-10 text-sm focus:ring-1 focus:ring-border"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="clientNameMobile" className="text-xs text-muted-foreground uppercase tracking-widest font-semibold flex items-center gap-1">
                                            <User className="w-3 h-3" />
                                            {t('pdf.clientName', { fallback: 'Cliente' })}
                                        </Label>
                                        <Input
                                            id="clientNameMobile"
                                            placeholder="Para quién..."
                                            value={clientName}
                                            onChange={(e) => setClientName(e.target.value)}
                                            className="bg-white dark:bg-zinc-900 border-border focus:border-border h-10 text-sm focus:ring-1 focus:ring-border"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="addressMobile" className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">{t('pdf.address', { fallback: 'Dirección Comercial' })}</Label>
                                    <Input
                                        id="addressMobile"
                                        placeholder="Calle Principal 123..."
                                        value={address}
                                        onChange={(e) => setAddress(e.target.value)}
                                        className="bg-white dark:bg-zinc-900 border-border focus:border-border h-10 text-sm focus:ring-1 focus:ring-border"
                                    />
                                </div>

                                {/* Logo upload mobile */}
                                <div className="space-y-2 pt-2">
                                    <Label className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">{t('pdf.logo', { fallback: 'Logotipo (Opcional)' })}</Label>
                                    <div className="relative group">
                                        <input
                                            type="file"
                                            id="logo-upload-mobile"
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                            accept="image/*"
                                            onChange={handleLogoChange}
                                        />
                                        <div className="border border-dashed border-border rounded-xl bg-white dark:bg-zinc-900 hover:bg-secondary/50 hover:border-primary/50 transition-all p-4 flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-lg bg-background border border-border flex items-center justify-center shrink-0">
                                                <UploadCloud className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-foreground/80 truncate">
                                                    {logo ? logo.name : t('pdf.uploadHint', { fallback: 'Sube tu logo corporativo' })}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {logo ? 'Haz clic para cambiar' : 'PNG, JPG hasta 2MB'}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Action Area */}
                        <div className="pt-4 mt-2 border-t border-border shrink-0">
                            <Button
                                onClick={handleDownloadClick}
                                disabled={!companyName || !cif || !address || isGeneratingLocal || isGeneratingPdf}
                                className="w-full h-12 bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-secondary disabled:text-muted-foreground font-medium tracking-wide flex items-center gap-2 group transition-all rounded-lg"
                            >
                                {(isGeneratingLocal || isGeneratingPdf) ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        {t('pdf.generating', { fallback: 'Generando Documento...' })}
                                    </>
                                ) : (
                                    <>
                                        <Download className="w-4 h-4" />
                                        {t('pdf.button', { fallback: 'Descargar Documento Listo' })}
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                </SheetContent>
            </Sheet>

            {/* Fixed Bottom Bar (Mobile) */}
            <div className="lg:hidden fixed bottom-6 left-4 right-4 bg-white dark:bg-zinc-950 border border-border shadow-2xl rounded-2xl p-4 z-50 flex items-center justify-between pointer-events-auto">
                <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-0.5">Total Proyecto</p>
                    <p className="text-lg text-emerald-600 dark:text-emerald-400 tracking-tight font-medium leading-none">
                        {formatEUR(totals.total)}
                    </p>
                </div>
                <Button
                    onClick={() => setIsMobileSidebarOpen(true)}
                    className="h-10 bg-primary text-primary-foreground hover:bg-primary/90 font-medium px-5 rounded-xl shadow-lg"
                >
                    Exportar
                </Button>
            </div>

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(255,255,255,0.1);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(255,255,255,0.2);
                }
                input[type='number']::-webkit-inner-spin-button, 
                input[type='number']::-webkit-outer-spin-button { 
                    -webkit-appearance: none; 
                    margin: 0; 
                }
            `}</style>
        </div>
    );
}

// Inline Component for RLHF Pipeline
function PublicItemVote({ budgetId, item, currentPrice }: { budgetId: string, item: any, currentPrice: number }) {
    const [vote, setVote] = useState<'up' | 'down' | null>(null);
    const [isPending, startTransition] = useTransition();
    const [showReason, setShowReason] = useState(false);
    const [reason, setReason] = useState('');

    const handleVote = (v: 'up'|'down') => {
        if (vote) return; 
        setVote(v);
        if (v === 'up') {
            startTransition(async () => {
                await savePublicDemoFeedbackAction({
                    budgetId, itemId: item.id, description: item.description, proposedPrice: currentPrice, vote: 'up'
                });
                sileo.success({ title: "¡Gracias!", description: "Tus votos mejoran la IA en tiempo real." });
            });
        } else {
            setShowReason(true);
        }
    };

    const submitReason = () => {
        if (!reason.trim()) return;
        startTransition(async () => {
            await savePublicDemoFeedbackAction({
                budgetId, itemId: item.id, description: item.description, proposedPrice: currentPrice, vote: 'down', reason
            });
            setShowReason(false);
            sileo.success({ title: "Feedback enviado", description: "El equipo técnico analizará tu corrección." });
        });
    }

    return (
        <div className="flex items-center gap-2 mt-1 -ml-1">
            {!showReason ? (
                <>
                <Button size="sm" variant="ghost" className={cn("h-6 px-2 text-[10px] text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20", vote === 'up' && "text-emerald-700 bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-400 font-medium")} onClick={() => handleVote('up')} disabled={!!vote || isPending}>
                    <ThumbsUp className="w-3 h-3 mr-1" /> Bien Tarificado
                </Button>
                <Button size="sm" variant="ghost" className={cn("h-6 px-2 text-[10px] text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20", vote === 'down' && "text-rose-700 bg-rose-100 dark:bg-rose-900/40 dark:text-rose-400 font-medium")} onClick={() => handleVote('down')} disabled={!!vote || isPending}>
                    <ThumbsDown className="w-3 h-3 mr-1" /> IA Equivocada
                </Button>
                </>
            ) : (
                <div className="flex items-center gap-2 w-full max-w-sm ml-1">
                    <Input className="h-6 text-[11px] bg-secondary/50 border-border focus:ring-1" placeholder="Ej: Faltan horas en la partida, o es muy cara" value={reason} onChange={e=>setReason(e.target.value)} />
                    <Button size="sm" className="h-6 px-3 text-[10px]" disabled={isPending || !reason.trim()} onClick={submitReason}>
                        {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Enviar"}
                    </Button>
                </div>
            )}
        </div>
    )
}

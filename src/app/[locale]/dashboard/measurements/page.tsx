'use client';

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Upload,
    FileText,
    Loader2,
    CheckCircle2,
    AlertCircle,
    Download,
    Eye,
    X,
    Sparkles,
    Search,
    Calculator,
    Target
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn, formatCurrency } from '@/lib/utils';
import { useDropzone } from 'react-dropzone';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { createBudgetFromMeasurementsAction } from '@/actions/budget/create-budget-from-measurements.action';

type ProcessingStep = 'idle' | 'uploading' | 'extracting' | 'pricing' | 'complete' | 'error';

interface PricedItem {
    order: number;
    code?: string;
    description: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    priceBookCode?: string;
    matchConfidence: number;
    isEstimate: boolean;
    page?: number;
    chapter?: string;
    section?: string;
}

interface ProcessingResult {
    projectName?: string;
    clientName?: string;
    items: PricedItem[];
    summary: {
        totalItems: number;
        matchedItems: number;
        estimatedItems: number;
        subtotal: number;
        overheadExpenses: number;
        industrialBenefit: number;
        pemConGG: number;
        iva: number;
        total: number;
    };
}

// Group items by Chapter > Section
const groupItems = (items: PricedItem[]) => {
    const grouped: Record<string, Record<string, PricedItem[]>> = {};

    items.forEach(item => {
        const chapter = item.chapter || 'Sin Capítulo';
        const section = item.section || 'General';

        if (!grouped[chapter]) grouped[chapter] = {};
        if (!grouped[chapter][section]) grouped[chapter][section] = [];
        grouped[chapter][section].push(item);
    });

    return grouped;
};

export default function MeasurementsPage() {
    const router = useRouter();
    const { toast } = useToast();
    const [activeTab, setActiveTab] = useState<'budget' | 'raw'>('budget');

    // Processing State
    const [step, setStep] = useState<ProcessingStep>('idle');
    const [progress, setProgress] = useState(0);
    const [result, setResult] = useState<ProcessingResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [fileName, setFileName] = useState<string>('');
    const [isSaving, setIsSaving] = useState(false);

    const processFile = useCallback(async (file: File) => {
        setFileName(file.name);
        setStep('uploading');
        setProgress(10);
        setError(null);
        setResult(null);

        try {
            const formData = new FormData();
            formData.append('file', file);

            // Simulation steps for better UX perception
            setProgress(20);

            // Start progress animation
            const progressInterval = setInterval(() => {
                setProgress(prev => {
                    if (step === 'error' || step === 'complete') {
                        clearInterval(progressInterval);
                        return prev;
                    }
                    if (prev >= 90) return 90;
                    return prev + (Math.random() * 5);
                });
            }, 500);

            // Fetch request
            const response = await fetch('/api/measurements', {
                method: 'POST',
                body: formData,
            });

            clearInterval(progressInterval);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Error en el servidor');
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Error procesando el archivo');
            }

            setProgress(100);
            setStep('complete');
            setResult(data.data);

        } catch (err) {
            console.error(err);
            setStep('error');
            setError(err instanceof Error ? err.message : 'Error desconocido al procesar el archivo');
        }
    }, [step]);

    const onDrop = useCallback((acceptedFiles: File[]) => {
        if (acceptedFiles.length > 0) {
            processFile(acceptedFiles[0]);
        }
    }, [processFile]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'application/pdf': ['.pdf'],
        },
        maxFiles: 1,
    });

    const reset = () => {
        setStep('idle');
        setProgress(0);
        setResult(null);
        setError(null);
        setFileName('');
    };

    const handleSaveBudget = async () => {
        if (!result) return;

        setIsSaving(true);
        try {
            // Adapt result to PricingOutput format expected by action
            const response = await createBudgetFromMeasurementsAction(
                result as any,
                fileName
            );

            if (response.success && response.budgetId) {
                toast({
                    title: "Presupuesto creado",
                    description: "Redirigiendo al editor...",
                });
                router.push(`/dashboard/admin/budgets/${response.budgetId}/edit`);
            } else {
                throw new Error(response.error || "Error al crear presupuesto");
            }
        } catch (error) {
            console.error(error);
            toast({
                title: "Error",
                description: "No se pudo guardar el presupuesto.",
                variant: "destructive"
            });
            setIsSaving(false);
        }
    };

    const groupedItems = result ? groupItems(result.items) : {};

    return (
        <div className="min-h-screen bg-transparent p-6 space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="text-center space-y-4 max-w-2xl mx-auto">
                <div className="inline-flex items-center justify-center p-3 bg-amber-500/10 rounded-full mb-4">
                    <Sparkles className="h-6 w-6 text-amber-500" />
                </div>
                <h1 className="text-4xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-amber-500 to-orange-600">
                    Procesador Inteligente de Mediciones
                </h1>
                <p className="text-lg text-muted-foreground">
                    Transforma tus PDFs de mediciones en presupuestos valorados automáticamente mediante IA Híbrida y Búsqueda Vectorial.
                </p>
            </div>

            {/* Upload Area / Progress */}
            <div className="max-w-4xl mx-auto">
                <AnimatePresence mode="wait">
                    {step === 'idle' && (
                        <motion.div
                            key="upload"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.3 }}
                        >
                            <Card className="border-dashed border-2 hover:border-amber-500/50 transition-colors bg-card/50 backdrop-blur-sm">
                                <CardContent className="p-16">
                                    <div
                                        {...getRootProps()}
                                        className={cn(
                                            "flex flex-col items-center justify-center cursor-pointer transition-all",
                                            isDragActive && "scale-105"
                                        )}
                                    >
                                        <input {...getInputProps()} />
                                        <div className="h-24 w-24 rounded-3xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center mb-8 ring-4 ring-amber-500/5 shadow-xl shadow-amber-500/10">
                                            <Upload className="h-10 w-10 text-amber-500" />
                                        </div>
                                        <h3 className="text-2xl font-semibold text-foreground mb-3">
                                            {isDragActive ? 'Suelta el archivo para procesar' : 'Arrastra tu PDF de Mediciones'}
                                        </h3>
                                        <p className="text-muted-foreground mb-6 text-center max-w-sm">
                                            Soporta documentos multipágina, escaneos e imágenes. Procesamiento página por página para máxima precisión.
                                        </p>
                                        <div className="flex gap-4">
                                            <Badge variant="outline" className="px-3 py-1">PDF</Badge>
                                            <Badge variant="outline" className="px-3 py-1">Hasta 50MB</Badge>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </motion.div>
                    )}

                    {(step === 'uploading' || step === 'extracting' || step === 'pricing' || step === 'complete' && !result) && (
                        <motion.div
                            key="processing"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                        >
                            <Card className="bg-card/50 backdrop-blur-sm border-amber-500/20">
                                <CardContent className="p-16">
                                    <div className="flex flex-col items-center text-center">
                                        <div className="relative mb-8">
                                            <div className="absolute inset-0 bg-amber-500/20 blur-xl rounded-full" />
                                            <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center relative z-10 shadow-lg shadow-amber-500/30">
                                                <Loader2 className="h-10 w-10 text-white animate-spin" />
                                            </div>
                                        </div>

                                        <h3 className="text-2xl font-bold text-foreground mb-2">
                                            Analizando Documento
                                        </h3>
                                        <p className="text-muted-foreground mb-8 max-w-md">
                                            {step === 'uploading' && 'Subiendo archivo al servidor seguro...'}
                                            {step === 'extracting' && 'Extrayendo partidas página por página con Gemini Vision...'}
                                            {step === 'pricing' && 'Buscando precios en la base de datos vectorial...'}
                                            {step === 'complete' && 'Finalizando reporte...'}
                                        </p>

                                        <div className="w-full max-w-md space-y-2">
                                            <Progress value={progress} className="h-3 bg-secondary" indicatorClassName="bg-gradient-to-r from-amber-500 to-orange-600" />
                                            <div className="flex justify-between text-xs text-muted-foreground font-mono">
                                                <span>{step.toUpperCase()}</span>
                                                <span>{Math.round(progress)}%</span>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </motion.div>
                    )}

                    {step === 'error' && (
                        <motion.div
                            key="error"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                        >
                            <Card className="border-red-500/50 bg-red-500/5">
                                <CardContent className="p-12 text-center">
                                    <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-6" />
                                    <h3 className="text-xl font-bold text-foreground mb-2">
                                        Error al procesar
                                    </h3>
                                    <p className="text-muted-foreground mb-8">{error}</p>
                                    <Button onClick={reset} size="lg" variant="outline" className="border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20">
                                        Intentar de nuevo
                                    </Button>
                                </CardContent>
                            </Card>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Results */}
            {step === 'complete' && result && (
                <motion.div
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="max-w-7xl mx-auto space-y-8"
                >
                    {/* Summary Metrics */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <Card className="bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-800 border-zinc-200/50 dark:border-zinc-700/50">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground">Total Partidas</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-3xl font-bold flex items-baseline gap-2">
                                    {result.summary.totalItems}
                                    <span className="text-xs font-normal text-muted-foreground">detectadas</span>
                                </div>
                            </CardContent>
                        </Card>
                        <Card className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 border-green-200/50 dark:border-green-800/50">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-emerald-600/80 dark:text-emerald-400/80">Coincidencias (PriceBook)</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-3xl font-bold text-emerald-700 dark:text-emerald-400 flex items-baseline gap-2">
                                    {result.summary.matchedItems}
                                    <span className="text-xs font-normal text-emerald-600/60 items-center flex gap-1">
                                        <CheckCircle2 className="h-3 w-3" /> Vectors
                                    </span>
                                </div>
                            </CardContent>
                        </Card>
                        <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border-blue-200/50 dark:border-blue-800/50">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-blue-600/80 dark:text-blue-400/80">Estimaciones AI</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-3xl font-bold text-blue-700 dark:text-blue-400 flex items-baseline gap-2">
                                    {result.summary.estimatedItems}
                                    <span className="text-xs font-normal text-blue-600/60 items-center flex gap-1">
                                        <Sparkles className="h-3 w-3" /> Generated
                                    </span>
                                </div>
                            </CardContent>
                        </Card>
                        <Card className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border-amber-200/50 dark:border-amber-800/50 relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-10">
                                <Calculator className="h-16 w-16" />
                            </div>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-amber-600/80 dark:text-amber-400/80">Presupuesto Total</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-3xl font-bold text-amber-700 dark:text-amber-400">
                                    €{result.summary.total.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                                <div className="text-xs text-amber-600/60 mt-1">
                                    Incluye GG(13%) + BI(6%) + IVA(21%)
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                        <Tabs defaultValue="budget" className="w-full sm:w-[400px]" onValueChange={(v) => setActiveTab(v as any)}>
                            <TabsList className="w-full">
                                <TabsTrigger value="budget" className="flex-1">Presupuesto Detallado</TabsTrigger>
                                <TabsTrigger value="raw" className="flex-1">Vista Plana</TabsTrigger>
                            </TabsList>
                        </Tabs>

                        <div className="flex gap-2 w-full sm:w-auto">
                            <Button variant="outline" onClick={reset} className="flex-1 sm:flex-none">
                                <X className="h-4 w-4 mr-2" />
                                Nuevo Análisis
                            </Button>

                            <Button
                                className="bg-amber-500 hover:bg-amber-600 text-white flex-1 sm:flex-none"
                                onClick={handleSaveBudget}
                                disabled={isSaving}
                            >
                                {isSaving ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                    <FileText className="h-4 w-4 mr-2" />
                                )}
                                Crear Presupuesto
                            </Button>
                        </div>
                    </div>

                    {/* Detailed Content */}
                    <Card className="overflow-hidden border-zinc-200 dark:border-zinc-800 shadow-lg">
                        <CardContent className="p-0 overflow-x-auto">
                            <div className="min-w-[800px]">
                                {activeTab === 'budget' ? (
                                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                        {Object.entries(groupedItems).map(([chapterName, sections]) => (
                                            <div key={chapterName} className="bg-white dark:bg-zinc-950">
                                                <div className="bg-zinc-50/80 dark:bg-zinc-900/50 px-6 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-3">
                                                    <div className="bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded text-xs font-mono font-bold uppercase tracking-wider">
                                                        Capítulo
                                                    </div>
                                                    <h3 className="font-semibold text-lg text-foreground">{chapterName}</h3>
                                                </div>

                                                {Object.entries(sections).map(([sectionName, items]) => (
                                                    <div key={sectionName}>
                                                        {sectionName !== 'General' && sectionName !== 'undefined' && (
                                                            <div className="px-6 py-2 bg-zinc-50/30 dark:bg-zinc-900/20 text-sm font-medium text-muted-foreground border-b border-zinc-50 dark:border-zinc-800/50 pl-10 flex items-center gap-2">
                                                                <div className="h-1 w-1 rounded-full bg-zinc-400" />
                                                                {sectionName}
                                                            </div>
                                                        )}

                                                        <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                                                            {items.map((item, idx) => (
                                                                <div key={idx} className="group hover:bg-amber-50/30 dark:hover:bg-amber-900/5 transition-colors grid grid-cols-12 gap-4 px-6 py-4 items-start">
                                                                    <div className="col-span-1 text-xs text-muted-foreground font-mono pt-1">
                                                                        {item.code || `#${item.order}`}
                                                                    </div>
                                                                    <div className="col-span-6">
                                                                        <p className="text-sm text-foreground font-medium leading-relaxed">
                                                                            {item.description}
                                                                        </p>
                                                                        <div className="flex gap-2 mt-2">
                                                                            {item.priceBookCode && (
                                                                                <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 border-green-200 dark:border-green-800">
                                                                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                                                                    {item.priceBookCode}
                                                                                </Badge>
                                                                            )}
                                                                            {item.page && (
                                                                                <Badge variant="outline" className="text-[10px] h-5 px-1.5 opacity-60">
                                                                                    Pág {item.page}
                                                                                </Badge>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    <div className="col-span-2 text-right text-sm">
                                                                        <span className="font-mono">{item.quantity}</span>
                                                                        <span className="text-muted-foreground ml-1 text-xs">{item.unit}</span>
                                                                    </div>
                                                                    <div className="col-span-1 text-right text-sm text-muted-foreground font-mono">
                                                                        {formatCurrency(item.unitPrice)}
                                                                    </div>
                                                                    <div className="col-span-2 text-right font-bold font-mono text-foreground">
                                                                        {formatCurrency(item.totalPrice)}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="divide-y dark:divide-zinc-800">
                                        <div className="bg-zinc-50 dark:bg-zinc-900 px-6 py-2 grid grid-cols-12 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                            <div className="col-span-1">Código</div>
                                            <div className="col-span-6">Descripción</div>
                                            <div className="col-span-1 text-right">Cant.</div>
                                            <div className="col-span-2 text-right">Unitario</div>
                                            <div className="col-span-2 text-right">Total</div>
                                        </div>
                                        {result.items.map((item, idx) => (
                                            <div key={idx} className="px-6 py-3 grid grid-cols-12 text-sm hover:bg-muted/50 items-center">
                                                <div className="col-span-1 font-mono text-xs text-muted-foreground">{item.code || '-'}</div>
                                                <div className="col-span-6 pr-4 line-clamp-2" title={item.description}>{item.description}</div>
                                                <div className="col-span-1 text-right font-mono">{item.quantity} {item.unit}</div>
                                                <div className="col-span-2 text-right font-mono text-muted-foreground">{formatCurrency(item.unitPrice)}</div>
                                                <div className="col-span-2 text-right font-mono font-medium">{formatCurrency(item.totalPrice)}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </motion.div>
            )}
        </div>
    );
}

'use client';

import React from 'react';
import { useBudgetEditor } from '@/hooks/use-budget-editor';
import { BudgetEditorTable } from './BudgetEditorTable';
import { BudgetEditorToolbar } from './BudgetEditorToolbar';
import { updateBudgetAction } from '@/actions/budget/update-budget.action';
import { Budget } from '@/backend/budget/domain/budget';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BudgetRequestDetails } from './BudgetRequestDetails';
import { BudgetEconomicSummary } from './BudgetEconomicSummary';
import { BudgetHealthWidget } from './BudgetHealthWidget';
import { SemanticCatalogSidebar } from './SemanticCatalogSidebar';
import { saveTrainingDeltaAction } from '@/actions/budget/save-training-delta.action';
import { RenovationGallery } from '@/components/dream-renovator/RenovationGallery';
import { BudgetRequestViewer } from './BudgetRequestViewer';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { AIThinkingTrace } from './AIThinkingTrace';
import { Menu, Sparkles, FileText, User, Home, BrainCircuit, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AssignClientModal } from './AssignClientModal';
import { getLeadPdfConfigAction } from '@/actions/lead/getLeadPdfConfigAction';
import { saveLeadPdfConfigAction } from '@/actions/lead/saveLeadPdfConfigAction';
import { BudgetEditorProvider } from './BudgetEditorContext';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from "@/components/ui/dialog";

interface BudgetEditorWrapperProps {
    budget: Budget;
    isAdmin?: boolean;
    traceData?: {
        originalPrompt: string;
        telemetry: any;
    };
}

const BudgetEditorMain = ({ budget, isAdmin, traceData }: BudgetEditorWrapperProps) => {
    const {
        state,
        updateItem,
        addItem,
        reorderItems,
        removeItem,
        duplicateItem,
        undo,
        redo,
        saveStart,
        saveSuccess,
        saveError,
        canUndo,
        canRedo,
        addChapter,
        removeChapter,
        renameChapter,
        reorderChapters,
        toggleExecutionMode,
        updateConfig,
        applyMarkup
    } = useBudgetEditor((budget as any).lineItems, budget.config);

    const { toast } = useToast();
    const router = useRouter();
    const [isGhostMode, setIsGhostMode] = React.useState(false);
    const [localPdfCount, setLocalPdfCount] = React.useState((budget as any).demoPdfsDownloaded || 0);
    const [isMobileSummaryOpen, setIsMobileSummaryOpen] = React.useState(false);
    const [isDesktopSummaryOpen, setIsDesktopSummaryOpen] = React.useState(true); // Toggle for economic summary
    const [isAddPartidaOpen, setIsAddPartidaOpen] = React.useState(false);

    // PDF Config State
    const [pdfMeta, setPdfMeta] = React.useState<any>(null);

    React.useEffect(() => {
        const fetchPdfMeta = async () => {
            if (budget.leadId && budget.leadId !== 'unassigned') {
                const meta = await getLeadPdfConfigAction(budget.leadId);
                if (meta) {
                    setPdfMeta(meta);
                }
            }
        };
        fetchPdfMeta();
    }, [budget.leadId]);

    const handleSavePdfSettings = async (meta: any) => {
        if (!budget.leadId || budget.leadId === 'unassigned') {
            setPdfMeta(meta);
            toast({
                title: "Aplicado localmente",
                description: "Los ajustes de PDF se usarán ahora, pero este presupuesto de demostración no tiene un Lead asociado para guardarlos de forma permanente."
            });
            return;
        }

        const res = await saveLeadPdfConfigAction(budget.leadId, meta);
        if (res.success) {
            setPdfMeta(meta);
            toast({
                title: "Ajustes PDF Guardados",
                description: "Los datos de la empresa emisora se han guardado para este cliente."
            });
        } else {
            setPdfMeta(meta);
            toast({
                title: "Aplicado localmente",
                description: "Se aplicarán a este PDF temporalmente, pero hubo un error al guardarlos de forma permanente (¿Lead de demo sin datos reales?)."
            });
        }
    };

    // Helper for source
    const getSourceInfo = (source?: string) => {
        switch (source) {
            case 'wizard':
                return { icon: Sparkles, label: 'Asistente IA', color: 'bg-purple-500/10 text-purple-600 border-purple-200 dark:border-purple-800 dark:text-purple-400' };
            case 'pdf_measurement':
                return { icon: FileText, label: 'Mediciones PDF', color: 'bg-amber-500/10 text-amber-600 border-amber-200 dark:border-amber-800 dark:text-amber-400' };
            default:
                return { icon: User, label: 'Manual', color: 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400' };
        }
    };

    const sourceInfo = getSourceInfo(budget.source);
    const SourceIcon = sourceInfo.icon;

    // Handle Save
    const handleSave = async () => {
        saveStart();

        // 1. Transform Editor State to Domain Model (Chapters)
        // We reconstruct the BudgetChapter[] structure from the flat State items by grouping by chapter name
        const domainChapters: any[] = state.chapters.map((chapterName, index) => {
            const chapterItems = state.items
                .filter(i => i.chapter === chapterName)
                .map((editorItem, itemIndex) => {
                    // Map Editor Item to Domain Item
                    // Ensure we persist ALL fields, including AI breakdown
                    return {
                        id: editorItem.id,
                        order: itemIndex + 1,
                        type: editorItem.type || 'PARTIDA',
                        // If it has a nested item source, use it, otherwise use root props
                        code: editorItem.item?.code || '',
                        description: editorItem.item?.description || editorItem.originalTask || '',
                        unit: editorItem.item?.unit || 'ud',
                        quantity: editorItem.item?.quantity || 1,
                        unitPrice: editorItem.item?.unitPrice || 0,
                        totalPrice: editorItem.item?.totalPrice || 0,

                        originalTask: editorItem.originalTask,
                        original_item: editorItem.original_item, // Preservar nodo OCR
                        breakdown: editorItem.item?.breakdown, // <--- Key for AI Persistence
                        note: editorItem.item?.note,
                        isRealCost: editorItem.item?.isRealCost,
                        matchConfidence: editorItem.item?.matchConfidence,
                        ai_resolution: editorItem.item?.aiResolution,
                        alternativeCandidates: editorItem.item?.alternativeCandidates,
                        needsHumanReview: editorItem.item?.needsHumanReview
                    };
                });

            return {
                id: `chap-${index}`, // Usar ID estable para evitar que cada Guardar genere un documento fantasma en Firestore
                name: chapterName,
                order: index + 1,
                items: chapterItems,
                totalPrice: chapterItems.reduce((acc: number, i: any) => acc + (i.totalPrice || 0), 0)
            };
        });

        try {
            // Is this a trace viewer (Public Demo or Admin Trace Preview)?
            const isTraceMode = !isAdmin || !!traceData;

            // Track rough edit time for telemetry
            const msSinceLoad = Date.now() - (state.lastSavedAt?.getTime() || Date.now());

            const finalJson = {
                chapters: domainChapters,
                costBreakdown: state.costBreakdown,
                totalEstimated: state.costBreakdown.total,
                financialSummary: {
                    executionOnlyTotal: state.costBreakdown.executionOnlyTotal,
                    completeTotal: state.costBreakdown.completeTotal
                },
                config: state.config
            };

            if (isTraceMode) {
                // Trace Mode: Save RLHF Telemetry delta instead of standard Budget Save
                const result = await saveTrainingDeltaAction(budget.id, finalJson, msSinceLoad);

                if (result.success) {
                    saveSuccess();
                    toast({
                        title: "Simulación Guardada",
                        description: "Los cambios han sido guardados para mejorar el motor IA en el futuro.",
                    });
                } else {
                    saveError();
                    toast({
                        title: "Error al guardar simulación",
                        description: result.error || "Ha ocurrido un error inesperado al contactar con la nube RLHF.",
                        variant: "destructive"
                    });
                }
            } else {
                // Normal User Budget Edit Pipeline
                const result = await updateBudgetAction(budget.id, finalJson as any);

                if (result.success) {
                    saveSuccess();
                    toast({
                        title: "Presupuesto guardado",
                        description: "Los cambios se han guardado correctamente.",
                    });
                } else {
                    saveError();
                    toast({
                        title: "Error al guardar",
                        description: result.error || "Ha ocurrido un error inesperado.",
                        variant: "destructive"
                    });
                }
            }
        } catch (error) {
            saveError();
            toast({
                title: "Error de conexión",
                description: "No se pudo conectar con el servidor.",
                variant: "destructive"
            });
        }
    };

    const handlePdfDownloaded = async () => {
        if (!isAdmin && budget.id) { // In demo mode, budget.id is actually the traceId
            try {
                if (budget.leadId && budget.leadId !== 'unassigned') {
                    const { markDemoPdfDownloadedAction } = await import('@/actions/lead/mark-demo-pdf-downloaded.action');
                    await markDemoPdfDownloadedAction(budget.leadId);
                    
                    // Actualizamos un poco el estado local para que el candado sea inmediato
                    (budget as any).demoPdfsDownloaded = ((budget as any).demoPdfsDownloaded || 0) + 1;
                    setLocalPdfCount((prev: number) => prev + 1);
                }

                // Background sync
                const { saveTrainingDeltaAction } = await import('@/actions/budget/save-training-delta.action');

                // Construct the final JSON the same way we do for save
                const domainChapters = state.chapters.map((chapterName, index) => {
                    const chapterItems = state.items.filter(i => i.chapter === chapterName).map((e, i) => ({
                        id: e.id, order: i + 1, type: e.type || 'PARTIDA', code: e.item?.code || '',
                        description: e.item?.description || e.originalTask || '', unit: e.item?.unit || 'ud',
                        quantity: e.item?.quantity || 1, unitPrice: e.item?.unitPrice || 0,
                        totalPrice: e.item?.totalPrice || 0, originalTask: e.originalTask, breakdown: e.item?.breakdown
                    }));
                    return { id: `chap-${index}`, name: chapterName, order: index + 1, items: chapterItems, totalPrice: chapterItems.reduce((acc: number, i: any) => acc + (i.totalPrice || 0), 0) };
                });

                const finalJson = {
                    chapters: domainChapters,
                    costBreakdown: state.costBreakdown,
                    totalEstimated: state.costBreakdown.total
                };

                await saveTrainingDeltaAction(budget.id, finalJson, 0); // Fire and forget
                console.log(`[RLHF] Captured final human JSON delta for trace ${budget.id}`);

                // Redirect user to the success page to schedule a meeting with URL state fallback
                router.push(`/es/wizard/success?leadId=${budget.leadId}`);
            } catch (error) {
                console.error('[RLHF] Failed to save telemetry delta:', error);
            }
        }
    };

    const isDemoLocked = !isAdmin && localPdfCount > 0;

    const editorContextValue = {
        state, updateItem, addItem, reorderItems, removeItem, duplicateItem, undo, redo, 
        saveStart, saveSuccess, saveError, canUndo, canRedo, addChapter, removeChapter, 
        renameChapter, reorderChapters, toggleExecutionMode, updateConfig, applyMarkup,
        isAdmin, isReadOnly: isDemoLocked, leadId: budget.leadId === 'unassigned' ? undefined : budget.leadId
    };

    return (
        <BudgetEditorProvider value={editorContextValue}>
        <div className="flex flex-col h-full bg-slate-50/50 dark:bg-transparent overflow-hidden">
            <BudgetEditorToolbar
                isReadOnly={isDemoLocked}
                hasUnsavedChanges={state.hasUnsavedChanges}
                isSaving={state.isSaving}
                canUndo={canUndo}
                canRedo={canRedo}
                onSave={handleSave}
                onUndo={undo}
                onRedo={redo}
                lastSavedAt={state.lastSavedAt}
                clientName={budget.clientSnapshot?.name || 'Cliente'}
                items={state.items}
                costBreakdown={state.costBreakdown}
                budgetNumber={budget.id.substring(0, 8)}
                showGhostMode={isGhostMode}
                onToggleGhostMode={() => setIsGhostMode(!isGhostMode)}
                isExecutionOnly={state.isExecutionOnly}
                onToggleExecutionMode={toggleExecutionMode}
                budgetConfig={state.config}
                onUpdateConfig={updateConfig}
                onAddItem={addItem}
                isStandaloneMode={!isAdmin || !!traceData}
                applyMarkup={applyMarkup}
                onOpenSummary={() => setIsMobileSummaryOpen(true)}
            />

            <main className="flex-1 w-full p-4 md:p-6 space-y-6 md:space-y-8 animate-in fade-in duration-500 pb-24 md:pb-6 overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20">

                <div className="max-w-[1600px] mx-auto w-full">
                    {/* Header Info */}
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 md:gap-6 pb-2">
                        {/* ... existing header code ... */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-3">
                                <Badge variant="outline" className={`gap-1.5 px-2.5 py-1 ${sourceInfo.color} font-medium tracking-wide`}>
                                    <SourceIcon className="w-3.5 h-3.5" />
                                    {sourceInfo.label}
                                </Badge>
                                <span className="text-xs font-mono text-muted-foreground">#{budget.id.substring(0, 8).toUpperCase()}</span>
                            </div>

                            <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold tracking-tight font-headline text-foreground flex items-center">
                                {budget.clientSnapshot?.name || 'Cliente Desconocido'}
                                {isAdmin && budget.leadId === 'unassigned' && (
                                    <AssignClientModal budgetId={budget.id} />
                                )}
                            </h1>

                            <div className="flex flex-wrap items-center gap-2 md:gap-3 text-sm text-muted-foreground pt-1">
                                <div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800/50 px-3 py-1 rounded-full border border-zinc-200 dark:border-zinc-700/50">
                                    <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                                    <span className="font-medium text-foreground">
                                        {budget.specs?.interventionType === 'total' ? 'Reforma Integral' : 'Reforma Parcial'}
                                    </span>
                                </div>

                                <span className="hidden md:inline text-muted-foreground/30">•</span>

                                <span className="capitalize flex items-center gap-1.5">
                                    <Home className="w-4 h-4 text-muted-foreground" />
                                    {budget.specs?.propertyType === 'house' ? 'Vivienda' : 'Local / Oficina'}
                                </span>

                                {budget.pricingMetadata?.uploadedFileName && (
                                    <>
                                        <span className="hidden md:inline text-muted-foreground/30">•</span>
                                        <span className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                                            <FileText className="w-4 h-4" />
                                            <span className="underline decoration-blue-300 dark:decoration-blue-700 underline-offset-4 truncate max-w-[150px]">
                                                {budget.pricingMetadata.uploadedFileName}
                                            </span>
                                        </span>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Mobile Only: Controlled Summary/Library Sheet */}
                        <div className="md:hidden">
                            <Sheet open={isMobileSummaryOpen} onOpenChange={setIsMobileSummaryOpen}>
                                <SheetContent side="right" className="w-full sm:w-[400px] overflow-y-auto">
                                    <SheetTitle className="sr-only">Menú de Resumen y Partidas</SheetTitle>
                                    <Tabs defaultValue="summary" className="w-full mt-6">
                                        <TabsList className="w-full grid grid-cols-2">
                                            <TabsTrigger value="summary">Resumen</TabsTrigger>
                                            <TabsTrigger value="library">Buscar Catálogo</TabsTrigger>
                                        </TabsList>
                                        <TabsContent value="summary" className="mt-4">
                                            <BudgetEconomicSummary 
                                                costBreakdown={state.costBreakdown} 
                                                budgetConfig={state.config} 
                                                onUpdateConfig={updateConfig}
                                                applyMarkup={applyMarkup}
                                                isReadOnly={isDemoLocked}
                                                items={state.items}
                                                chapters={state.chapters}
                                                clientName={budget.clientSnapshot?.name || 'Cliente'}
                                                budgetNumber={budget.id.substring(0, 8)}
                                                onPdfDownloaded={handlePdfDownloaded}
                                                initialPdfMeta={pdfMeta}
                                                onSavePdfSettings={handleSavePdfSettings}
                                                renders={budget.renders}
                                            />
                                        </TabsContent>
                                        <TabsContent value="library" className="mt-4">
                                            <SemanticCatalogSidebar onAddItem={addItem} />
                                        </TabsContent>
                                    </Tabs>
                                </SheetContent>
                            </Sheet>
                        </div>
                    </div>

                    <div className="flex flex-col lg:flex-row items-start gap-8">
                        {/* LEFT COLUMN: Main Content Area (Tabs) */}
                        <motion.div 
                            layout
                            className="min-w-0 flex-1 transition-all duration-300"
                        >
                            <Tabs defaultValue="editor" className="space-y-6">
                                {(isAdmin || traceData) && (
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 -mb-2 md:pb-0 md:mb-0">
                                    <div className="overflow-x-auto">
                                        <TabsList className="bg-white dark:bg-white/5 border dark:border-white/10 shadow-sm w-full md:w-auto inline-flex justify-start">
                                            <TabsTrigger value="editor" className="flex-1 md:flex-none">Editor</TabsTrigger>

                                        {isAdmin && (
                                            <TabsTrigger value="details" className="flex-1 md:flex-none">Detalles</TabsTrigger>
                                        )}

                                        {traceData && (
                                            <TabsTrigger value="rlhf" className="flex-1 md:flex-none text-indigo-600 data-[state=active]:text-indigo-800 data-[state=active]:bg-indigo-50 dark:text-indigo-400">
                                                Traza Cognitiva (RLHF)
                                            </TabsTrigger>
                                        )}

                                        {isAdmin && (
                                            <TabsTrigger value="renovation" className="flex-1 md:flex-none text-purple-600 data-[state=active]:text-purple-800 data-[state=active]:bg-purple-50">
                                                Imágenes IA 🍌
                                            </TabsTrigger>
                                        )}
                                        </TabsList>
                                    </div>
                                    
                                    <div className="flex-shrink-0 flex items-center gap-2">
                                        {!isDemoLocked && (
                                            <Dialog open={isAddPartidaOpen} onOpenChange={setIsAddPartidaOpen}>
                                                <DialogTrigger asChild>
                                                    <Button variant="outline" size="sm" className="hidden md:flex gap-1.5 h-9 border-slate-200 text-slate-700 bg-white hover:bg-slate-50 shadow-sm">
                                                        <Plus className="w-4 h-4" />
                                                        <span className="hidden xl:inline">Buscar Partidas y Materiales</span>
                                                        <span className="xl:hidden">Buscar</span>
                                                    </Button>
                                                </DialogTrigger>
                                                <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0 bg-white dark:bg-zinc-950 border-slate-200 dark:border-white/10">
                                                    <div className="p-4 border-b border-slate-200 dark:border-white/10">
                                                        <DialogTitle className="text-lg font-semibold flex items-center gap-2 text-slate-800 dark:text-white">
                                                            <Plus className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                                                            Buscar Partidas y Materiales
                                                        </DialogTitle>
                                                    </div>
                                                    <div className="flex-1 overflow-hidden p-4 bg-slate-50/50 dark:bg-zinc-900/50">
                                                        <SemanticCatalogSidebar onAddItem={(item) => {
                                                            addItem(item);
                                                        }} />
                                                    </div>
                                                </DialogContent>
                                            </Dialog>
                                        )}
                                        <BudgetHealthWidget items={state.items} variant="compact" />
                                        <Button 
                                            variant="outline" 
                                            size="sm" 
                                            className="hidden lg:flex gap-1.5 h-9" 
                                            onClick={() => setIsDesktopSummaryOpen(!isDesktopSummaryOpen)}
                                        >
                                            <FileText className="w-4 h-4" />
                                            {isDesktopSummaryOpen ? 'Ocultar Resumen' : 'Mostrar Resumen'}
                                        </Button>
                                    </div>
                                </div>
                                )}

                                <TabsContent value="editor" className="space-y-8">
                                    <BudgetEditorTable />
                                </TabsContent>

                                {isAdmin && (
                                    <TabsContent value="details">
                                        <BudgetRequestDetails data={budget.clientSnapshot as any} telemetry={budget.telemetry} />
                                    </TabsContent>
                                )}

                                {traceData && (
                                    <TabsContent value="rlhf">
                                        <div className="space-y-6 animate-in fade-in duration-300">
                                            <div className="bg-white dark:bg-[#121212] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden shadow-sm">
                                                <div className="p-4 border-b border-slate-100 dark:border-white/10">
                                                    <h3 className="font-semibold text-lg flex items-center gap-2">
                                                        <Sparkles className="w-5 h-5 text-indigo-500" />
                                                        Conversación Original / Prompt
                                                    </h3>
                                                </div>
                                                <div className="p-4 md:p-6 bg-slate-50/50 dark:bg-white/5 font-mono text-sm whitespace-pre-wrap text-slate-700 dark:text-zinc-300">
                                                    {traceData.originalPrompt || 'Sin prompt registrado.'}
                                                </div>
                                            </div>

                                            <div className="bg-white dark:bg-[#121212] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden shadow-sm">
                                                <div className="p-4 border-b border-slate-100 dark:border-white/10">
                                                    <h3 className="font-semibold text-lg flex items-center gap-2">
                                                        <BrainCircuit className="w-5 h-5 text-indigo-500" />
                                                        Telemetría Cognitiva (JSON)
                                                    </h3>
                                                </div>
                                                <div className="p-4 md:p-6 bg-slate-950 dark:bg-black/50 overflow-x-auto">
                                                    <pre className="text-xs font-mono text-indigo-300/90 leading-relaxed">
                                                        {JSON.stringify(traceData.telemetry, null, 2)}
                                                    </pre>
                                                </div>
                                            </div>
                                        </div>
                                    </TabsContent>
                                )}

                                <TabsContent value="renovation">
                                    <RenovationGallery budgetId={budget.id} renders={budget.renders} />
                                </TabsContent>
                            </Tabs>
                        </motion.div>

                        {/* RIGHT COLUMN: Summary - DESKTOP ONLY */}
                        <AnimatePresence>
                        {isDesktopSummaryOpen && (
                        <motion.div 
                            layout
                            initial={{ opacity: 0, x: 20, width: 0 }}
                            animate={{ opacity: 1, x: 0, width: 350 }}
                            exit={{ opacity: 0, x: 20, width: 0 }}
                            transition={{ duration: 0.3, ease: 'easeInOut' }}
                            className="hidden lg:block sticky top-6 space-y-6"
                        >
                            <div className="w-[350px] border border-slate-200 dark:border-white/10 rounded-xl bg-white dark:bg-white/5 overflow-hidden shadow-sm">
                                <div className="p-4 border-b border-slate-100 dark:border-white/10 bg-slate-50/50 dark:bg-white/5 flex items-center justify-between">
                                    <h3 className="font-bold text-slate-800 dark:text-white">Resumen Económico</h3>
                                </div>
                                <div className="p-4 flex-1 flex flex-col">
                                    <BudgetEconomicSummary 
                                        costBreakdown={state.costBreakdown} 
                                        budgetConfig={state.config} 
                                        onUpdateConfig={updateConfig}
                                        applyMarkup={applyMarkup}
                                        isReadOnly={isDemoLocked}
                                        items={state.items}
                                        chapters={state.chapters}
                                        clientName={budget.clientSnapshot?.name || 'Cliente'}
                                        budgetNumber={budget.id.substring(0, 8)}
                                        onPdfDownloaded={handlePdfDownloaded}
                                        initialPdfMeta={pdfMeta}
                                        onSavePdfSettings={handleSavePdfSettings}
                                        renders={budget.renders}
                                    />
                                </div>
                            </div>
                        </motion.div>
                        )}
                        </AnimatePresence>
                    </div>
                </div>
            </main>
        </div>
        </BudgetEditorProvider>
    );
};

export const BudgetEditorWrapper = ({ budget, isAdmin = false, traceData }: BudgetEditorWrapperProps) => {
    // Compatibility Layer: Migrate new 'chapters' structure to 'lineItems' for old UI components
    // pending full Phase 4 refactor.
    const legacyLineItems = React.useMemo(() => {
        // Compatibility mapper function
        const mapToLegacy = (item: any, chapterName?: string): any => {
            // If it's already in legacy format (old db records)
            if (item.item && !item.type) return { ...item, chapter: chapterName };

            // Map New Domain -> Legacy UI
            return {
                id: item.id,
                order: item.order,
                originalTask: item.originalTask || item.description,
                original_item: item.original_item, // Extraer nodo original del PDF
                type: item.type, // Pass the type (PARTIDA/MATERIAL)
                chapter: chapterName,
                item: {
                    description: item.description,
                    quantity: item.quantity,
                    unit: item.unit,
                    unitPrice: item.unitPrice,
                    totalPrice: item.totalPrice,
                    code: item.code || item.sku,
                    aiResolution: item.ai_resolution || item.aiResolution,
                    alternativeCandidates: item.alternativeCandidates || item.alternatives || [],
                    needsHumanReview: item.ai_resolution?.needs_human_review || item.needsHumanReview || false,
                    matchConfidence: item.matchConfidence,
                },
                isEditing: false,
                isDirty: false
            };
        };

        if (budget.chapters) {
            return budget.chapters.flatMap(c => c.items.map(i => {
                const legacy = mapToLegacy(i, c.name);
                // Explicitly copy breakdown if it exists in domain item
                if (legacy.item && (i as any).breakdown) {
                    legacy.item.breakdown = (i as any).breakdown;
                }
                return legacy;
            }));
        }

        // Fallback for old budgets without chapters
        // @ts-ignore
        if (budget.lineItems) return budget.lineItems.map(i => mapToLegacy(i, 'General'));

        return [];
    }, [budget]);

    // Inject the mapped items back into a compatible object
    // We cast to 'any' here temporarily because we are augmenting the Budget type with a property it no longer has
    const compatibleBudget = { ...budget, lineItems: legacyLineItems } as any;

    // If it's a Quick Budget or New Build, we use the Viewer, not the full Editor
    // UPDATE: User requested full editor for all types.
    // if (compatibleBudget.type === 'quick' || compatibleBudget.type === 'new_build') {
    //    return <BudgetRequestViewer budget={compatibleBudget} isAdmin={isAdmin} />;
    // }

    return <BudgetEditorMain budget={compatibleBudget} isAdmin={isAdmin} traceData={traceData} />;
};

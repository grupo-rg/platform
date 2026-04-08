'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Sparkles, Home, Hammer, Layers, Square, Send, Info, FileText, Image as ImageIcon, Mic, ChevronRight, CheckCircle2, ChevronDown, Bot, Loader2, PlayCircle, PlusCircle, PenTool, Paperclip, ExternalLink, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBudgetWizard, Message, ConversationThread } from './useBudgetWizard';
import { useWidgetContext } from '@/context/budget-widget-context';
import { useAudioRecorder } from '@/hooks/use-audio-recorder';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { RequirementCard } from './RequirementCard';
import { BudgetRequirement } from '@/backend/budget/domain/budget-requirements';
import { BudgetGenerationProgress, GenerationStep } from '@/components/budget/BudgetGenerationProgress';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { useTranslations } from 'next-intl';
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription, DrawerHeader } from '@/components/ui/drawer';

import { Trash2, MessageSquare, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
// removed sileo imports
import { Logo } from '@/components/logo';
import { Budget } from '@/backend/budget/domain/budget';
import { BudgetWizardTips } from './BudgetWizardTips';


export function BudgetWizardChat({ isAdmin = false, isPublicMode = false }: { isAdmin?: boolean, isPublicMode?: boolean }) {
    const t = useTranslations('home');
    const w = t.raw('basis.wizardChat');
    const {
        messages,
        input,
        setInput,
        sendMessage,
        addSystemMessage,
        state,
        setState,
        requirements,
        conversations, conversationId, isLoadingChats, startNewConversation, switchConversation, deleteConversation, resetConversation
    } = useBudgetWizard(isAdmin);
    const { leadId, closeWidget, initialPrompt, setInitialPrompt } = useWidgetContext();
    const effectiveId = isAdmin ? 'admin-user' : (leadId || 'unknown-lead');
    const { isRecording, startRecording, stopRecording, recordingTime } = useAudioRecorder();
    const router = useRouter();
    const [generationProgress, setGenerationProgress] = React.useState<{
        step: GenerationStep;
        extractedItems?: number;
        matchedItems?: number;
        currentItem?: string;
        error?: string;
        budgetId?: string;
    }>({ step: 'idle' });



    // Auto-resume generation after answering the Architect
    const [isAwaitingArchitect, setIsAwaitingArchitect] = React.useState(false);
    
    // PDF Strategy Triage
    const [pdfAwaitingStrategy, setPdfAwaitingStrategy] = useState<File | null>(null);

    // Replay logic
    const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [leadName, setLeadName] = React.useState<string | null>(null);

    // Persistent lock check from chat history
    const isLimitReached = messages.some(m => m.content.toLowerCase().includes('ya has agotado tu presupuesto gratuito'));

    useEffect(() => {
        if (isPublicMode && leadId) {
            import('@/actions/lead/dashboard.action').then(m => {
                m.getLeadByIdAction(leadId).then(L => {
                    if (L && L.personalInfo?.name) {
                        setLeadName(L.personalInfo.name.split(' ')[0]);
                    }
                }).catch(e => console.error(e));
            });
        }
    }, [isPublicMode, leadId]);

    const handleAttachmentClick = () => {
        fileInputRef.current?.click();
    };

    const [showRequirements, setShowRequirements] = useState(false);
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [isDragging, setIsDragging] = useState(false);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            setPendingFiles(prev => [...prev, ...Array.from(files)]);
        }
    };

    const handleRemovePendingFile = (index: number) => {
        setPendingFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleSubmit = async () => {
        const currentInput = input.trim();
        if ((!currentInput && pendingFiles.length === 0) || isLimitReached || state === 'uploading') return;

        if (pendingFiles.length > 0) {
            // Upload flow
            setState('uploading');
            const filesToUpload = [...pendingFiles];
            setPendingFiles([]); // clear from UI
            
            const hasPdf = filesToUpload.some(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));

            if (hasPdf) {
                 const pdfFile = filesToUpload.find(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))!;
                 setPdfAwaitingStrategy(pdfFile);
                 
                 // Simular un mini mensaje de log para que el usuario entienda
                 addSystemMessage("He detectado un PDF de mediciones. Por favor, selecciona el tipo de formato en la caja inferior para aplicar el mapeo correcto.");
                 return;
            }

            const base64Files = await Promise.all(filesToUpload.map(file => {
                return new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
            }));

            const formData = new FormData();
            filesToUpload.forEach(file => {
                formData.append('files', file);
            });

            try {
                const { processAttachmentsAction } = await import('@/actions/attachments/process-attachments.action');
                const result = await processAttachmentsAction(formData);

                if (result.success && result.analysis) {
                    const hiddenContext = `[Sistema: El usuario ha subido archivos. Análisis de visión por computadora: ${result.analysis}]`;
                    const userDisplayMessage = currentInput || "He subido estos archivos. Crea el presupuesto con ellos.";
                    
                    setInput("");
                    await sendMessage(userDisplayMessage, result.urls || base64Files, hiddenContext);
                } else {
                    console.error(result.error);
                    setState('idle');
                    setPendingFiles(filesToUpload); // restore
                }
            } catch (error) {
                console.error("Upload failed", error);
                setState('idle');
                setPendingFiles(filesToUpload); // restore
            }
        } else {
            // Text only flow
            setInput("");
            await sendMessage(currentInput);
        }
    };

    const handleConfirmPdfStrategy = async (strategy: 'INLINE' | 'ANNEXED') => {
        if (!pdfAwaitingStrategy) return;
        
        setState('processing_pdf');
        setGenerationProgress({ step: 'extracting', currentItem: "Analizando presupuesto PDF estructural..." });
        
        const formData = new FormData();
        formData.append('file', pdfAwaitingStrategy);
        setPdfAwaitingStrategy(null); // Clear triage UI

        try {
            const { extractMeasurementPdfAction } = await import('@/actions/budget/extract-measurement-pdf.action');
            const effectiveId = isAdmin ? 'admin-user' : (leadId || 'unknown-lead');
            const result = await extractMeasurementPdfAction(formData, effectiveId, strategy);

            if (result.success && result.budgetId) {
                if (result.isPending) {
                    setGenerationProgress({ step: 'extracting', currentItem: "Analizando presupuesto PDF estructural...", budgetId: result.budgetId });
                    return;
                }

                setGenerationProgress({ step: 'complete', currentItem: "¡Presupuesto Generado!" });
                const viewLink = isAdmin
                    ? `/dashboard/admin/budgets/${result.budgetId}/edit`
                    : isPublicMode ? `/demo/viewer/${result.budgetId}` : `/budget/${result.budgetId}`;

                setTimeout(() => {
                    setGenerationProgress({ step: 'idle' });
                    addSystemMessage(`¡Estado de Mediciones procesado y tasado con éxito!\n\n[Ver el resultado y Descargar](${viewLink})`);
                    setState(isPublicMode ? 'generated' : 'idle');
                }, 1500);
            } else {
                throw new Error(result.error);
            }
        } catch (error: any) {
            console.error("Fast Track PDF processing failed", error);
            setGenerationProgress({ step: 'error', error: error.message || "Error procesando el PDF." });
            setTimeout(() => setState('idle'), 3000);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setPendingFiles(prev => [...prev, ...Array.from(files)]);
        
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleMicClick = async () => {
        if (isRecording) {
            const blob = await stopRecording();
            if (blob) {
                // Create FormData
                const formData = new FormData();
                formData.append('audio', blob, 'recording.webm');

                // Optimistic UI update or loading state could go here
                setInput(w.input.transcribing);

                try {
                    const { processAudioAction } = await import('@/actions/audio/process-audio.action');
                    const result = await processAudioAction(formData);

                    if (result.success && result.transcription) {
                        // Append transcription to current input or replace it? 
                        // Let's replace for now, or append if input existed.
                        setInput(prev => prev === w.input.transcribing ? result.transcription : `${prev} ${result.transcription}`);
                    } else {
                        console.error(result.error);
                        setInput(""); // Clear loading text on error
                        // toast error
                    }
                } catch (error) {
                    console.error("Audio upload failed", error);
                    setInput("");
                }
            }
        } else {
            await startRecording();
        }
    };
    const handleReset = async () => {
        if (!leadId) return;
        if (!confirm(w.errors.resetConfirm)) return;

        setInput("Reseteando conversación...");
        try {
            const { resetConversationAction } = await import('@/actions/chat/reset-conversation.action');
            await resetConversationAction(leadId);
            window.location.reload();
        } catch (error) {
            console.error("Failed to reset:", error);
            setInput("");
        }
    };

    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom - MUST be before any conditional returns!
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages]);

    // Auto-resume generation when the Architect question is answered
    useEffect(() => {
        if (state === 'review' && isAwaitingArchitect && generationProgress.step === 'idle') {
            setIsAwaitingArchitect(false);
            handleGenerateBudget();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state, isAwaitingArchitect, generationProgress.step]);

    // Auto-send initial prompt from context if present
    const initialPromptSentRef = useRef(false);

    useEffect(() => {
        if (initialPrompt && initialPrompt.trim() !== '' && !initialPromptSentRef.current) {
            initialPromptSentRef.current = true;
            // Give the UI a tiny bit to mount then send
            setTimeout(() => {
                sendMessage(initialPrompt);
                setInitialPrompt(''); // clear so it only happens once
            }, 300);
        }
    }, [initialPrompt, sendMessage, setInitialPrompt]);

    const handleGenerateBudget = async () => {
        if (!requirements || !requirements.specs) return;

        if (!isAdmin && !leadId) {
            console.error("Lead ID missing");
            return;
        }

        // removed mobile modal handling
        setGenerationProgress({ step: 'extracting' });
        addSystemMessage(w.progress.generatingMsg);

        try {
            const detectedCount = requirements.detectedNeeds?.length || 15;
            setGenerationProgress({
                step: 'extracting',
                extractedItems: detectedCount
            });

            let result;

            if (isAdmin) {
                const { generateBudgetFromSpecsAction } = await import('@/actions/budget/generate-budget-from-specs.action');
                // Ensure specs exists, we have guarded against it above
                result = await generateBudgetFromSpecsAction(leadId, requirements as any, true);
            } else if (isPublicMode) {
                if (!leadId) return;
                const { generatePublicDemoAction } = await import('@/actions/budget/generate-public-demo.action');

                // Format history for the backend
                const chatHistory = messages.map(m => ({ role: m.role, content: m.content }));
                result = await generatePublicDemoAction(leadId, requirements as any, chatHistory);
            } else {
                if (!leadId) return;
                const { generateDemoBudgetAction } = await import('@/actions/budget/generate-demo-budget.action');
                result = await generateDemoBudgetAction(leadId, requirements);
            }

            if (result.success && result.budgetResult) {
                const typedResult: any = result;
                const budgetId = typedResult.budgetId || typedResult.budgetResult?.id;

                setGenerationProgress({
                    step: 'searching',
                    extractedItems: detectedCount,
                    currentItem: w.progress.searching,
                    budgetId: budgetId
                });

                const itemCount = typedResult.budgetResult?.chapters?.reduce((acc: number, c: any) => acc + c.items.length, 0) || 0;
                const total = typedResult.budgetResult?.costBreakdown?.total || typedResult.budgetResult?.totalEstimated || 0;

                setGenerationProgress({
                    step: 'complete',
                    extractedItems: itemCount,
                    matchedItems: itemCount
                });

                await new Promise(r => setTimeout(r, 1500));

                // Instead of breaking the chat UX with a page redirect or a massive PDF viewer,
                // we keep the immersive chat going by sending a system message with a direct link.
                const viewLink = isAdmin
                    ? `/dashboard/admin/budgets/${typedResult.budgetId}/edit`
                    : isPublicMode
                        ? `/demo/viewer/${typedResult.traceId}`
                        : `/budget/${typedResult.budgetId}`;

                setGenerationProgress({ step: 'idle' });
                addSystemMessage(`¡El presupuesto se ha generado con éxito! \n\n[Ver el resultado y Descargar](${viewLink})`);
                
                if (isPublicMode) {
                    setState('generated'); // Lock the wizard ONLY for public demo
                } else {
                    setState('idle'); // Leave open for others
                }

            } else if ((result as any).isAsking) {
                // Return to chat with the system question
                setGenerationProgress({ step: 'idle' });
                addSystemMessage((result as any).question);
                setIsAwaitingArchitect(true);
                setState('idle'); // Break the infinite generation loop
            } else {
                setGenerationProgress({
                    step: 'error',
                    error: result.error || w.errors.generateError
                });
            }
        } catch (e) {
            console.error(e);
            setGenerationProgress({
                step: 'error',
                error: w.errors.generateError
            });
        }
    };



    const handleKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();

            // Check for Admin Commands
            if (input.startsWith('/admin-claim')) {
                const parts = input.split(' ');
                const email = parts[1];
                const secret = parts[2];

                if (!email || !secret) {
                    alert("Usage: /admin-claim <email> <secret>");
                    return;
                }

                setInput("Setting admin claim...");
                try {
                    const { setAdminClaim } = await import('@/actions/debug/fix-account.action');
                    const result = await setAdminClaim(email, secret);
                    if (result.success) {
                        alert(result.message);
                        setInput("");
                    } else {
                        alert("Error: " + result.error);
                        setInput("/admin-claim " + email + " " + secret);
                    }
                } catch (err) {
                    console.error(err);
                    alert("Failed to execute command");
                }
                return;
            }

            handleSubmit();
        }
    };

    // Only show button if AI explicitly marked it as complete ('review' state)
    const showGenerateButton = state === 'review' && generationProgress.step === 'idle';



    return (
        <div className="flex flex-1 min-h-0 h-full w-full overflow-hidden md:rounded-3xl md:border md:border-white/20 bg-background md:bg-white/95 md:dark:bg-black/90 md:shadow-2xl md:backdrop-blur-2xl md:ring-1 md:ring-black/5 md:dark:ring-white/10 relative">
            {/* Admin Left Sidebar: Chat History */}
            {isAdmin && (
                <div className={cn(
                    "hidden md:flex flex-col border-r border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-zinc-900/50 h-full transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden",
                    isSidebarOpen ? "w-64" : "w-0 border-r-0 opacity-0"
                )}>
                    <div className="w-64 flex flex-col h-full">
                        <div className="p-4 border-b border-gray-100 dark:border-white/5">
                            <Button
                                onClick={startNewConversation}
                                disabled={isLoadingChats}
                                className="w-full justify-start font-medium text-sm transition-all"
                                variant="outline"
                            >
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Nuevo Chat
                            </Button>
                        </div>
                        <div className="flex-1 overflow-y-auto px-2 py-4 space-y-1 custom-scrollbar">
                            {isLoadingChats && conversations.length === 0 ? (
                                <div className="flex justify-center p-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                            ) : (
                                conversations.map(chat => (
                                    <div key={chat.id} className="group flex items-center gap-2">
                                        <button
                                            onClick={() => switchConversation(chat.id)}
                                            className={cn(
                                                "flex-1 flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors whitespace-nowrap overflow-hidden text-ellipsis",
                                                conversationId === chat.id
                                                    ? "bg-primary/10 text-primary font-medium dark:bg-primary/20"
                                                    : "text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5"
                                            )}
                                        >
                                            <MessageSquare className="w-4 h-4 shrink-0" />
                                            <span className="truncate">{chat.title || 'Conversación sin título'}</span>
                                        </button>
                                        <button
                                            onClick={() => deleteConversation(chat.id)}
                                            className={cn(
                                                "p-2 text-muted-foreground hover:text-red-500 rounded-lg opacity-0 group-hover:opacity-100 transition-all focus:opacity-100",
                                                conversationId === chat.id && "opacity-100 text-red-400"
                                            )}
                                            title="Eliminar Chat"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Middle Panel: Chat Interface */}
            {/* Added overlay active state tracking */}
            <div className={cn(
                "flex w-full flex-col relative h-full min-h-0 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] will-change-transform",
                "md:flex-1"
            )}>
                {/* Header */}
                <header className="absolute top-0 left-0 right-0 z-10 flex h-16 md:h-20 items-center justify-between px-4 md:px-8 bg-gradient-to-b from-background via-background/95 to-transparent backdrop-blur-sm transition-all duration-300">
                    <div className="flex items-center gap-3 md:gap-4">
                        {isAdmin && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                                className="mr-0 md:mr-2 text-muted-foreground hover:text-primary transition-colors hidden md:flex"
                            >
                                {isSidebarOpen ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
                            </Button>
                        )}
                        <Logo className="h-6 flex items-center" width={80} height={24} />
                    </div>

                    <div className="flex items-center gap-1">
                        {isAdmin && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={startNewConversation}
                                className="mr-2 hidden md:flex text-muted-foreground hover:text-primary transition-colors"
                            >
                                <PlusCircle className="mr-1 h-4 w-4" />
                                Nuevo Chat
                            </Button>
                        )}
                    </div>
                </header>

                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-0 custom-scrollbar relative bg-background/50 leading-relaxed px-4 md:px-6">
                    <div className="max-w-3xl mx-auto pt-20 pb-40 space-y-6 md:space-y-8 flex flex-col items-center">
                        <AnimatePresence initial={false}>
                            {messages.length > 0 && (
                                messages.map((msg, index) => (
                                    <ChatBubble key={msg.id} message={msg} isGenerating={msg.content === w.progress.generatingMsg} />
                                ))
                            )}

                            {/* In-Stream Terminal Component */}
                            {generationProgress.step !== 'idle' && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    className="flex w-full justify-start mt-6"
                                >
                                    <div className="w-full bg-[#0A0A0A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden p-1">
                                        <BudgetGenerationProgress
                                            progress={generationProgress}
                                            budgetId={(generationProgress as any).budgetId || leadId}
                                            className="shadow-none border-none rounded-xl"
                                            onComplete={(budgetId) => {
                                                const viewLink = isAdmin
                                                    ? `/dashboard/admin/budgets/${budgetId}/edit`
                                                    : isPublicMode
                                                        ? `/demo/viewer/${budgetId}` 
                                                        : `/budget/${budgetId}`;
                                                
                                                setTimeout(() => {
                                                    setGenerationProgress({ step: 'idle' });
                                                    addSystemMessage(`¡Estado de Mediciones procesado y tasado con éxito!\n\n[Ver el resultado y Descargar](${viewLink})`);
                                                    setState(isPublicMode ? 'generated' : 'idle');
                                                }, 1500);
                                            }}
                                        />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Proactive Co-Pilot Suggestions */}
                        {state === 'idle' && messages.length > 0 && generationProgress.step === 'idle' && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="flex flex-wrap gap-2 pt-2 px-4 md:px-0"
                            >
                                {!requirements.specs?.qualityLevel && (
                                    <button onClick={() => sendMessage("Quiero usar calidades altas/premium en los materiales.")} className="text-[11px] font-medium px-3 py-1.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors border border-primary/20 flex items-center gap-1.5">
                                        <Sparkles className="w-3 h-3" /> Añadir calidades premium
                                    </button>
                                )}
                                {(!requirements.detectedNeeds || requirements.detectedNeeds.length < 2) && (
                                    <button onClick={() => sendMessage("Incluye también la reforma completa del baño principal y cocina.")} className="text-[11px] font-medium px-3 py-1.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors border border-blue-500/20">
                                        Añadir baño y cocina
                                    </button>
                                )}
                                {!requirements.specs?.totalArea && (
                                    <button onClick={() => sendMessage("La superficie total aproximada es de 90m2.")} className="text-[11px] font-medium px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-white/60 hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors border border-black/5 dark:border-white/10">
                                        Definir superficie (90m2)
                                    </button>
                                )}
                            </motion.div>
                        )}

                        {state === 'uploading' && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="self-start max-w-[85%] md:max-w-[75%] rounded-2xl p-4 md:p-5 shadow-sm bg-zinc-100 dark:bg-[#2a2a2b] border border-black/5 dark:border-white/5 flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 mt-2"
                            >
                                <Loader2 className="w-5 h-5 text-primary opacity-70 animate-spin" />
                                <span className="font-medium">Subiendo archivos... por favor espera.</span>
                            </motion.div>
                        )}

                        {state === 'processing' && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="self-start max-w-[85%] md:max-w-[75%] rounded-2xl p-4 md:p-5 shadow-sm bg-zinc-100 dark:bg-[#2a2a2b] border border-black/5 dark:border-white/5 flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 mt-2"
                            >
                                <Bot className="w-5 h-5 text-primary opacity-70" />
                                <div className="flex space-x-1">
                                    <div className="w-1.5 h-1.5 bg-primary/70 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                    <div className="w-1.5 h-1.5 bg-primary/70 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                    <div className="w-1.5 h-1.5 bg-primary/70 rounded-full animate-bounce"></div>
                                </div>
                                <span className="font-medium">{w.input.analyzingText}</span>
                            </motion.div>
                        )}

                        {state === 'processing_pdf' && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="self-start max-w-[85%] md:max-w-[85%] rounded-2xl p-5 shadow-sm bg-zinc-100 dark:bg-[#2a2a2b] border border-black/5 dark:border-white/5 flex flex-col gap-4 text-sm text-gray-500 dark:text-gray-400 mt-2 border-l-4 border-l-blue-500 dark:border-l-blue-400"
                            >
                                <div className="flex items-center gap-2">
                                    <Paperclip className="w-5 h-5 text-blue-500 dark:text-blue-400 animate-pulse" />
                                    <span className="font-semibold text-blue-600 dark:text-blue-400 text-base">Procesando Documento (Tool Activa)</span>
                                </div>
                                <div className="flex items-center gap-3 ml-1 bg-white dark:bg-black/20 p-3 rounded-lg border border-black/5 dark:border-white/5">
                                    <div className="flex space-x-1 shrink-0">
                                        <div className="w-2 h-2 bg-blue-500/70 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                        <div className="w-2 h-2 bg-blue-500/70 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                        <div className="w-2 h-2 bg-blue-500/70 rounded-full animate-bounce"></div>
                                    </div>
                                    <span className="font-medium text-slate-700 dark:text-slate-300">
                                        Extrayendo información espacial con IA y emparejando precios en base de datos. Esto puede tardar hasta 1 minuto...
                                    </span>
                                </div>
                            </motion.div>
                        )}
                        
                        {/* Inline Generation Button */}
                        <AnimatePresence>
                            {showGenerateButton && generationProgress.step === 'idle' && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: 10 }}
                                    className="w-full mt-6 pointer-events-auto max-w-sm mx-auto flex justify-center"
                                >
                                    <Button
                                        onClick={handleGenerateBudget}
                                        className="w-full bg-primary hover:bg-primary/90 text-white font-bold h-12 md:h-14 md:text-base rounded-xl shadow-[0_8px_30px_rgba(var(--primary),0.3)] border border-primary/20 transition-transform active:scale-95"
                                    >
                                        <Sparkles className="mr-2 h-5 w-5 animate-pulse" />
                                        GENERAR PRESUPUESTO AHORA
                                    </Button>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <div ref={scrollRef} />
                    </div>
                </div>

                {/* Floating Input Area (Animated Layout for Zero State) */}
                <motion.div
                    layout
                    className={cn(
                        "absolute left-0 right-0 p-2 md:p-6 pointer-events-none flex flex-col items-center z-20 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]",
                        (messages.length === 0 && state === 'idle' && generationProgress.step === 'idle')
                            ? "top-1/2 -translate-y-1/2 px-4"
                            : "bottom-0 bg-gradient-to-t from-background via-background/90 to-transparent"
                    )}
                >
                    <div className="pointer-events-auto w-full max-w-3xl relative flex flex-col items-center">

                        {/* Greeting Header shown only when empty */}
                        <AnimatePresence>
                            {(messages.length === 0 && state === 'idle' && generationProgress.step === 'idle') && (
                                <motion.div
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -20, filter: 'blur(10px)' }}
                                    transition={{ duration: 0.5 }}
                                    className="w-full text-center space-y-2 mb-8 md:mb-12"
                                >
                                    <h2 className="text-3xl md:text-[40px] leading-tight font-display text-transparent bg-clip-text bg-gradient-to-r from-zinc-200 to-zinc-500">
                                        Hola{isAdmin ? ' Admin' : (leadName ? ` ${leadName}` : '')}.
                                    </h2>
                                    <h2 className="text-3xl md:text-[40px] leading-tight font-display text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-400">
                                        ¿Por dónde empezamos?
                                    </h2>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Rendering RequirementCard compactly above the input when toggled */}
                        <AnimatePresence>
                            {(requirements.specs || requirements.detectedNeeds?.length) && showRequirements && generationProgress.step === 'idle' && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 10, scale: 0.98 }}
                                    transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
                                    className="w-full mb-3 max-h-[40vh] overflow-y-auto custom-scrollbar rounded-2xl bg-[#1e1f20]/95 backdrop-blur-xl border border-white/10 shadow-2xl"
                                >
                                    <RequirementCard requirements={requirements} className="bg-transparent border-none shadow-none" />
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <motion.div layout 
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            className={cn(
                            "w-full relative flex flex-col rounded-3xl md:rounded-[2rem] bg-[#1e1f20] p-2 md:p-2.5 shadow-2xl backdrop-blur-xl transition-all duration-300",
                            isDragging && "ring-2 ring-primary bg-[#2a2b2e]",
                            generationProgress.step !== 'idle' && generationProgress.step !== 'complete' && "opacity-50 pointer-events-none grayscale"
                        )}>
                            
                            {/* Pending Files Preview Area */}
                            {pendingFiles.length > 0 && (
                                <div className="flex flex-wrap gap-2 px-3 pt-3 pb-1 animate-in fade-in slide-in-from-top-2 duration-300 ease-out">
                                    {pendingFiles.map((file, i) => {
                                        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
                                        return (
                                            <div key={i} className="relative group flex items-center gap-2.5 bg-[#2a2b2e] border border-white/5 shadow-[0_2px_10px_rgba(0,0,0,0.2)] rounded-xl py-1.5 pl-3 pr-1.5">
                                                {isPdf ? (
                                                    <FileText className="w-4 h-4 text-blue-400" />
                                                ) : (
                                                    <ImageIcon className="w-4 h-4 text-emerald-400" />
                                                )}
                                                <span className="text-[13px] font-medium text-white/90 max-w-[180px] truncate tracking-tight">{file.name}</span>
                                                <button
                                                    onClick={() => handleRemovePendingFile(i)}
                                                    className="p-1.5 rounded-full hover:bg-white/10 text-white/40 hover:text-white transition-colors ml-1"
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            <div className="flex items-end gap-2 w-full">


                            {/* Variables Toggle Button */}
                            {(requirements.specs || (requirements.detectedNeeds && requirements.detectedNeeds.length > 0)) && (
                                <div className="relative mb-0.5">
                                    {(!showRequirements && requirements.detectedNeeds && requirements.detectedNeeds.length > 0) && (
                                        <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-primary rounded-full shadow-[0_0_8px_rgba(var(--primary),0.8)] z-10 animate-pulse pointer-events-none" />
                                    )}
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setShowRequirements(!showRequirements)}
                                        className={cn(
                                            "h-12 w-12 shrink-0 rounded-xl transition-all duration-300",
                                            showRequirements
                                                ? "bg-primary/20 text-primary hover:bg-primary/30 rotate-180"
                                                : "text-gray-400 hover:text-white hover:bg-white/10"
                                        )}
                                        title="Variables del Entorno"
                                    >
                                        <Layers className="h-6 w-6" />
                                    </Button>
                                </div>
                            )}

                            {pdfAwaitingStrategy ? (
                                <motion.div 
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="flex flex-col md:flex-row gap-3 w-full py-2 px-1 items-center"
                                >
                                    <div className="w-full">
                                        <p className="text-sm font-semibold text-white/90 mb-1 px-1 flex items-center gap-2">
                                            <Layers className="w-4 h-4 text-primary" /> ¿Cómo viene estructurado tu PDF de Mediciones?
                                        </p>
                                        <div className="flex flex-col md:flex-row gap-3 w-full mt-2">
                                            <Button 
                                                onClick={() => handleConfirmPdfStrategy('INLINE')}
                                                className="flex-1 w-full h-auto py-4 px-4 justify-start text-left bg-zinc-800 hover:bg-zinc-700/80 border border-transparent hover:border-primary/50 transition-all whitespace-normal overflow-hidden group shadow-[0px_4px_20px_-10px_rgba(0,0,0,0.5)] active:scale-[0.98]"
                                            >
                                                <div className="flex flex-col w-full space-y-1">
                                                    <span className="font-semibold text-white group-hover:text-primary transition-colors text-sm">1. Estándar (Recomendado)</span>
                                                    <span className="text-xs text-white/50 font-normal leading-relaxed">Textos y mediciones en una sola línea (Documentos habituales).</span>
                                                </div>
                                            </Button>
                                            <Button 
                                                onClick={() => handleConfirmPdfStrategy('ANNEXED')}
                                                className="flex-1 w-full h-auto py-4 px-4 justify-start text-left bg-zinc-800 hover:bg-zinc-700/80 border border-transparent hover:border-blue-500/50 transition-all whitespace-normal overflow-hidden group shadow-[0px_4px_20px_-10px_rgba(0,0,0,0.5)] active:scale-[0.98]"
                                            >
                                                <div className="flex flex-col w-full space-y-1">
                                                    <span className="font-semibold text-white group-hover:text-blue-400 transition-colors text-sm">2. Cuadro Resumen (Anexado)</span>
                                                    <span className="text-xs text-white/50 font-normal leading-relaxed">Literatura compacta al inicio y desglose de mediciones al final.</span>
                                                </div>
                                            </Button>
                                        </div>
                                    </div>
                                </motion.div>
                            ) : (state as string) === 'generated' ? (
                                <div className="flex flex-col items-center justify-center w-full py-2">
                                    <Sparkles className="h-6 w-6 text-primary mb-2 animate-pulse" />
                                    <p className="text-sm font-semibold text-primary">¡Presupuesto Generado!</p>
                                    <p className="text-xs text-gray-500 text-center mt-1">Haz clic en el enlace de arriba para verlo.</p>
                                </div>
                            ) : (
                                <>
                                    <Textarea
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        placeholder="Pega aquí todo tu proyecto o escribe..."
                                        className="min-h-[100px] max-h-48 w-full resize-none border-0 border-transparent bg-transparent py-4 text-base placeholder:text-gray-500 focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none shadow-none text-gray-100 scrollbar-hide font-medium leading-relaxed"
                                        rows={1}
                                        disabled={(state as string) === 'generated' || isLimitReached || state === 'uploading'}
                                    />

                                    <div className="shrink-0 flex items-center gap-1 mb-0.5">
                                        {/* Model Indicator Pill */}
                                        <div className="hidden md:flex items-center gap-1.5 px-4 h-10 rounded-full bg-primary/10 border border-primary/20 text-xs font-semibold text-primary mr-1 hover:bg-primary/20 transition-colors cursor-pointer select-none">
                                            <Sparkles className="w-3.5 h-3.5" />
                                            Basis AI
                                        </div>

                                        <div className="relative">
                                            <input
                                                type="file"
                                                id="file-upload"
                                                multiple
                                                className="hidden"
                                                onChange={handleFileChange}
                                                accept="image/*,application/pdf"
                                            />
                                            <label
                                                htmlFor="file-upload"
                                                className="h-10 w-10 shrink-0 text-gray-400 hover:text-white rounded-full hover:bg-white/10 transition-colors flex items-center justify-center cursor-pointer"
                                                title="Adjuntar archivo"
                                            >
                                                <Paperclip className="h-5 w-5" />
                                            </label>
                                        </div>

                                        {(input.trim() || pendingFiles.length > 0) ? (
                                            <Button
                                                onClick={handleSubmit}
                                                size="icon"
                                                disabled={isLimitReached}
                                                className={cn(
                                                    "h-10 w-10 md:h-12 md:w-12 rounded-full text-white shadow-[0_0_20px_rgba(var(--primary),0.3)] transition-all duration-200 flex items-center justify-center border border-white/20",
                                                    isLimitReached ? "bg-slate-500 opacity-50 cursor-not-allowed" : "bg-primary hover:bg-primary/90 hover:scale-105 active:scale-95"
                                                )}
                                            >
                                                <Send className="h-4 w-4 md:h-5 md:w-5 ml-1" />
                                            </Button>
                                        ) : (
                                            <Button
                                                variant={isRecording ? "destructive" : "ghost"}
                                                size="icon"
                                                onClick={handleMicClick}
                                                disabled={isLimitReached}
                                                className={cn(
                                                    "h-10 w-10 md:h-12 md:w-12 rounded-full transition-all duration-200",
                                                    isRecording
                                                        ? "bg-red-500 text-white hover:bg-red-600 animate-pulse ring-4 ring-red-500/20 shadow-[0_0_20px_rgba(239,68,68,0.5)]"
                                                        : "text-gray-400 hover:text-white hover:bg-white/10"
                                                )}
                                            >
                                                {isRecording ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-5 w-5 md:h-[22px] md:w-[22px]" />}
                                            </Button>
                                        )}
                                    </div>
                                </>
                            )}
                            </div>
                        </motion.div>

                        {/* Suggestion Pills underneath */}
                        <AnimatePresence>
                            {messages.length === 0 && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: 10 }}
                                    transition={{ delay: 0.1, duration: 0.4 }}
                                    className="flex flex-wrap items-center justify-center gap-2 md:gap-3 mt-4 md:mt-6 w-full"
                                >
                                    {w.emptyState.suggestions
                                        .filter((s: any) => !(isPublicMode && s.title === 'Reforma integral'))
                                        .map((suggestion: any, i: number) => {
                                            const icons = [Home, Hammer, Layers, Sparkles];
                                            const Icon = icons[i % icons.length];
                                            return (
                                                <button
                                                    key={i}
                                                    onClick={() => {
                                                        setInput(suggestion.text);
                                                        // Focus is handled correctly by normal React flow if a ref was bound, but here updating state acts naturally
                                                    }}
                                                    className="flex items-center gap-2 px-4 py-2 bg-[#1e1f20] hover:bg-white/10 border border-white/5 rounded-full text-[11px] md:text-xs font-medium text-white/80 transition-all hover:border-white/20 active:scale-95 shadow-sm text-left leading-tight max-w-[280px]"
                                                >
                                                    <Icon className="w-4 h-4 text-white/50" />
                                                    {suggestion.title}
                                                </button>
                                            );
                                        })}
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Desktop & Mobile Generation Area Component (Moved to chat stream) */}

                        <p className="mt-3 text-center text-xs font-medium text-gray-400 dark:text-gray-600 hidden md:block pointer-events-auto">
                            {isRecording ? `${w.input.recordingInfo} ${formatTime(recordingTime)}` : w.input.keyboardHint}
                        </p>
                    </div>
                </motion.div>
            </div>



            {/* Onboarding Sidebar (Desktop) / Drawer (Mobile) */}
            <BudgetWizardTips setInput={setInput} />

        </div >
    );
}

function ChatBubble({ message, isGenerating }: { message: Message, isGenerating?: boolean }) {
    const isUser = message.role === 'user';

    return (
        <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className={cn(
                "flex w-full min-w-0 max-w-3xl mx-auto",
                isUser ? "justify-end" : "justify-start"
            )}
        >
            <div
                className={cn(
                    "relative max-w-[85%] rounded-2xl px-5 py-3.5 text-sm leading-relaxed shadow-sm overflow-hidden",
                    "break-words whitespace-pre-wrap",
                    isUser
                        ? "bg-primary text-primary-foreground rounded-br-none shadow-primary/10"
                        : isGenerating
                            ? "bg-gradient-to-r from-primary/5 to-blue-500/5 dark:from-primary/10 dark:to-blue-500/10 text-primary dark:text-blue-400 rounded-bl-none border border-primary/20 dark:border-blue-500/30 shadow-md shadow-primary/5 dark:shadow-blue-500/10 backdrop-blur-md"
                            : "bg-white dark:bg-white/10 text-slate-800 dark:text-white/90 rounded-bl-none border border-slate-100 dark:border-white/5 shadow-sm dark:backdrop-blur-md"
                )}
            >
                <div className="break-words overflow-hidden space-y-2">
                    {message.attachments && message.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                            {message.attachments.map((url, i) => {
                                const isPdf = url.startsWith('data:application/pdf') || url.toLowerCase().includes('.pdf');
                                return (
                                    <div key={i} className="relative group rounded-lg overflow-hidden border border-black/5 dark:border-white/10 bg-gray-100 dark:bg-gray-800 flex items-center justify-center p-2">
                                        {isPdf ? (
                                            <div className="flex flex-col items-center gap-2 p-4 min-w-[120px]">
                                                <ExternalLink className="w-8 h-8 text-red-500" />
                                                <span className="text-xs font-semibold">Documento PDF</span>
                                            </div>
                                        ) : (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={url}
                                                alt={`Adjunto ${i + 1}`}
                                                className="max-w-[200px] max-h-[150px] object-cover"
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {isGenerating ? (
                        <div className="flex items-center gap-3 py-1">
                            <div className="relative flex items-center justify-center w-8 h-8 rounded-xl bg-primary/20 shrink-0">
                                <Sparkles className="w-4 h-4 text-primary animate-pulse" />
                                <span className="absolute inset-0 rounded-xl animate-ping bg-primary/20 opacity-75 duration-1000"></span>
                            </div>
                            <span className="font-semibold text-primary/90 mt-0.5 animate-pulse">
                                {message.content}
                            </span>
                        </div>
                    ) : (
                        <div className="whitespace-pre-wrap">
                            {(() => {
                                const text = message.content;
                                const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
                                const parts = [];
                                let lastIndex = 0;
                                let match;

                                while ((match = linkRegex.exec(text)) !== null) {
                                    if (match.index > lastIndex) {
                                        parts.push(text.substring(lastIndex, match.index));
                                    }
                                    parts.push(
                                        <div key={match.index} className="block mt-4 mb-2">
                                            <a
                                                href={match[2]}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary text-white rounded-xl shadow-[0_4px_14px_rgba(var(--primary),0.3)] hover:scale-105 transition-all font-semibold"
                                            >
                                                <Sparkles className="w-4 h-4" />
                                                {match[1]}
                                            </a>
                                        </div>
                                    );
                                    lastIndex = match.index + match[0].length;
                                }

                                if (lastIndex < text.length) {
                                    parts.push(text.substring(lastIndex));
                                }

                                return parts.length > 0 ? parts : text;
                            })()}
                        </div>
                    )}

                    {/* Dynamic Context Pills (Extracted Info) */}
                    {message.extractedInfo && message.extractedInfo.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-black/5 dark:border-white/5">
                            {message.extractedInfo.map((info, idx) => (
                                <div key={idx} className="flex items-center gap-1.5 bg-primary/10 text-primary px-2.5 py-1 rounded-md text-[11px] font-semibold tracking-wide border border-primary/20 shadow-sm backdrop-blur-md">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    {info}
                                </div>
                            ))}
                        </div>
                    )}

                </div>
                <span className={cn(
                    "absolute -bottom-5 text-[10px] whitespace-nowrap",
                    isUser ? "right-0 text-muted-foreground/60 dark:text-white/30" : "left-0 text-muted-foreground/60 dark:text-white/30"
                )}>
                    {message.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
            </div>
        </motion.div >
    );
}

function formatTime(seconds: number) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

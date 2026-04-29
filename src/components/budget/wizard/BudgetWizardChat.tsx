'use client';

import React, { useRef, useEffect, useState } from 'react';
import Link from 'next/link';
import { v4 as uuidv4 } from 'uuid';
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
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { useTranslations } from 'next-intl';
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription, DrawerHeader } from '@/components/ui/drawer';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { Trash2, MessageSquare, PanelLeftClose, PanelLeftOpen, Pencil, Check, X as XIcon } from 'lucide-react';
// removed sileo imports
import { Logo } from '@/components/logo';
import { Budget } from '@/backend/budget/domain/budget';
import { BudgetWizardTips } from './BudgetWizardTips';
import { PhaseStepper } from './PhaseStepper';
import { BudgetSummaryBar } from './BudgetSummaryBar';
import { computeBudgetStats } from './budget-summary-stats';
import type { SubEvent } from '@/components/budget/budget-generation-events';


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
        conversations, conversationId, isLoadingChats, isLoadingMessages, startNewConversation, switchConversation, deleteConversation, renameConversation, resetConversation
    } = useBudgetWizard(isAdmin);

    // Inline edit del título de cada conversación en la sidebar.
    const [editingConvId, setEditingConvId] = React.useState<string | null>(null);
    const [editingTitle, setEditingTitle] = React.useState('');

    const beginEditConversation = (id: string, currentTitle: string) => {
        setEditingConvId(id);
        setEditingTitle(currentTitle || '');
    };
    const cancelEditConversation = () => {
        setEditingConvId(null);
        setEditingTitle('');
    };
    const saveEditConversation = async () => {
        if (!editingConvId) return;
        const trimmed = editingTitle.trim();
        if (!trimmed) {
            cancelEditConversation();
            return;
        }
        await renameConversation(editingConvId, trimmed);
        cancelEditConversation();
    };
    const { leadId, closeWidget, initialPrompt, setInitialPrompt } = useWidgetContext();
    // Si el admin llega con ?leadId=xxx (refinando un lead concreto desde el
    // detalle), todo lo que se genere se asociará a ese lead real, no al
    // 'admin-user' genérico.
    const searchParams = useSearchParams();
    const targetLeadIdFromQuery = isAdmin ? (searchParams?.get('leadId') || null) : null;
    const effectiveId = isAdmin
        ? (targetLeadIdFromQuery || 'admin-user')
        : (leadId || 'unknown-lead');
    const { isRecording, startRecording, stopRecording, recordingTime } = useAudioRecorder();
    const router = useRouter();

    // Banner del lead cuando refinamos uno concreto. Cargado lazy desde la action.
    const [refineBanner, setRefineBanner] = React.useState<{
        name: string;
        email: string;
        projectType?: string;
        city?: string;
        postalCode?: string;
        approxSquareMeters?: number;
        decision?: string;
        score?: number;
    } | null>(null);

    // Determinar el leadId asociado a la conversación activa para mostrar el
    // banner SÓLO en esa conversación. Persistimos el mapping
    // `conversationId → leadId` en localStorage al crear conversación nueva
    // (en el effect de initialPrompt más abajo).
    React.useEffect(() => {
        let leadIdForConv: string | null = null;
        if (conversationId && typeof window !== 'undefined') {
            try {
                const raw = localStorage.getItem('rg_refine_conv_lead') || '{}';
                const map = JSON.parse(raw);
                leadIdForConv = map[conversationId] || null;
            } catch {}
        }
        // Fallback: en el momento inicial (antes de que se cree la conv)
        // todavía no hay mapping; usamos el query param.
        const effectiveLeadId = leadIdForConv || (conversationId ? null : targetLeadIdFromQuery);

        if (!effectiveLeadId) {
            setRefineBanner(null);
            return;
        }
        let active = true;
        import('@/actions/lead/get-lead-brief.action').then(({ getLeadBriefAction }) => {
            getLeadBriefAction(effectiveLeadId).then(res => {
                if (!active) return;
                if (res.success && res.banner) setRefineBanner(res.banner);
            });
        });
        return () => { active = false; };
    }, [conversationId, targetLeadIdFromQuery]);
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
    
    // PDF Strategy Triage (legacy — se mantiene por si algún reset lo necesita,
    // pero la UX nueva captura la estrategia en un dropdown dentro del pill del
    // adjunto y pasa directo a procesar sin intermediar con dos botones grandes).
    const [pdfAwaitingStrategy, setPdfAwaitingStrategy] = useState<File | null>(null);
    // v006 UX: estrategia pre-seleccionada por adjunto PDF. Default 'INLINE' (la
    // más frecuente según telemetría Grupo RG).
    const [pdfStrategy, setPdfStrategy] = useState<'INLINE' | 'ANNEXED'>('INLINE');

    // Fase 10.2 — sub-events bubble-up del progress component para alimentar
    // `BudgetSummaryBar` con datos agregados (partidas, capítulos, PEM…).
    const [progressSubEvents, setProgressSubEvents] = useState<SubEvent[]>([]);

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
                 // v006 UX: la estrategia ya está pre-seleccionada en el pill del
                 // adjunto (default 'INLINE', el usuario puede cambiar a 'ANNEXED'
                 // con el dropdown antes de enviar). Vamos directo a procesar.
                 const pdfFile = filesToUpload.find(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))!;
                 setPdfAwaitingStrategy(pdfFile);
                 // Disparamos el procesamiento con el tipo ya elegido.
                 await handleConfirmPdfStrategy(pdfStrategy, pdfFile);
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

    const handleConfirmPdfStrategy = async (
        strategy: 'INLINE' | 'ANNEXED',
        fileOverride?: File,
    ) => {
        // v006 UX: el callsite nuevo pasa el `fileOverride` explícitamente porque
        // `setPdfAwaitingStrategy` es async y el state no estaría disponible
        // todavía. El callsite legacy (dos botones grandes) deja que se use la
        // variable de estado `pdfAwaitingStrategy`.
        const effectiveFile = fileOverride ?? pdfAwaitingStrategy;
        if (!effectiveFile) return;

        // Generamos el budgetId en el cliente para que el panel de actividad abra
        // el canal de telemetría (pipeline_telemetry/{budgetId}) desde el primer render
        // y no se pierdan los primeros eventos del servicio Python.
        const budgetId = uuidv4();

        setState('processing');
        setGenerationProgress({
            step: 'extracting',
            currentItem: 'Analizando presupuesto PDF estructural…',
            budgetId,
        } as any);

        const formData = new FormData();
        formData.append('file', effectiveFile);
        setPdfAwaitingStrategy(null); // Clear triage UI

        try {
            const { extractMeasurementPdfAction } = await import('@/actions/budget/extract-measurement-pdf.action');
            const effectiveId = isAdmin ? 'admin-user' : (leadId || 'unknown-lead');
            const result = await extractMeasurementPdfAction(formData, effectiveId, strategy, budgetId);

            if (result.success && result.budgetId) {
                if (result.isPending) {
                    // El panel ya está escuchando — los eventos del Python avanzan las fases solos.
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

    // Auto-scroll to bottom — reacciona a mensajes nuevos (smooth) y también a
    // cambios de thread (`conversationId`) y al terminar de cargar un thread
    // (`isLoadingMessages` → false). En esos dos últimos casos saltamos en
    // `instant` para no perder tiempo animando el scroll justo al abrir.
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages]);

    useEffect(() => {
        if (!isLoadingMessages && scrollRef.current) {
            // Al terminar la carga de un thread: salta directo al fondo, sin
            // animación suave (evita el "salto visible" de recorrer 2000 px).
            scrollRef.current.scrollIntoView({ behavior: 'auto' });
        }
    }, [conversationId, isLoadingMessages]);

    // Auto-resume generation when the Architect question is answered
    useEffect(() => {
        if (state === 'review' && isAwaitingArchitect && generationProgress.step === 'idle') {
            setIsAwaitingArchitect(false);
            handleGenerateBudget();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state, isAwaitingArchitect, generationProgress.step]);

    // Auto-send initial prompt from context if present.
    // Cuando refinamos un lead concreto (targetLeadIdFromQuery), forzamos una
    // conversación nueva ANTES de enviar el brief — para no contaminar la
    // conversación admin previa con el contexto de un lead distinto.
    //
    // El cuello de botella era que `sendMessage` early-returns si `conversationId`
    // es null y, tras `startNewConversation()`, el state aún no había propagado
    // (closure stale). Solución: refs vivos a `sendMessage` y `conversationId`
    // + espera activa hasta que el state refleje el nuevo id.
    const initialPromptSentRef = useRef(false);
    const newConversationForLeadRef = useRef<string | null>(null);
    const sendMessageRef = useRef(sendMessage);
    const conversationIdRef = useRef<string | null>(conversationId);
    useEffect(() => {
        sendMessageRef.current = sendMessage;
    }, [sendMessage]);
    useEffect(() => {
        conversationIdRef.current = conversationId;
    }, [conversationId]);

    useEffect(() => {
        if (!initialPrompt || initialPrompt.trim() === '') return;
        if (initialPromptSentRef.current) return;
        initialPromptSentRef.current = true;

        const promptToSend = initialPrompt;
        setInitialPrompt('');

        (async () => {
            if (targetLeadIdFromQuery && newConversationForLeadRef.current !== targetLeadIdFromQuery) {
                newConversationForLeadRef.current = targetLeadIdFromQuery;
                try {
                    const newConvId = await startNewConversation();
                    if (newConvId) {
                        // Esperar a que el state propague hasta que el ref refleje
                        // el nuevo id (sendMessage chequea conversationId interno
                        // del hook, así que necesitamos que su closure se reestablezca).
                        const start = Date.now();
                        while (conversationIdRef.current !== newConvId && Date.now() - start < 2500) {
                            await new Promise(r => setTimeout(r, 50));
                        }
                        // Persistir mapping conv→lead para que el banner se muestre
                        // sólo en esta conversación específica.
                        if (typeof window !== 'undefined') {
                            try {
                                const raw = localStorage.getItem('rg_refine_conv_lead') || '{}';
                                const map = JSON.parse(raw);
                                map[newConvId] = targetLeadIdFromQuery;
                                localStorage.setItem('rg_refine_conv_lead', JSON.stringify(map));
                            } catch {}
                        }
                    }
                } catch (err) {
                    console.error('[BudgetWizardChat] Falló startNewConversation para refinement:', err);
                }
            } else {
                await new Promise(r => setTimeout(r, 300));
            }
            // Usar la versión de sendMessage capturada en el último render
            // (closure ya tiene el conversationId actualizado).
            sendMessageRef.current(promptToSend);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialPrompt, setInitialPrompt, targetLeadIdFromQuery, startNewConversation]);

    const handleGenerateBudget = async () => {
        if (!requirements || !requirements.specs) return;

        if (!isAdmin && !leadId) {
            console.error("Lead ID missing");
            return;
        }

        // Generamos el budgetId en el cliente y lo propagamos tanto al stream como a la action.
        // Así el EventSource de BudgetGenerationProgress abre el canal correcto
        // desde el primer render y no pierde los eventos emitidos durante los ~60s de la generación.
        const budgetId = uuidv4();

        setGenerationProgress({ step: 'extracting', budgetId });
        addSystemMessage(w.progress.generatingMsg);

        try {
            const detectedCount = requirements.detectedNeeds?.length || 15;
            setGenerationProgress({
                step: 'extracting',
                extractedItems: detectedCount,
                budgetId,
            } as any);

            // Enriquecemos la narrativa con TODO el contexto conversacional para que el
            // Architect reciba los detalles específicos que el Asistente recogió (materiales,
            // instalaciones concretas, patologías, demoliciones) y no solo los specs abstractos.
            // Sin esto, el Architect ve un brief pobre y vuelve a pedir clarificación.
            const userTurns = messages
                .filter(m => m.role === 'user')
                .map(m => m.content.trim())
                .filter(Boolean);
            const lastAssistantSummary = [...messages]
                .reverse()
                .find(m => m.role === 'assistant' && /capítulos|demoliciones|fontanería|albañilería|pintura|electricidad/i.test(m.content))
                ?.content;

            const existingBrief = (requirements as any).finalBrief || (requirements.specs as any).originalRequest;
            const narrativeParts = [
                existingBrief,
                ...(existingBrief ? [] : userTurns),
                lastAssistantSummary && `\nResumen consensuado con el cliente:\n${lastAssistantSummary}`,
            ].filter(Boolean);
            const consolidatedNarrative = narrativeParts.join('\n\n').trim();

            // Derivamos detectedNeeds desde phaseChecklist si aún está vacío, para
            // propagar al prompt del Architect la lista exacta de capítulos confirmados.
            const phaseChecklist = (requirements as any).phaseChecklist || {};
            const autoDetectedNeeds = (!requirements.detectedNeeds || requirements.detectedNeeds.length === 0)
                ? Object.entries(phaseChecklist)
                    .filter(([, status]) => status === 'addressed')
                    .map(([chapter]) => ({ category: chapter, description: `Trabajos de ${chapter} confirmados en conversación.` }))
                : requirements.detectedNeeds;

            const enrichedRequirements = {
                ...requirements,
                specs: {
                    ...(requirements.specs || {}),
                    originalRequest: consolidatedNarrative || (requirements.specs as any).originalRequest,
                },
                detectedNeeds: autoDetectedNeeds,
            };

            let result;

            if (isAdmin) {
                if (targetLeadIdFromQuery) {
                    // Refinement de un lead real: usamos el dispatcher que crea
                    // placeholder budget con clientSnapshot + status='pending_review'
                    // y dispara el motor con el requirement enriquecido por la
                    // conversación del wizard.
                    const { dispatchBudgetGenerationAction } = await import('@/actions/admin/dispatch-budget-generation.action');
                    const dispatchResult = await dispatchBudgetGenerationAction(
                        targetLeadIdFromQuery,
                        'from-specs',
                        enrichedRequirements as any
                    );
                    result = dispatchResult.success
                        ? { success: true, isPending: true, budgetId: dispatchResult.budgetId }
                        : { success: false, error: dispatchResult.error };
                } else {
                    // Admin sin lead asociado: flujo experimental / demo. Va directo
                    // al motor sin crear placeholder con clientSnapshot.
                    const { generateBudgetFromSpecsAction } = await import('@/actions/budget/generate-budget-from-specs.action');
                    result = await generateBudgetFromSpecsAction(leadId || null, enrichedRequirements as any, true, budgetId);
                }
            } else if (isPublicMode) {
                if (!leadId) return;
                const { generatePublicDemoAction } = await import('@/actions/budget/generate-public-demo.action');
                const chatHistory = messages.map(m => ({ role: m.role, content: m.content }));
                result = await generatePublicDemoAction(leadId, enrichedRequirements as any, chatHistory, budgetId);
            } else {
                if (!leadId) return;
                const { generateDemoBudgetAction } = await import('@/actions/budget/generate-demo-budget.action');
                result = await generateDemoBudgetAction(leadId, enrichedRequirements, budgetId);
            }

            if (result.success && (result as any).isPending) {
                // Nueva ruta vía Python (NL→Budget): el job está corriendo en background
                // y la telemetría llegará por SSE. El panel `BudgetGenerationProgress`
                // se encarga de cerrar las fases cuando reciba `budget_completed`, y
                // su callback `onComplete` publicará el mensaje con el link.
                // No hacemos nada más aquí.
                return;
            } else if (result.success && result.budgetResult) {
                // Flujo síncrono legado (generate-public-demo / generate-demo-budget).
                const typedResult: any = result;
                const budgetId = typedResult.budgetId || typedResult.budgetResult?.id;

                setGenerationProgress({
                    step: 'searching',
                    extractedItems: detectedCount,
                    currentItem: w.progress.searching,
                    budgetId: budgetId
                });

                const itemCount = typedResult.budgetResult?.chapters?.reduce((acc: number, c: any) => acc + c.items.length, 0) || 0;

                setGenerationProgress({
                    step: 'complete',
                    extractedItems: itemCount,
                    matchedItems: itemCount
                });

                await new Promise(r => setTimeout(r, 1500));

                const viewLink = isAdmin
                    ? `/dashboard/admin/budgets/${typedResult.budgetId}/edit`
                    : isPublicMode
                        ? `/demo/viewer/${typedResult.traceId}`
                        : `/budget/${typedResult.budgetId}`;

                setGenerationProgress({ step: 'idle' });
                addSystemMessage(`¡El presupuesto se ha generado con éxito! \n\n[Ver el resultado y Descargar](${viewLink})`);

                if (isPublicMode) {
                    setState('generated');
                } else {
                    setState('idle');
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
                                conversations.map(chat => {
                                    const isEditing = editingConvId === chat.id;
                                    return (
                                        <div key={chat.id} className="group flex items-center gap-1">
                                            {isEditing ? (
                                                <div className="flex-1 flex items-center gap-1 px-2 py-1 rounded-lg bg-background border border-primary/40 shadow-sm">
                                                    <MessageSquare className="w-4 h-4 shrink-0 text-muted-foreground" />
                                                    <input
                                                        autoFocus
                                                        value={editingTitle}
                                                        onChange={(e) => setEditingTitle(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                e.preventDefault();
                                                                saveEditConversation();
                                                            } else if (e.key === 'Escape') {
                                                                e.preventDefault();
                                                                cancelEditConversation();
                                                            }
                                                        }}
                                                        onBlur={() => saveEditConversation()}
                                                        maxLength={120}
                                                        className="flex-1 bg-transparent text-sm focus:outline-none text-foreground placeholder:text-muted-foreground/60 min-w-0"
                                                        placeholder="Nombre del chat"
                                                    />
                                                    <button
                                                        onMouseDown={(e) => e.preventDefault()}
                                                        onClick={() => saveEditConversation()}
                                                        className="p-1 text-muted-foreground hover:text-emerald-500 rounded"
                                                        title="Guardar (Enter)"
                                                    >
                                                        <Check className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        onMouseDown={(e) => e.preventDefault()}
                                                        onClick={cancelEditConversation}
                                                        className="p-1 text-muted-foreground hover:text-red-500 rounded"
                                                        title="Cancelar (Esc)"
                                                    >
                                                        <XIcon className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <>
                                                    <button
                                                        onClick={() => switchConversation(chat.id)}
                                                        onDoubleClick={() => beginEditConversation(chat.id, chat.title || '')}
                                                        className={cn(
                                                            "flex-1 flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-all whitespace-nowrap overflow-hidden text-ellipsis border-l-2",
                                                            conversationId === chat.id
                                                                ? "bg-primary/10 text-primary font-semibold dark:bg-primary/20 border-primary shadow-sm"
                                                                : "text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5 border-transparent"
                                                        )}
                                                        title="Click para abrir · doble click para renombrar"
                                                    >
                                                        <MessageSquare className="w-4 h-4 shrink-0" />
                                                        <span className="truncate">{chat.title || 'Conversación sin título'}</span>
                                                    </button>
                                                    <button
                                                        onClick={() => beginEditConversation(chat.id, chat.title || '')}
                                                        className={cn(
                                                            "p-2 text-muted-foreground hover:text-primary rounded-lg opacity-0 group-hover:opacity-100 transition-all focus:opacity-100",
                                                            conversationId === chat.id && "opacity-100"
                                                        )}
                                                        title="Renombrar Chat"
                                                    >
                                                        <Pencil className="w-3.5 h-3.5" />
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
                                                </>
                                            )}
                                        </div>
                                    );
                                })
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

                    {/* Banner del lead que estamos refinando. Visible sólo cuando
                        el admin entró desde el detalle del lead con ?leadId=xxx. */}
                    {refineBanner && (
                        <div className="hidden md:flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs">
                            <Sparkles className="h-3.5 w-3.5 text-primary" />
                            <span className="font-medium">{refineBanner.name}</span>
                            <span className="text-muted-foreground">·</span>
                            {refineBanner.projectType && (
                                <>
                                    <span className="text-muted-foreground capitalize">{refineBanner.projectType.replace('_', ' ')}</span>
                                    <span className="text-muted-foreground">·</span>
                                </>
                            )}
                            {(refineBanner.postalCode || refineBanner.city) && (
                                <>
                                    <span className="text-muted-foreground">{[refineBanner.postalCode, refineBanner.city].filter(Boolean).join(' ')}</span>
                                    <span className="text-muted-foreground">·</span>
                                </>
                            )}
                            {typeof refineBanner.score === 'number' && (
                                <span className="font-mono text-[10px] text-muted-foreground">{refineBanner.score}/100</span>
                            )}
                            <Link
                                href={`/dashboard/leads/${targetLeadIdFromQuery}`}
                                className="ml-1 text-[10px] text-primary hover:underline"
                            >
                                ver lead →
                            </Link>
                        </div>
                    )}

                    {/* Botón "Nuevo Chat" del header eliminado — se conserva el de la
                      * barra lateral izquierda como único punto de entrada para crear un hilo. */}
                </header>

                {/* Messages Area (el header de chat es absolute z-10; el PhaseStepper
                    vive DENTRO del scroll area con sticky bajo el header para no solapar
                    con el logo/botones del header). */}
                <div className="flex-1 overflow-y-auto p-0 custom-scrollbar relative bg-background/50 leading-relaxed px-4 md:px-6">
                    {/* Sticky bar bajo el header. En PDF flow (con partidas resueltas)
                        mostramos `BudgetSummaryBar` con stats agregadas; en NL flow
                        sigue `PhaseStepper` con el progreso conversacional. */}
                    {messages.length > 0 && (() => {
                        const stats = computeBudgetStats(progressSubEvents);
                        const showSummaryBar = stats.partidasCount > 0;
                        return (
                            <div className="sticky top-16 md:top-20 z-[5] -mx-4 md:-mx-6 bg-background/85 backdrop-blur-md border-b border-black/5 dark:border-white/5 px-4 md:px-6 py-2.5">
                                <div className="max-w-3xl mx-auto">
                                    {showSummaryBar
                                        ? <BudgetSummaryBar subEvents={progressSubEvents} totalTasks={generationProgress.extractedItems} />
                                        : <PhaseStepper requirements={requirements} />}
                                </div>
                            </div>
                        );
                    })()}
                    {/* Empty-state: saludo centrado en ambos ejes del scroll area.
                        Compensamos la altura aproximada del input bar fija (≈12rem)
                        con un offset para que el centroide visual quede en el medio
                        del espacio útil. Contraste correcto en ambos temas. */}
                    {messages.length === 0 && !isLoadingMessages && state === 'idle' && generationProgress.step === 'idle' && (
                        <div className="h-full flex items-center justify-center -mt-8 md:-mt-12">
                            <div className="text-center space-y-2 px-4 w-full max-w-2xl mx-auto">
                                <h2 className="text-3xl md:text-[40px] leading-tight font-display text-slate-700 dark:text-zinc-200">
                                    Hola{isAdmin ? ' Admin' : (leadName ? ` ${leadName}` : '')}.
                                </h2>
                                <h2 className="text-2xl md:text-[32px] leading-tight font-display text-slate-500 dark:text-zinc-400">
                                    ¿Por dónde empezamos?
                                </h2>
                            </div>
                        </div>
                    )}

                    <div className="max-w-3xl mx-auto pt-20 md:pt-24 pb-32 space-y-6 md:space-y-8 flex flex-col items-center">
                        {/* Skeleton loader mientras `switchConversation` fetchea mensajes */}
                        {isLoadingMessages && (
                            <div data-testid="chat-skeleton" className="w-full space-y-6 pt-10">
                                {[0, 1, 2].map((i) => (
                                    <div
                                        key={i}
                                        className={cn(
                                            "flex gap-2",
                                            i % 2 === 0 ? "justify-start" : "justify-end"
                                        )}
                                    >
                                        {i % 2 === 0 && (
                                            <div className="shrink-0 w-8 h-8 rounded-full bg-black/5 dark:bg-white/5 animate-pulse" />
                                        )}
                                        <div
                                            className={cn(
                                                "h-12 rounded-2xl animate-pulse",
                                                i % 2 === 0
                                                    ? "bg-black/5 dark:bg-white/5 w-[60%] rounded-bl-none"
                                                    : "bg-primary/10 w-[50%] rounded-br-none"
                                            )}
                                        />
                                    </div>
                                ))}
                            </div>
                        )}
                        <AnimatePresence initial={false}>
                            {!isLoadingMessages && messages.length > 0 && (
                                messages.map((msg, index) => (
                                    <ChatBubble key={msg.id} message={msg} isGenerating={msg.content === w.progress.generatingMsg} />
                                ))
                            )}

                            {/* Activity timeline — estilo burbuja del bot con avatar.
                                Se integra en el flow del chat, no flota al ancho completo. */}
                            {generationProgress.step !== 'idle' && (
                                <motion.div
                                    initial={{ opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="flex w-full min-w-0 max-w-3xl mx-auto justify-start items-start gap-2 mt-2"
                                >
                                    {/* Avatar del bot, igual patrón que ChatBubble */}
                                    <div className="shrink-0 mt-0.5 w-8 h-8 rounded-full flex items-center justify-center border shadow-sm bg-primary/15 dark:bg-primary/20 border-primary/30 text-primary">
                                        <Bot className="w-4 h-4" />
                                    </div>
                                    <BudgetGenerationProgress
                                        progress={generationProgress}
                                        budgetId={(generationProgress as any).budgetId || leadId}
                                        onSubEventsChange={setProgressSubEvents}
                                        onComplete={(budgetId) => {
                                            const viewLink = isAdmin
                                                ? `/dashboard/admin/budgets/${budgetId}/edit`
                                                : isPublicMode
                                                    ? `/demo/viewer/${budgetId}`
                                                    : `/budget/${budgetId}`;

                                            setTimeout(() => {
                                                // Fase 10.3 — burbuja final enriquecida con stats agregadas
                                                // (partidas, capítulos, PEM, anomalías). Fallback al texto
                                                // simple si no hay stats por algún motivo.
                                                const finalStats = computeBudgetStats(progressSubEvents);
                                                const lines: string[] = ['**¡Presupuesto generado!**'];
                                                if (finalStats.partidasCount > 0) {
                                                    const parts: string[] = [];
                                                    parts.push(`📋 ${finalStats.partidasCount} partidas`);
                                                    if (finalStats.chaptersCount > 0) parts.push(`🧱 ${finalStats.chaptersCount} capítulos`);
                                                    if (finalStats.pemTotal > 0) parts.push(`💰 ${finalStats.formattedPem}`);
                                                    lines.push(parts.join(' · '));
                                                }
                                                if (finalStats.anomaliesCount > 0) {
                                                    lines.push(`⚠️ ${finalStats.anomaliesCount} ${finalStats.anomaliesCount === 1 ? 'partida necesita' : 'partidas necesitan'} revisión humana`);
                                                }
                                                lines.push(`[Ver el resultado y Descargar](${viewLink})`);

                                                setGenerationProgress({ step: 'idle' });
                                                addSystemMessage(lines.join('\n\n'));
                                                setState(isPublicMode ? 'generated' : 'idle');
                                            }, 1500);
                                        }}
                                    />
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Proactive Co-Pilot Suggestions — Fase 10.3 las ocultamos si
                            el último mensaje es el system message con el link de
                            descarga (post-completion). Las pills sugerirían refinar
                            cuando en realidad ya está cerrado. */}
                        {(() => {
                            const last = messages[messages.length - 1];
                            const isPostBudgetCompletion = last?.role === 'system' && /Ver el resultado y Descargar/.test(last.content || '');
                            return state === 'idle' && messages.length > 0 && generationProgress.step === 'idle' && !isPostBudgetCompletion;
                        })() && (
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

                        {/* Nota: la tarjeta estática "Procesando Documento (Tool Activa)"
                         * se eliminó: el panel BudgetGenerationProgress que se monta más arriba
                         * (cuando generationProgress.step !== 'idle') ya refleja el progreso
                         * real en base a la telemetría que emite el servicio Python. */}

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

                {/* Input Area — anclado al bottom sin animación layout. */}
                <div
                    className="absolute left-0 right-0 bottom-0 p-2 md:p-6 pointer-events-none flex flex-col items-center z-20 bg-gradient-to-t from-background via-background/95 to-transparent"
                >
                    <div className="pointer-events-auto w-full max-w-3xl relative flex flex-col items-center">

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
                                            <div key={i} className="relative group flex items-center gap-2 bg-[#2a2b2e] border border-white/5 shadow-[0_2px_10px_rgba(0,0,0,0.2)] rounded-xl py-1.5 pl-3 pr-1.5">
                                                {isPdf ? (
                                                    <FileText className="w-4 h-4 text-blue-400" />
                                                ) : (
                                                    <ImageIcon className="w-4 h-4 text-emerald-400" />
                                                )}
                                                <span className="text-[13px] font-medium text-white/90 max-w-[180px] truncate tracking-tight">{file.name}</span>
                                                {isPdf && (
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <button
                                                                type="button"
                                                                data-testid="pdf-strategy-trigger"
                                                                title="Tipo de formato del PDF"
                                                                className="ml-1 flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold text-white/80 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                                                            >
                                                                {pdfStrategy === 'INLINE' ? 'Estándar' : 'Anexado'}
                                                                <ChevronDown className="w-3 h-3" />
                                                            </button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="start" className="w-72 bg-zinc-900 border-white/10 text-white">
                                                            <DropdownMenuItem
                                                                data-testid="pdf-strategy-inline"
                                                                onClick={() => setPdfStrategy('INLINE')}
                                                                className={cn(
                                                                    "flex flex-col items-start gap-0.5 py-2.5 cursor-pointer text-white",
                                                                    "focus:bg-white/10 focus:text-white hover:bg-white/10",
                                                                    pdfStrategy === 'INLINE' && "bg-primary/10"
                                                                )}
                                                            >
                                                                <span className="text-sm font-semibold text-white">
                                                                    Estándar{' '}
                                                                    <span className="text-[10px] font-normal text-white/50">(Recomendado)</span>
                                                                </span>
                                                                <span className="text-[11px] text-white/70 leading-snug">
                                                                    Texto y mediciones en la misma línea. Formato habitual.
                                                                </span>
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                data-testid="pdf-strategy-annexed"
                                                                onClick={() => setPdfStrategy('ANNEXED')}
                                                                className={cn(
                                                                    "flex flex-col items-start gap-0.5 py-2.5 cursor-pointer text-white",
                                                                    "focus:bg-white/10 focus:text-white hover:bg-white/10",
                                                                    pdfStrategy === 'ANNEXED' && "bg-primary/10"
                                                                )}
                                                            >
                                                                <span className="text-sm font-semibold text-white">Anexado</span>
                                                                <span className="text-[11px] text-white/70 leading-snug">
                                                                    Literatura al inicio y mediciones en cuadro resumen al final.
                                                                </span>
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                )}
                                                <button
                                                    onClick={() => handleRemovePendingFile(i)}
                                                    className="p-1.5 rounded-full hover:bg-white/10 text-white/40 hover:text-white transition-colors ml-0.5"
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

                            {(state as string) === 'generated' ? (
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
                                            Grupo RG AI
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

                        <p className="mt-3 text-center text-xs font-medium text-gray-400 dark:text-gray-600 hidden md:block pointer-events-auto">
                            {isRecording ? `${w.input.recordingInfo} ${formatTime(recordingTime)}` : w.input.keyboardHint}
                        </p>
                    </div>
                </div>
            </div>



            {/* Onboarding Sidebar (Desktop) / Drawer (Mobile) */}
            <BudgetWizardTips setInput={setInput} />

        </div >
    );
}

function ChatBubble({ message, isGenerating }: { message: Message, isGenerating?: boolean }) {
    const isUser = message.role === 'user';
    const isSystem = message.role === 'system';
    // v006 UX — etiqueta del agente para el chip bajo cada mensaje del bot.
    // No intentamos atribuir la respuesta a un agente del swarm específico
    // todavía; los mensajes conversacionales son del Arquitecto por diseño,
    // los systemMessage son notificaciones transversales del pipeline.
    const agentLabel = isSystem ? 'Sistema' : 'Arquitecto';

    return (
        <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className={cn(
                "flex w-full min-w-0 max-w-3xl mx-auto gap-2",
                isUser ? "justify-end" : "justify-start items-start"
            )}
        >
            {/* Avatar — solo para respuestas del bot. */}
            {!isUser && (
                <div
                    data-testid="bot-avatar"
                    className={cn(
                        "shrink-0 mt-0.5 w-8 h-8 rounded-full flex items-center justify-center border shadow-sm",
                        isSystem
                            ? "bg-slate-200 dark:bg-slate-700/40 border-slate-300/60 dark:border-white/10 text-slate-600 dark:text-slate-300"
                            : "bg-primary/15 dark:bg-primary/20 border-primary/30 text-primary"
                    )}
                    title={agentLabel}
                >
                    {isSystem ? (
                        <Sparkles className="w-4 h-4" />
                    ) : (
                        <Bot className="w-4 h-4" />
                    )}
                </div>
            )}
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
                <div className={cn(
                    "absolute -bottom-5 flex items-center gap-1.5 text-[10px] whitespace-nowrap",
                    isUser ? "right-0" : "left-0"
                )}>
                    {!isUser && (
                        <span
                            data-testid="agent-chip"
                            className={cn(
                                "px-1.5 py-0.5 rounded-md font-semibold uppercase tracking-widest text-[9px] border",
                                isSystem
                                    ? "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                                    : "bg-primary/10 text-primary border-primary/20"
                            )}
                        >
                            {agentLabel}
                        </span>
                    )}
                    <span className="text-muted-foreground/60 dark:text-white/30">
                        {message.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                </div>
            </div>
        </motion.div >
    );
}

function formatTime(seconds: number) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

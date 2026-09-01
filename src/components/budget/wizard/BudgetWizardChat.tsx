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
import { Bc3DetectCard } from './Bc3DetectCard';
import { detectBc3Action, type Bc3DetectResult } from '@/actions/budget/detect-bc3.action';
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
import { Budget } from '@/backend/budget/domain/budget';
import { BudgetWizardTips } from './BudgetWizardTips';
import { PhaseStepper } from './PhaseStepper';
import { BudgetSummaryBar } from './BudgetSummaryBar';
import { computeBudgetStats } from './budget-summary-stats';
import type { SubEvent } from '@/components/budget/budget-generation-events';
import { useAuth } from '@/hooks/use-auth';


export function BudgetWizardChat({ isAdmin = false, isPublicMode = false }: { isAdmin?: boolean, isPublicMode?: boolean }) {
    const t = useTranslations('home');
    const w = t.raw('platform.wizardChat');
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
    // Auth context: needed by the new pipeline-jobs flow to scope Storage
    // uploads under `pipeline_uploads/{uid}/...` per the Storage rules.
    const { user } = useAuth();
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
        /** Pipeline Jobs path id (new architecture). Set when the upload went
         *  through `dispatchMeasurementsJob` so `<BudgetGenerationProgress>`
         *  can render the Cancel/Retry controls. */
        pipelineJobId?: string;
    }>({ step: 'idle' });

    // Sprint 4 Fase I — persistencia del job activo en localStorage para que
    // sobreviva reloads/navegación. Plan original 14-may pendiente:
    // cuando el usuario sube un PDF al wizard, el job sigue corriendo en
    // background. Sin persistencia, al recargar la página el cliente perdía
    // el estado y el SSE se cerraba — el server seguía emitiendo eventos
    // que nunca se procesaban (causa raíz del bug "52 partidas vs 148 en
    // editor" donde el cliente sólo veía un subset del progreso).
    //
    // Key TTL conservador: 60 min (más que suficiente para RdLL 258pp que
    // tardó 13m30s; protege contra jobs zombie que nunca completaron).
    const ACTIVE_JOB_KEY = 'rg_active_pipeline_job';
    const ACTIVE_JOB_TTL_MS = 60 * 60 * 1000;

    // Sprint 4 Fase J — phase tracking. `running` solo aplica cuando el dispatch
    // HTTP confirmó OK y el worker está en Cloud Run procesando. El resto son
    // fases del flujo cliente PRE-dispatch — si un reload cae en cualquiera de
    // ellas, el job NUNCA arrancó en el backend y hay que avisar al usuario en
    // lugar de reconectar a una colección de telemetry vacía.
    type JobPhase = 'uploading' | 'extracting_metadata' | 'awaiting_confirm' | 'dispatching' | 'running';

    type ActiveJobInfo = {
        budgetId: string;
        jobId?: string;
        startedAt: number;
        leadId?: string;
        phase: JobPhase;
        fileName?: string;
        // gcsUri y strategy permiten reanudar el dispatch desde
        // `awaiting_confirm` sin re-subir el PDF: el GCS object sobrevive 7d.
        gcsUri?: string;
        strategy?: 'INLINE' | 'ANNEXED';
        // uid del cliente: necesario para reanudar el dispatch desde restore.
        uid?: string;
        // Sprint 4 Fase J — vincula el job a una conversación específica del
        // wizard. Si el usuario navega entre conversaciones, solo mostramos el
        // progress card en la conv que lanzó el job (no en todas globalmente).
        conversationId?: string | null;
        extractedMetadata?: {
            clientName?: string | null;
            budgetTitle?: string | null;
            projectAddress?: string | null;
            confidence?: number;
        };
    };

    const readActiveJob = React.useCallback((): ActiveJobInfo | null => {
        try {
            const raw = localStorage.getItem(ACTIVE_JOB_KEY);
            if (!raw) return null;
            return JSON.parse(raw) as ActiveJobInfo;
        } catch {
            return null;
        }
    }, []);

    // `persistActiveJob` ahora hace merge: pasas un parche y se combina con lo
    // existente. Esto deja que cada paso del flujo solo refleje su propia
    // transición sin tener que re-derivar el estado completo.
    const persistActiveJob = React.useCallback((patch: Partial<ActiveJobInfo>) => {
        try {
            const prev = readActiveJob();
            const next: ActiveJobInfo = {
                budgetId: patch.budgetId ?? prev?.budgetId ?? '',
                jobId: patch.jobId ?? prev?.jobId,
                startedAt: patch.startedAt ?? prev?.startedAt ?? Date.now(),
                leadId: patch.leadId ?? prev?.leadId,
                phase: patch.phase ?? prev?.phase ?? 'uploading',
                fileName: patch.fileName ?? prev?.fileName,
                gcsUri: patch.gcsUri ?? prev?.gcsUri,
                strategy: patch.strategy ?? prev?.strategy,
                uid: patch.uid ?? prev?.uid,
                conversationId: patch.conversationId !== undefined
                    ? patch.conversationId
                    : prev?.conversationId,
                extractedMetadata: patch.extractedMetadata ?? prev?.extractedMetadata,
            };
            if (!next.budgetId) return; // sin budgetId no persistimos basura
            localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(next));
        } catch {
            /* SSR / private browsing — ignore */
        }
    }, [readActiveJob]);

    const clearActiveJob = React.useCallback(() => {
        try {
            localStorage.removeItem(ACTIVE_JOB_KEY);
        } catch {
            /* ignore */
        }
    }, []);

    // Trackea para qué budgetId ya mostramos un systemMessage (cortado o
    // "Continuamos donde quedaste") para que el restore no spamee mensajes
    // duplicados cuando el usuario navega entre conversaciones.
    const restoreNotifiedForBudgetRef = React.useRef<string | null>(null);

    // Restore active job on mount. Decisión por phase:
    //
    //   running / dispatching →  Reconectar SSE. El worker está corriendo (o el
    //     dispatch HTTP ya llegó al backend y muy probable que arrancó). SSE
    //     refinará con eventos reales — si el job no arrancó, los eventos no
    //     llegan y el TTL 60min limpia eventualmente.
    //
    //   awaiting_confirm con gcsUri + uid + leadId →  Reanudar SIN re-subir el
    //     PDF. El upload + extract YA están hechos; solo falta confirmar el
    //     dialog y disparar el dispatch HTTP. Re-abrimos el dialog con metadata
    //     cacheada y configuramos un resolver custom que invoca el dispatch
    //     directamente (saltando dispatchMeasurementsJob que requeriría File).
    //
    //   uploading / extracting_metadata / awaiting_confirm sin gcsUri →
    //     El upload no llegó a completarse (o info legacy de pre-fix). El PDF
    //     no está accesible. Avisamos y pedimos re-subir.
    React.useEffect(() => {
        const info = readActiveJob();
        if (!info) return;
        if (
            !info.budgetId
            || typeof info.startedAt !== 'number'
            || Date.now() - info.startedAt > ACTIVE_JOB_TTL_MS
        ) {
            clearActiveJob();
            return;
        }

        // Sprint 4 Fase J — solo restauramos en la conversación que lanzó el
        // job. El sync useEffect (más abajo) reaccionará cuando el usuario
        // entre en la conv correcta. Aquí mostraríamos systemMessages /
        // reabriríamos el dialog en la conv equivocada si no filtramos.
        if (
            info.conversationId !== undefined
            && info.conversationId !== null
            && info.conversationId !== conversationId
        ) {
            return;
        }

        const phase = info.phase ?? 'running'; // back-compat: docs sin phase eran post-dispatch

        if (phase === 'running' || phase === 'dispatching') {
            setGenerationProgress({
                step: 'searching',
                budgetId: info.budgetId,
                pipelineJobId: info.jobId,
            } as any);
            return;
        }

        // awaiting_confirm con todo lo necesario para reanudar el dispatch.
        if (
            phase === 'awaiting_confirm'
            && info.gcsUri
            && info.uid
            && info.leadId
            && info.extractedMetadata
        ) {
            const alreadyNotified = restoreNotifiedForBudgetRef.current === info.budgetId;
            if (!alreadyNotified) {
                restoreNotifiedForBudgetRef.current = info.budgetId;
                const fileTag = info.fileName ? ` (\`${info.fileName}\`)` : '';
                addSystemMessage(
                    `Continuamos donde quedaste${fileTag}. Confirma los datos del cliente y el título para reanudar el cálculo del presupuesto.`,
                );
            }
            setPdfMetadataPromptInitial({
                clientName: info.extractedMetadata.clientName || '',
                budgetTitle: info.extractedMetadata.budgetTitle || '',
                confidence: info.extractedMetadata.confidence || 0,
            });
            setState('processing');
            setGenerationProgress({
                step: 'extracting',
                budgetId: info.budgetId,
                currentItem: 'Esperando confirmación de datos…',
            } as any);
            // Resolver custom: cuando el usuario confirme el dialog, hacemos
            // dispatch HTTP DIRECTO con el gcsUri cacheado en lugar de pasar
            // por dispatchMeasurementsJob (que esperaría un File).
            pdfMetadataResolverRef.current = (result) => {
                if (result === null) {
                    // Cancelado — el upload se queda huérfano en GCS (lifecycle
                    // lo elimina en 7d). Limpiamos localStorage y avisamos.
                    clearActiveJob();
                    setGenerationProgress({ step: 'idle' });
                    setState('idle');
                    addSystemMessage('Has cancelado la reanudación. Vuelve a subir el PDF cuando quieras retomarlo.');
                    return;
                }
                const clientName = result.clientName?.trim() || undefined;
                const budgetTitle = result.budgetTitle?.trim() || undefined;
                persistActiveJob({ phase: 'dispatching' });
                setGenerationProgress({
                    step: 'extracting',
                    budgetId: info.budgetId,
                    currentItem: 'Reanudando envío al motor de cálculo…',
                } as any);
                // Fire-and-forget; el dialog ya se cerró y el state queda activo
                // hasta que SSE empiece a recibir eventos.
                (async () => {
                    try {
                        const { dispatchPipelineJobAction } = await import(
                            '@/actions/pipeline/dispatch-pipeline-job.action'
                        );
                        const res = await dispatchPipelineJobAction({
                            jobType: 'measurements',
                            uid: info.uid!,
                            leadId: info.leadId!,
                            budgetId: info.budgetId,
                            payload: {
                                gcsUri: info.gcsUri!,
                                strategy: info.strategy || 'INLINE',
                                clientName,
                                budgetTitle,
                            },
                        });
                        if (res.success) {
                            persistActiveJob({
                                phase: 'running',
                                jobId: res.jobId,
                            });
                            setGenerationProgress({
                                step: 'searching',
                                budgetId: info.budgetId,
                                pipelineJobId: res.jobId,
                            } as any);
                        } else {
                            throw new Error(res.error);
                        }
                    } catch (err: any) {
                        clearActiveJob();
                        setGenerationProgress({
                            step: 'error',
                            error: err?.message || 'Error reanudando el dispatch',
                        });
                        addSystemMessage(
                            `No se pudo reanudar el envío: ${err?.message || 'error desconocido'}. Vuelve a subir el PDF.`,
                        );
                    }
                })();
            };
            setPdfMetadataPromptOpen(true);
            return;
        }

        // uploading / extracting_metadata / awaiting_confirm sin gcsUri:
        // no podemos reanudar — el PDF no está accesible.
        const fileTag = info.fileName ? ` (\`${info.fileName}\`)` : '';
        const meta = info.extractedMetadata;
        const metaTag = meta?.clientName || meta?.budgetTitle
            ? `\n\nDatos detectados antes del corte: **${meta.clientName || ''}** · *${meta.budgetTitle || ''}*`
            : '';
        const reasonByPhase: Record<JobPhase, string> = {
            uploading: 'mientras se subía el PDF',
            extracting_metadata: 'mientras se analizaba la estructura del documento',
            awaiting_confirm: 'esperando que confirmaras los datos del cliente',
            dispatching: '', // no llega aquí
            running: '',     // no llega aquí
        };
        const reason = reasonByPhase[phase] || 'durante la subida';

        if (restoreNotifiedForBudgetRef.current !== info.budgetId) {
            restoreNotifiedForBudgetRef.current = info.budgetId;
            addSystemMessage(
                `Tu subida anterior se cortó ${reason}${fileTag}. ` +
                `El presupuesto **no llegó a generarse**, así que tendrás que volver a subir el PDF cuando puedas.${metaTag}`,
            );
        }
        clearActiveJob();
        setGenerationProgress({ step: 'idle' });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conversationId]);

    // Sprint 4 Fase J — sync inverso: cuando el usuario navega a una conversación
    // distinta de la que lanzó el job activo, ocultamos el progress card. Sin
    // esto el BudgetGenerationProgress quedaba visible en TODAS las conversaciones
    // por culpa de que generationProgress es state global del componente.
    React.useEffect(() => {
        const info = readActiveJob();
        if (!info) return;
        if (
            info.conversationId !== undefined
            && info.conversationId !== null
            && info.conversationId !== conversationId
        ) {
            // Job pertenece a OTRA conv — ocultar progress aquí sin tocar
            // localStorage (sigue activo para la conv dueña).
            setGenerationProgress(prev => {
                if (!prev || prev.step === 'idle' || prev.step === 'complete' || prev.step === 'error') {
                    return prev;
                }
                return { step: 'idle' };
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conversationId]);

    // Fix UX: los estados TERMINALES del progress card (error / complete) son
    // globales al componente, así que se colaban en TODAS las conversaciones
    // (e incluso en una nueva): tras un error se llama `clearActiveJob()`, así
    // que `readActiveJob()` es null y los efectos de arriba no los limpiaban.
    // Al cambiar de conversación los reseteamos — un error/aviso solo tiene
    // sentido en la conversación donde ocurrió.
    React.useEffect(() => {
        setGenerationProgress(prev =>
            prev && (prev.step === 'error' || prev.step === 'complete')
                ? { step: 'idle' }
                : prev
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conversationId]);



    // Auto-resume generation after answering the Architect
    const [isAwaitingArchitect, setIsAwaitingArchitect] = React.useState(false);

    // Datos de cliente / título que enriquecen el Budget resultante. Solo se
    // piden a usuarios admin (en el flujo demo público no tiene sentido).
    // Si están vacíos al pulsar "Generar", se abre `clientPromptOpen` para
    // capturarlos antes de invocar la acción.
    const [clientName, setClientName] = React.useState('');
    const [budgetTitle, setBudgetTitle] = React.useState('');
    const [clientPromptOpen, setClientPromptOpen] = React.useState(false);

    // Pre-flight de metadata para el flujo PDF measurements. Después de subir
    // el PDF, el extractor sync devuelve {clientName, budgetTitle, ...} y
    // mostramos un Dialog para que el usuario confirme/edite antes del
    // dispatch. La Promise que devuelve el callback se resuelve cuando el
    // usuario pulsa Confirmar o Cancelar.
    const [pdfMetadataPromptOpen, setPdfMetadataPromptOpen] = React.useState(false);
    const [pdfMetadataPromptInitial, setPdfMetadataPromptInitial] = React.useState<{
        clientName: string;
        budgetTitle: string;
        confidence: number;
    } | null>(null);
    const pdfMetadataResolverRef = React.useRef<
        ((v: { clientName?: string; budgetTitle?: string } | null) => void) | null
    >(null);
    
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

    // F7 — BC3: al preparar un .bc3, lo detectamos (parse rápido en ai-core) para
    // mostrar la tarjeta con capítulos/partidas/con-precio antes de importar.
    const [bc3Detect, setBc3Detect] = useState<{ file: string; loading?: boolean; error?: string; data?: Bc3DetectResult } | null>(null);
    const bc3DetectedNameRef = useRef<string | null>(null);
    useEffect(() => {
        const bc3 = pendingFiles.find(f => f.name.toLowerCase().endsWith('.bc3'));
        if (!bc3) { setBc3Detect(null); bc3DetectedNameRef.current = null; return; }
        if (bc3DetectedNameRef.current === bc3.name) return; // ya detectado / en curso
        bc3DetectedNameRef.current = bc3.name;
        let cancelled = false;
        setBc3Detect({ file: bc3.name, loading: true });
        (async () => {
            const fd = new FormData();
            fd.append('file', bc3);
            const res = await detectBc3Action(fd);
            if (cancelled) return;
            setBc3Detect(res.ok ? { file: bc3.name, data: res.data } : { file: bc3.name, error: res.error });
        })();
        return () => { cancelled = true; };
    }, [pendingFiles]);
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
            
            // Sprint 4 Fase L — detección polimórfica de archivo de mediciones.
            // Soportamos PDF (parser TABULAR) y BC3 (parser FIEBDC-3 nativo).
            const isPdfFile = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
            const isBc3File = (f: File) => f.name.toLowerCase().endsWith('.bc3');

            const bc3File = filesToUpload.find(isBc3File);
            if (bc3File) {
                // BC3: dispatch directo (sin extract-metadata, sin dialog). El
                // parser BC3 ya conoce el title desde el root del árbol.
                await handleFastTrackBc3(bc3File);
                return;
            }

            const pdfFile = filesToUpload.find(isPdfFile);
            if (pdfFile) {
                 // v006 UX: la estrategia ya está pre-seleccionada en el pill del
                 // adjunto (default 'INLINE', el usuario puede cambiar a 'ANNEXED'
                 // con el dropdown antes de enviar). Vamos directo a procesar.
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

        // Sprint 4 Fase J — persistir el job desde el primer momento, con phase
        // tracking. Si el usuario recarga durante upload / extract-metadata /
        // dialog / dispatch, el restore useEffect detecta la phase no-`running`
        // y le avisa con un mensaje claro en lugar de quedar en un estado
        // colgado escuchando una colección de telemetry vacía.
        persistActiveJob({
            budgetId,
            leadId: leadId || undefined,
            startedAt: Date.now(),
            phase: 'uploading',
            fileName: effectiveFile.name,
            uid: user?.uid,
            strategy,
            conversationId: conversationId || null,
        });

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
            const { isPipelineJobsEnabled } = await import('@/lib/feature-flags');
            const effectiveId = isAdmin ? 'admin-user' : (leadId || 'unknown-lead');

            // New architecture path: client-side upload to Storage + dispatcher
            // → Cloud Run Job. Falls back to legacy BackgroundTasks path when
            // the flag is off so the canary rollout can be controlled per env.
            if (isPipelineJobsEnabled() && user?.uid) {
                const { dispatchMeasurementsJob } = await import(
                    '@/lib/budget/dispatch-measurements-job'
                );
                const newRes = await dispatchMeasurementsJob({
                    file: effectiveFile,
                    uid: user.uid,
                    leadId: effectiveId,
                    budgetId,
                    strategy,
                    // Sprint 4 Fase J — feedback visual durante el upload (~5-30s
                    // para PDFs grandes). Sin esto el chat queda "Analizando..."
                    // sin movimiento y el usuario asume cuelgue y recarga.
                    onUploadProgress: (fraction) => {
                        const pct = Math.round(fraction * 100);
                        setGenerationProgress(prev => ({
                            ...prev,
                            step: 'extracting',
                            currentItem: pct < 100
                                ? `Subiendo PDF al servidor… ${pct}%`
                                : 'Analizando estructura del documento…',
                            budgetId,
                        } as any));
                    },
                    // Sprint 4 Fase J — mirror cada transición a localStorage.
                    // Persistimos gcsUri + strategy + uid para poder reanudar
                    // el dispatch desde `awaiting_confirm` sin re-subir el PDF.
                    onPhaseChange: (phase, extra) => {
                        persistActiveJob({
                            phase,
                            uid: user?.uid,
                            ...(extra?.gcsUri && { gcsUri: extra.gcsUri }),
                            ...(extra?.strategy && { strategy: extra.strategy }),
                            ...(extra?.extractedMetadata && {
                                extractedMetadata: extra.extractedMetadata,
                            }),
                        });
                    },
                    onMetadataConfirm: isAdmin
                        ? (extracted) =>
                              new Promise((resolve) => {
                                  pdfMetadataResolverRef.current = resolve;
                                  setPdfMetadataPromptInitial({
                                      clientName: extracted.clientName || '',
                                      budgetTitle: extracted.budgetTitle || '',
                                      confidence: extracted.confidence || 0,
                                  });
                                  setPdfMetadataPromptOpen(true);
                              })
                        : undefined,
                });
                if (newRes.success) {
                    // Stash pipelineJobId on the progress state so the
                    // <BudgetGenerationProgress> mount renders the controls.
                    setGenerationProgress(prev => ({
                        ...prev,
                        budgetId: newRes.budgetId,
                        pipelineJobId: newRes.jobId,
                    } as any));
                    // Sprint 4 Fase I — persistir para sobrevivir reload.
                    persistActiveJob({
                        budgetId: newRes.budgetId,
                        jobId: newRes.jobId,
                        leadId: effectiveId,
                        startedAt: Date.now(),
                        phase: 'running',
                        conversationId: conversationId || null,
                    });
                    return; // SSE telemetry takes over from here.
                }
                // Surface the failure exactly like the legacy path does.
                throw new Error(newRes.error);
            }

            const { extractMeasurementPdfAction } = await import('@/actions/budget/extract-measurement-pdf.action');
            const result = await extractMeasurementPdfAction(formData, effectiveId, strategy, budgetId);

            if (result.success && result.budgetId) {
                if (result.isPending) {
                    // El panel ya está escuchando — los eventos del Python avanzan las fases solos.
                    // Sprint 4 Fase I — persistir para sobrevivir reload.
                    persistActiveJob({
                        budgetId: result.budgetId,
                        leadId: effectiveId,
                        startedAt: Date.now(),
                        phase: 'running',
                        conversationId: conversationId || null,
                    });
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
            // Sprint 4 Fase I — limpiar persistencia en error.
            clearActiveJob();
            setTimeout(() => setState('idle'), 3000);
        }
    };

    /**
     * Sprint 4 Fase L — handler nativo BC3 (FIEBDC-3).
     *
     * Flujo simplificado vs PDF:
     *  - NO necesita `extractPdfMetadataAction` (el BC3 ya trae title del root).
     *  - NO abre el dialog de confirmación de cliente/título.
     *  - Upload directo a Storage → dispatch → SSE.
     *
     * El backend detecta la extensión `.bc3` del gcsUri y enruta al
     * `Bc3Parser` saltando el extractor PDF.
     */
    const handleFastTrackBc3 = async (file: File) => {
        const budgetId = uuidv4();

        persistActiveJob({
            budgetId,
            leadId: leadId || undefined,
            startedAt: Date.now(),
            phase: 'uploading',
            fileName: file.name,
            uid: user?.uid,
            strategy: 'INLINE', // no aplica a BC3 pero el tipo lo requiere
            conversationId: conversationId || null,
        });

        setState('processing');
        setGenerationProgress({
            step: 'extracting',
            currentItem: 'Subiendo BC3 al servidor…',
            budgetId,
        } as any);

        try {
            const { isPipelineJobsEnabled } = await import('@/lib/feature-flags');
            const effectiveId = isAdmin ? 'admin-user' : (leadId || 'unknown-lead');

            if (isPipelineJobsEnabled() && user?.uid) {
                const { uploadPdfForPipelineJob } = await import('@/lib/firebase/storage-uploader');
                const { dispatchPipelineJobAction } = await import(
                    '@/actions/pipeline/dispatch-pipeline-job.action'
                );
                // 1. Upload BC3 al bucket (mismo path que PDF — backend detecta extensión).
                const uploaded = await uploadPdfForPipelineJob({
                    file,
                    uid: user.uid,
                    jobId: budgetId, // reusamos el budgetId como job-relative path
                    onProgress: (fraction) => {
                        const pct = Math.round(fraction * 100);
                        setGenerationProgress(prev => ({
                            ...prev,
                            step: 'extracting',
                            currentItem: pct < 100
                                ? `Subiendo BC3 al servidor… ${pct}%`
                                : 'Lanzando el motor de cálculo…',
                            budgetId,
                        } as any));
                    },
                });
                persistActiveJob({
                    phase: 'dispatching',
                    gcsUri: uploaded.gcsUri,
                });

                // 2. Dispatch (sin extract-metadata, sin dialog).
                const res = await dispatchPipelineJobAction({
                    jobType: 'measurements',
                    uid: user.uid,
                    leadId: effectiveId,
                    budgetId,
                    payload: {
                        gcsUri: uploaded.gcsUri,
                        // strategy se ignora para BC3 en backend, pero el campo es required.
                        strategy: 'INLINE',
                    },
                });
                if (!res.success) {
                    throw new Error(res.error);
                }
                setGenerationProgress(prev => ({
                    ...prev,
                    budgetId,
                    pipelineJobId: res.jobId,
                } as any));
                persistActiveJob({
                    budgetId,
                    jobId: res.jobId,
                    leadId: effectiveId,
                    startedAt: Date.now(),
                    phase: 'running',
                    conversationId: conversationId || null,
                });
                return; // SSE telemetry takes over from here.
            }

            // Sin pipeline jobs (flag off): no soportamos BC3 por el path legacy.
            throw new Error('BC3 requiere el pipeline de jobs (NEXT_PUBLIC_USE_PIPELINE_JOBS=true).');
        } catch (error: any) {
            console.error("Fast Track BC3 processing failed", error);
            setGenerationProgress({ step: 'error', error: error.message || "Error procesando el BC3." });
            clearActiveJob();
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

    /**
     * Punto de entrada del botón "Generar". Si somos admin y aún no tenemos
     * `clientName` + `budgetTitle`, abre un modal para capturarlos antes de
     * dispatchear. En modo demo público o lead anónimo se salta el prompt y
     * pasa directo a `runGeneration`.
     */
    const handleGenerateBudget = async () => {
        if (!requirements || !requirements.specs) return;
        if (isAdmin && (!clientName.trim() || !budgetTitle.trim())) {
            setClientPromptOpen(true);
            return;
        }
        await runGeneration();
    };

    const handleConfirmClientPrompt = async (name: string, title: string) => {
        setClientName(name);
        setBudgetTitle(title);
        setClientPromptOpen(false);
        // Esperar un microtask para que el setState se aplique antes de leerlo
        // en runGeneration via closure (el componente re-renderiza primero).
        await Promise.resolve();
        await runGeneration({ overrideClientName: name, overrideBudgetTitle: title });
    };

    const runGeneration = async (overrides?: { overrideClientName?: string; overrideBudgetTitle?: string }) => {
        if (!requirements || !requirements.specs) return;

        // Si vienen overrides desde el modal, usamos esos valores (el state aún
        // puede no haber re-renderizado a tiempo).
        const effectiveClientName = (overrides?.overrideClientName ?? clientName).trim();
        const effectiveBudgetTitle = (overrides?.overrideBudgetTitle ?? budgetTitle).trim();

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
                // Capturados via prompt antes del dispatch (solo admin). El
                // action de Python pone el nombre en clientSnapshot.name y el
                // título en Budget.title.
                clientName: effectiveClientName || undefined,
                budgetTitle: effectiveBudgetTitle || undefined,
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
                // Sprint 4 Fase I — persistir para sobrevivir reload.
                const pendingBudgetId = (result as any).budgetId || budgetId;
                if (pendingBudgetId) {
                    persistActiveJob({
                        budgetId: pendingBudgetId,
                        leadId: leadId || undefined,
                        startedAt: Date.now(),
                        phase: 'running',
                        conversationId: conversationId || null,
                    });
                }
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
                clearActiveJob();
            }
        } catch (e) {
            console.error(e);
            clearActiveJob();
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
                                onClick={() => { setGenerationProgress({ step: 'idle' }); startNewConversation(); }}
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
                {/* Header retirado: se gana altura visual para el chat. El toggle
                    del sidebar y el banner de refine viven ahora dentro de la sticky
                    bar de fases (más abajo) para no perder accesibilidad. */}

                {/* Messages Area. El PhaseStepper sigue sticky en `top-0` (sin
                    header arriba que compensar). */}
                <div className="flex-1 overflow-y-auto p-0 custom-scrollbar relative bg-background/50 leading-relaxed px-4 md:px-6">
                    {/* Sticky bar bajo el header. En PDF flow (con partidas resueltas)
                        mostramos `BudgetSummaryBar` con stats agregadas; en NL flow
                        sigue `PhaseStepper` con el progreso conversacional. */}
                    {messages.length > 0 && (() => {
                        const stats = computeBudgetStats(progressSubEvents);
                        const showSummaryBar = stats.partidasCount > 0;
                        return (
                            <div className="sticky top-0 z-[5] -mx-4 md:-mx-6 bg-background/85 backdrop-blur-md border-b border-black/5 dark:border-white/5 px-4 md:px-6 py-2.5">
                                <div className="max-w-3xl mx-auto flex items-center gap-2 md:gap-3">
                                    {/* Toggle del sidebar reubicado aquí tras quitar el header. */}
                                    {isAdmin && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                                            className="shrink-0 text-muted-foreground hover:text-primary transition-colors hidden md:flex"
                                            aria-label={isSidebarOpen ? "Ocultar listado de chats" : "Mostrar listado de chats"}
                                        >
                                            {isSidebarOpen ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
                                        </Button>
                                    )}
                                    <div className="flex-1 min-w-0">
                                        {showSummaryBar
                                            ? <BudgetSummaryBar subEvents={progressSubEvents} totalTasks={generationProgress.extractedItems} />
                                            : <PhaseStepper requirements={requirements} />}
                                    </div>
                                    {refineBanner && (
                                        <div className="hidden md:flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs shrink-0">
                                            <Sparkles className="h-3.5 w-3.5 text-primary" />
                                            <span className="font-medium">{refineBanner.name}</span>
                                            <Link
                                                href={`/dashboard/leads/${targetLeadIdFromQuery}`}
                                                className="ml-1 text-[10px] text-primary hover:underline"
                                            >
                                                ver lead →
                                            </Link>
                                        </div>
                                    )}
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

                    {/* pt-4: ya no hay header arriba que compensar. pb-44: aire
                        extra sobre el input bar para que pastillas y último
                        mensaje no queden tapados por la caja de texto. */}
                    <div className="max-w-3xl mx-auto pt-4 md:pt-6 pb-44 md:pb-48 space-y-6 md:space-y-8 flex flex-col items-center">
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
                                        pipelineJobId={generationProgress.pipelineJobId}
                                        // Sprint 4 Fase J — el cronómetro arranca desde el
                                        // startedAt persistido, no desde el mount. Sin esto
                                        // el contador volvía a 00:00 al cambiar de conv.
                                        startedAtMs={readActiveJob()?.startedAt}
                                        onSubEventsChange={setProgressSubEvents}
                                        onComplete={(budgetId) => {
                                            // Sprint 4 Fase I — limpiar persistencia al completar.
                                            clearActiveJob();
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
                            
                            {/* BC3 detection card (F7) */}
                            {bc3Detect && (
                                <div className="px-3 pt-3">
                                    <Bc3DetectCard loading={bc3Detect.loading} error={bc3Detect.error} result={bc3Detect.data} />
                                </div>
                            )}

                            {/* Pending Files Preview Area */}
                            {pendingFiles.length > 0 && (
                                <div className="flex flex-wrap gap-2 px-3 pt-3 pb-1 animate-in fade-in slide-in-from-top-2 duration-300 ease-out">
                                    {pendingFiles.map((file, i) => {
                                        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
                                        const isBc3 = file.name.toLowerCase().endsWith('.bc3');
                                        return (
                                            <div key={i} className="relative group flex items-center gap-2 bg-[#2a2b2e] border border-white/5 shadow-[0_2px_10px_rgba(0,0,0,0.2)] rounded-xl py-1.5 pl-3 pr-1.5">
                                                {isBc3 ? (
                                                    <FileText className="w-4 h-4 text-amber-400" />
                                                ) : isPdf ? (
                                                    <FileText className="w-4 h-4 text-blue-400" />
                                                ) : (
                                                    <ImageIcon className="w-4 h-4 text-emerald-400" />
                                                )}
                                                <span className="text-[13px] font-medium text-white/90 max-w-[180px] truncate tracking-tight">{file.name}</span>
                                                {isBc3 && (
                                                    <span className="text-[9px] font-bold tracking-wider uppercase text-amber-300/90 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded">
                                                        BC3
                                                    </span>
                                                )}
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
                                                accept="image/*,application/pdf,.bc3"
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

            <ClientPromptDialog
                open={clientPromptOpen}
                defaultClientName={clientName}
                defaultBudgetTitle={budgetTitle}
                onCancel={() => setClientPromptOpen(false)}
                onConfirm={handleConfirmClientPrompt}
            />

            <PdfMetadataPromptDialog
                open={pdfMetadataPromptOpen}
                initial={pdfMetadataPromptInitial}
                onCancel={() => {
                    setPdfMetadataPromptOpen(false);
                    pdfMetadataResolverRef.current?.(null);
                    pdfMetadataResolverRef.current = null;
                }}
                onConfirm={(name, title) => {
                    setPdfMetadataPromptOpen(false);
                    pdfMetadataResolverRef.current?.({
                        clientName: name || undefined,
                        budgetTitle: title || undefined,
                    });
                    pdfMetadataResolverRef.current = null;
                }}
            />

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

// ─────────────────────────────────────────────────────────────────
// Prompt previo a la generación: pide nombre del cliente + título del
// presupuesto. Se muestra solo cuando el admin pulsa "Generar" sin
// haberlos rellenado todavía. El callback `onConfirm` recibe los
// valores definitivos para invocar `runGeneration`.
// ─────────────────────────────────────────────────────────────────
function ClientPromptDialog({
    open, defaultClientName, defaultBudgetTitle, onCancel, onConfirm,
}: {
    open: boolean;
    defaultClientName: string;
    defaultBudgetTitle: string;
    onCancel: () => void;
    onConfirm: (clientName: string, budgetTitle: string) => void;
}) {
    const [name, setName] = React.useState(defaultClientName);
    const [title, setTitle] = React.useState(defaultBudgetTitle);

    React.useEffect(() => { if (open) setName(defaultClientName); }, [open, defaultClientName]);
    React.useEffect(() => { if (open) setTitle(defaultBudgetTitle); }, [open, defaultBudgetTitle]);

    if (!open) return null;

    const canSubmit = !!name.trim() && !!title.trim();

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onCancel}>
            <div
                className="bg-background dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 max-w-md w-full mx-4 p-6"
                onClick={e => e.stopPropagation()}
            >
                <div className="mb-4">
                    <h3 className="text-lg font-semibold">Datos del presupuesto</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                        Antes de generar, dinos el nombre del cliente y un título para
                        este presupuesto. Quedarán guardados con el resultado.
                    </p>
                </div>

                <div className="space-y-3">
                    <div className="space-y-1">
                        <label className="text-xs font-medium">Nombre del cliente *</label>
                        <input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="Ej: Juan Pérez / Constructora XYZ SL"
                            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-background px-3 py-2 text-sm"
                            autoFocus
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-medium">Título del presupuesto *</label>
                        <input
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="Ej: Reforma cocina Calle Mayor 23"
                            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-background px-3 py-2 text-sm"
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-2 mt-5">
                    <Button variant="outline" onClick={onCancel}>Cancelar</Button>
                    <Button
                        onClick={() => onConfirm(name.trim(), title.trim())}
                        disabled={!canSubmit}
                        className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white"
                    >
                        Generar presupuesto
                    </Button>
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────
// Dialog mostrado tras subir un PDF de mediciones. Recibe los valores
// extraídos por Gemini Flash sobre la primera página y permite editar
// antes de disparar el dispatch del job. Si confidence es bajo (<0.5),
// los inputs aparecen vacíos para forzar revisión del usuario.
// ─────────────────────────────────────────────────────────────────
function PdfMetadataPromptDialog({
    open, initial, onCancel, onConfirm,
}: {
    open: boolean;
    initial: { clientName: string; budgetTitle: string; confidence: number } | null;
    onCancel: () => void;
    onConfirm: (clientName: string, budgetTitle: string) => void;
}) {
    const [name, setName] = React.useState('');
    const [title, setTitle] = React.useState('');

    React.useEffect(() => {
        if (!open || !initial) return;
        // Si la confianza es alta, prerellena; si es baja, deja vacío para
        // forzar al usuario a teclear (evita propagar alucinaciones).
        const hi = (initial.confidence || 0) >= 0.5;
        setName(hi ? initial.clientName : '');
        setTitle(hi ? initial.budgetTitle : '');
    }, [open, initial]);

    if (!open || !initial) return null;

    const lowConfidence = (initial.confidence || 0) < 0.5;
    const canSubmit = !!name.trim() && !!title.trim();

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onCancel}>
            <div
                className="bg-background dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 max-w-md w-full mx-4 p-6"
                onClick={e => e.stopPropagation()}
            >
                <div className="mb-4">
                    <h3 className="text-lg font-semibold">Confirma los datos del PDF</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                        Hemos analizado la primera página. Revisa cliente y título — luego
                        arrancaremos la valoración completa de partidas.
                    </p>
                </div>

                {lowConfidence && (
                    <div className="mb-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                        No hemos podido extraer los datos del encabezado con seguridad.
                        Rellénalos a mano.
                    </div>
                )}

                <div className="space-y-3">
                    <div className="space-y-1">
                        <label className="text-xs font-medium">Nombre del cliente *</label>
                        <input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="Ej: Juan Pérez / Constructora XYZ SL"
                            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-background px-3 py-2 text-sm"
                            autoFocus
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-medium">Título del presupuesto *</label>
                        <input
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="Ej: Reforma cocina Calle Mayor 23"
                            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-background px-3 py-2 text-sm"
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-2 mt-5">
                    <Button variant="outline" onClick={onCancel}>Cancelar</Button>
                    <Button
                        onClick={() => onConfirm(name.trim(), title.trim())}
                        disabled={!canSubmit}
                        className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white"
                    >
                        Arrancar valoración
                    </Button>
                </div>
            </div>
        </div>
    );
}

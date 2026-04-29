import { useState, useEffect, useRef, useCallback } from 'react';
import { BudgetRequirement } from '@/backend/budget/domain/budget-requirements';
import { useWidgetContext } from '@/context/budget-widget-context';

export type Message = {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt: Date;
    attachments?: string[];
    extractedInfo?: string[];
};

export type ConversationThread = {
    id: string;
    title: string;
    updatedAt: string;
    status: string;
};

export type WizardState = 'idle' | 'listening' | 'uploading' | 'processing' | 'processing_pdf' | 'generating' | 'review' | 'generated';

export const useBudgetWizard = (isAdmin: boolean = false) => {
    const { leadId } = useWidgetContext();
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [state, setState] = useState<WizardState>('idle');
    const [requirements, setRequirements] = useState<Partial<BudgetRequirement>>({});

    // Multi-chat State
    const [conversations, setConversations] = useState<ConversationThread[]>([]);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [isLoadingChats, setIsLoadingChats] = useState(false);
    // v006 UX: flag dedicado para cuando estamos fetcheando mensajes de un thread
    // concreto (distinto de `isLoadingChats` que cubre la lista de threads).
    const [isLoadingMessages, setIsLoadingMessages] = useState(false);

    // We use a generic 'admin-user' ID for now, as auth is out of scope for the wizard component itself.
    const effectiveUserId = isAdmin ? 'admin-user' : (leadId || 'unknown-lead');

    // 1. Initial Load
    useEffect(() => {
        if (!isAdmin && effectiveUserId === 'unknown-lead') return;

        loadConversations();
    }, [isAdmin, effectiveUserId]);

    const loadConversations = async (preventSwitch: boolean = false) => {
        setIsLoadingChats(true);
        try {
            if (isAdmin) {
                // Admin Mode: Load all thread history
                const { getAdminConversationsAction } = await import('@/actions/chat/get-admin-conversations.action');
                const result = await getAdminConversationsAction(effectiveUserId);

                if (result.success && result.conversations && result.conversations.length > 0) {
                    setConversations(result.conversations);
                    if (!preventSwitch) {
                        switchConversation(result.conversations[0].id);
                    }
                }
            } else {
                // Lead Mode: Just load the default conversation for this lead
                const { getConversationAction } = await import('@/actions/chat/get-conversation.action');
                const result = await getConversationAction(effectiveUserId);

                if (result.success && result.messages) {
                    setConversationId(result.conversationId || null);
                    if (result.messages.length > 0) {
                        setMessages(result.messages.map((m: any) => ({
                            id: m.id,
                            role: m.role,
                            content: m.content,
                            createdAt: new Date(m.createdAt),
                            attachments: (m.attachments || []).map((a: any) => typeof a === 'string' ? a : a.url)
                        })));
                    }
                }
            }
        } catch (error) {
            console.error("Failed to load conversations:", error);
        } finally {
            setIsLoadingChats(false);
        }
    };

    const switchConversation = async (id: string | null) => {
        setConversationId(id);
        setMessages([]);
        setRequirements({});
        setState('idle');

        if (!id) return;

        setIsLoadingMessages(true);
        try {
            const { getConversationHistoryAction } = await import('@/actions/chat/get-conversation-history.action');
            const result = await getConversationHistoryAction(id);

            if (result.success && result.messages) {
                setMessages(result.messages.map((m: any) => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    createdAt: new Date(m.createdAt),
                    attachments: (m.attachments || []).map((a: any) => typeof a === 'string' ? a : a.url)
                })));
            }
        } catch (error) {
            console.error("Error switching conversation:", error);
        } finally {
            setIsLoadingMessages(false);
        }
    };

    const startNewConversation = async (): Promise<string | null> => {
        if (!isAdmin) return null;
        setIsLoadingChats(true);
        try {
            const { createAdminConversationAction } = await import('@/actions/chat/create-admin-conversation.action');
            const result = await createAdminConversationAction(effectiveUserId);
            if (result.success && result.conversationId) {
                // Refresh list and switch to new, preventing the inner switch to avoid race condition
                await loadConversations(true);
                switchConversation(result.conversationId);
                return result.conversationId;
            }
            return null;
        } catch (e) {
            console.error(e);
            return null;
        } finally {
            setIsLoadingChats(false);
        }
    };

    const deleteConversation = async (id: string) => {
        if (!isAdmin) return;
        try {
            const { deleteAdminConversationAction } = await import('@/actions/chat/delete-admin-conversation.action');
            await deleteAdminConversationAction(id);
            if (conversationId === id) {
                setConversationId(null);
                setMessages([]);
                setRequirements({});
            }
            // remove from state
            setConversations(prev => prev.filter(c => c.id !== id));
        } catch (e) {
            console.error(e);
        }
    };

    /**
     * Renombra una conversación. Optimistic UI: actualiza el estado local
     * antes de la respuesta del server. Si falla, revierte.
     */
    const renameConversation = async (id: string, newTitle: string) => {
        if (!isAdmin) return { success: false };
        const trimmed = (newTitle || '').trim();
        if (!trimmed) return { success: false, error: 'Título vacío' };

        const previous = conversations.find(c => c.id === id)?.title;
        // Optimistic update
        setConversations(prev => prev.map(c => (c.id === id ? { ...c, title: trimmed } : c)));
        try {
            const { renameAdminConversationAction } = await import('@/actions/chat/rename-admin-conversation.action');
            const res = await renameAdminConversationAction(id, trimmed);
            if (!res.success) {
                // Revert
                setConversations(prev => prev.map(c => (c.id === id ? { ...c, title: previous || c.title } : c)));
                return { success: false, error: res.error };
            }
            return { success: true };
        } catch (e: any) {
            setConversations(prev => prev.map(c => (c.id === id ? { ...c, title: previous || c.title } : c)));
            console.error(e);
            return { success: false, error: e.message };
        }
    };

    const resetConversation = async () => {
        if (!conversationId) {
            setMessages([]);
            setRequirements({});
            setState('idle');
            return;
        }
        
        try {
            const { archiveConversationAction } = await import('@/actions/chat/archive-conversation.action');
            await archiveConversationAction(conversationId);
            setConversationId(null);
            setMessages([]);
            setRequirements({});
            setState('idle');
            
            // Re-fetch to initialize a completely clean new chat
            await loadConversations();
        } catch (e) {
            console.error("Failed to reset conversation", e);
        }
    };


    const sendMessage = async (text: string, attachments: string[] = [], llmTextOverride?: string) => {
        if ((!text.trim() && attachments.length === 0) || !conversationId || state === 'generated') return;

        const tempId = Date.now().toString();
        const userMsg: Message = {
            id: tempId,
            role: 'user',
            content: text,
            createdAt: new Date(),
            attachments
        };

        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setState(attachments.length > 0 ? 'processing_pdf' : 'processing');

        try {
            // 1. Persist User Message
            const { sendMessageAction } = await import('@/actions/chat/send-message.action');
            await sendMessageAction(
                conversationId,
                text,
                isAdmin ? 'admin' : 'lead',
                effectiveUserId,
                attachments
            );

            // 2. Process AI Response
            await processAIResponse(llmTextOverride || text, attachments);

        } catch (error) {
            console.error("Failed to send message:", error);
            setState('idle');
        }
    };

    const processHiddenMessage = async (context: string) => {
        if (!conversationId) return;
        setState('processing');
        await processAIResponse(context, [], true);
    };

    const processAIResponse = async (text: string, attachments: string[] = [], isHidden: boolean = false) => {
        if (!conversationId) return;

        const history = messages.map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            content: [{ text: m.content }],
        }));

        // Streaming real: solo para admin sin adjuntos (por simplicidad y porque
        // el flujo del cliente tiene rate-limits y ramas que aún no están en el endpoint).
        const canStream = isAdmin && attachments.length === 0;

        if (canStream) {
            try {
                const ok = await streamAssistantResponse({
                    conversationId,
                    effectiveUserId,
                    text,
                    history,
                    requirements,
                    setMessages,
                    setRequirements,
                    setState,
                });
                if (ok) return;
                // Si falló el streaming, caemos al fallback síncrono
            } catch (e) {
                console.warn('[wizard] streaming falló, fallback a acción síncrona', e);
            }
        }

        try {
            let result;
            if (isAdmin) {
                const { processAdminMessageAction } = await import('@/actions/budget/process-admin-message.action');
                result = await processAdminMessageAction(conversationId, text, history, requirements, attachments);
            } else {
                const { processClientMessageAction } = await import('@/actions/budget/process-client-message.action');
                result = await processClientMessageAction(effectiveUserId, text, history, requirements, attachments);
            }

            if (result.success && result.data) {
                // Compute differences for Dynamic Context Pills
                const prevNeedsCount = requirements.detectedNeeds?.length || 0;
                const currentNeeds = result.data.updatedRequirements?.detectedNeeds || [];
                const newNeeds = currentNeeds.slice(prevNeedsCount);
                const extractedInfo = newNeeds.map((n: any) => `${n.category}: ${n.description}`);

                const extractedSpecs = [];
                if (!requirements.specs?.totalArea && result.data.updatedRequirements?.specs?.totalArea) {
                    extractedSpecs.push(`Área: ${result.data.updatedRequirements.specs.totalArea}m²`);
                }
                if (!requirements.specs?.propertyType && result.data.updatedRequirements?.specs?.propertyType) {
                    extractedSpecs.push(`Propiedad: ${result.data.updatedRequirements.specs.propertyType}`);
                }
                if (!requirements.specs?.qualityLevel && result.data.updatedRequirements?.specs?.qualityLevel) {
                    extractedSpecs.push(`Calidad: ${result.data.updatedRequirements.specs.qualityLevel}`);
                }

                const allExtractedInfo = [...extractedInfo, ...extractedSpecs];

                const aiMsg: Message = {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: result.data.response,
                    createdAt: new Date(),
                    extractedInfo: allExtractedInfo.length > 0 ? allExtractedInfo : undefined
                };

                setMessages(prev => [...prev, aiMsg]);
                setRequirements(result.data.updatedRequirements);

                // Persist AI Message
                const { sendMessageAction } = await import('@/actions/chat/send-message.action');
                await sendMessageAction(conversationId, result.data.response, 'assistant', 'system');

                const data = result.data as any;

                if (data.isLimitReached) {
                    setState('idle');
                } else if (data.isComplete) {
                    setState('review');
                } else {
                    setState('idle');
                }
            } else {
                console.error("AI Error:", result.error);
                setState('idle');
            }
        } catch (error) {
            console.error("Failed to process AI response", error);
            setState('idle');
        }
    };

    const addSystemMessage = async (text: string) => {
        if (!conversationId) return;

        const aiMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant', // Rendered as secondary/dark bubble
            content: text,
            createdAt: new Date(),
        };

        setMessages(prev => [...prev, aiMsg]);

        try {
            const { sendMessageAction } = await import('@/actions/chat/send-message.action');
            await sendMessageAction(conversationId, text, 'assistant', 'system');
        } catch (error) {
            console.error("Failed to persist system msg", error);
        }
    };

    return {
        messages,
        input,
        setInput,
        sendMessage,
        addSystemMessage,
        processHiddenMessage,
        state,
        setState,
        requirements,
        // New exports for multi-chat UI
        conversations,
        conversationId,
        isLoadingChats,
        isLoadingMessages,
        startNewConversation,
        switchConversation,
        deleteConversation,
        renameConversation,
        resetConversation
    };
};

/**
 * Consume el endpoint SSE `/api/assistant/stream`, actualizando progresivamente
 * el último mensaje del asistente. Persiste el mensaje final y aplica los
 * `updatedRequirements`. Devuelve true si ha tenido éxito.
 */
async function streamAssistantResponse(args: {
    conversationId: string;
    effectiveUserId: string;
    text: string;
    history: Array<{ role: string; content: any[] }>;
    requirements: Partial<BudgetRequirement>;
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    setRequirements: React.Dispatch<React.SetStateAction<Partial<BudgetRequirement>>>;
    setState: React.Dispatch<React.SetStateAction<WizardState>>;
}): Promise<boolean> {
    const { conversationId, effectiveUserId, text, history, requirements, setMessages, setRequirements, setState } = args;

    const placeholderId = `stream-${Date.now()}`;
    setMessages(prev => [...prev, {
        id: placeholderId,
        role: 'assistant',
        content: '',
        createdAt: new Date(),
    }]);

    const appendToPlaceholder = (piece: string) => {
        setMessages(prev => prev.map(m => m.id === placeholderId ? { ...m, content: m.content + piece } : m));
    };
    const replacePlaceholder = (finalText: string, extractedInfo?: string[]) => {
        setMessages(prev => prev.map(m => m.id === placeholderId ? { ...m, content: finalText, extractedInfo } : m));
    };

    let response: Response;
    try {
        response = await fetch('/api/assistant/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: effectiveUserId,
                userMessage: text,
                history,
            }),
        });
    } catch (e) {
        setMessages(prev => prev.filter(m => m.id !== placeholderId));
        return false;
    }

    if (!response.ok || !response.body) {
        setMessages(prev => prev.filter(m => m.id !== placeholderId));
        return false;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let finalReply = '';
    let finalRequirements: any = null;
    let gotError = false;

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE: separador de eventos es `\n\n`
        let sepIdx;
        while ((sepIdx = buf.indexOf('\n\n')) !== -1) {
            const raw = buf.slice(0, sepIdx);
            buf = buf.slice(sepIdx + 2);
            if (!raw.trim() || raw.startsWith(':')) continue; // heartbeat

            let eventName = 'message';
            const dataLines: string[] = [];
            for (const line of raw.split('\n')) {
                if (line.startsWith('event:')) eventName = line.slice(6).trim();
                else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
            }
            const payloadStr = dataLines.join('\n');
            if (!payloadStr) continue;
            let payload: any;
            try { payload = JSON.parse(payloadStr); } catch { continue; }

            if (eventName === 'text' && typeof payload.text === 'string') {
                appendToPlaceholder(payload.text);
            } else if (eventName === 'done') {
                finalReply = payload.reply || '';
                finalRequirements = payload.updatedRequirements || {};
            } else if (eventName === 'error') {
                gotError = true;
                console.error('[assistant:stream] error event', payload.message);
            }
        }
    }

    if (gotError || !finalReply) {
        setMessages(prev => prev.filter(m => m.id !== placeholderId));
        return false;
    }

    // Calcular chips de info extraída (mismo cálculo que la rama síncrona)
    const prevNeedsCount = requirements.detectedNeeds?.length || 0;
    const currentNeeds = (finalRequirements?.detectedNeeds as any[]) || [];
    const newNeeds = currentNeeds.slice(prevNeedsCount);
    const extractedInfo = newNeeds.map((n: any) => `${n.category}: ${n.description}`);
    const extras: string[] = [];
    if (!requirements.specs?.totalArea && finalRequirements?.specs?.totalArea) {
        extras.push(`Área: ${finalRequirements.specs.totalArea}m²`);
    }
    if (!requirements.specs?.propertyType && finalRequirements?.specs?.propertyType) {
        extras.push(`Propiedad: ${finalRequirements.specs.propertyType}`);
    }
    if (!requirements.specs?.qualityLevel && finalRequirements?.specs?.qualityLevel) {
        extras.push(`Calidad: ${finalRequirements.specs.qualityLevel}`);
    }
    const allExtracted = [...extractedInfo, ...extras];

    replacePlaceholder(finalReply, allExtracted.length > 0 ? allExtracted : undefined);
    setRequirements(finalRequirements);

    // Persistir el mensaje final
    try {
        const { sendMessageAction } = await import('@/actions/chat/send-message.action');
        await sendMessageAction(conversationId, finalReply, 'assistant', 'system');
    } catch (e) {
        console.error('[wizard] failed to persist streamed assistant msg', e);
    }

    if (finalRequirements?.isReadyForGeneration) {
        setState('review');
    } else {
        setState('idle');
    }

    return true;
}

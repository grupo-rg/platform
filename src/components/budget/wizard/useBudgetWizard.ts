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

        try {
            // Re-use the existing action to get messages by conversationId, but 
            // since getConversationAction expects leadId, we have an architecture mismatch.
            // Wait, getConversationAction expects leadId, but internally it uses GetOrCreateConversationUseCase.
            // We need an action to get specifically the messages for a known conversationId.
            // Let's import the specific usecase logic inline or via action later. 
            // For now, let's load it from getConversationHistory action if it exists.
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
        }
    };

    const startNewConversation = async () => {
        if (!isAdmin) return;
        setIsLoadingChats(true);
        try {
            const { createAdminConversationAction } = await import('@/actions/chat/create-admin-conversation.action');
            const result = await createAdminConversationAction(effectiveUserId);
            if (result.success && result.conversationId) {
                // Refresh list and switch to new, preventing the inner switch to avoid race condition
                await loadConversations(true);
                switchConversation(result.conversationId);
            }
        } catch (e) {
            console.error(e);
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

        try {
            const history = messages.map(m => ({
                role: m.role === 'user' ? 'user' : 'model',
                content: [{ text: m.content }]
            }));

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
        startNewConversation,
        switchConversation,
        deleteConversation,
        resetConversation
    };
};

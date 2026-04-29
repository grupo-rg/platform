'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Send,
    Bot,
    User as UserIcon,
    Loader2,
    Paperclip,
    Image as ImageIcon,
    X,
    AlertTriangle,
    Bath,
    UtensilsCrossed,
    Home,
    Building2,
    Sparkles,
    MapPin,
    Ruler,
    Calendar,
    Camera,
} from 'lucide-react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { processPublicChatAction } from '@/actions/chat/process-public-chat.action';
import { useVerifiedLead } from '@/hooks/use-verified-lead';
import { InlineBookingPicker } from '@/components/chat/InlineBookingPicker';

const SESSION_STORAGE_KEY = 'rg_public_chat_session_id';
const HISTORY_STORAGE_KEY_PREFIX = 'rg_public_chat_history_';

const ANON_WELCOME = `¡Hola! Soy el asistente de Grupo RG. ¿En qué obra estás pensando? Cuéntame tipo, ubicación y lo que tienes en mente — si tienes fotos puedes adjuntarlas.`;

const verifiedWelcome = (firstName: string) =>
    `¡Hola ${firstName}! Soy el asistente de Grupo RG. Como ya estás identificado, vamos directos al grano: ¿qué obra tienes en mente? Tipo, ubicación, m² aproximados y lo que estés visualizando — si tienes fotos, adjúntalas.`;

interface QuickStarter {
    Icon: any;
    label: string;
    prompt: string;
    accent: string;
}

const QUICK_STARTERS: QuickStarter[] = [
    {
        Icon: Bath,
        label: 'Reforma de baño',
        prompt: 'Quiero reformar mi baño. Te cuento: ',
        accent: 'bg-cyan-50 border-cyan-200 text-cyan-700 hover:bg-cyan-100 dark:bg-cyan-500/10 dark:border-cyan-800 dark:text-cyan-300',
    },
    {
        Icon: UtensilsCrossed,
        label: 'Reforma de cocina',
        prompt: 'Quiero reformar mi cocina. Te cuento: ',
        accent: 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/10 dark:border-amber-800 dark:text-amber-300',
    },
    {
        Icon: Home,
        label: 'Reforma integral',
        prompt: 'Quiero hacer una reforma integral de mi vivienda. Te cuento: ',
        accent: 'bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100 dark:bg-violet-500/10 dark:border-violet-800 dark:text-violet-300',
    },
    {
        Icon: Building2,
        label: 'Obra nueva',
        prompt: 'Quiero construir desde cero. Te cuento: ',
        accent: 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-800 dark:text-emerald-300',
    },
];

interface QuickReply {
    Icon: any;
    label: string;
    text: string;
}

/**
 * Quick replies sugeridos según el último mensaje del agente. Heurística
 * simple basada en keywords; el agente puede mencionar "m²", "fotos", "plazo"
 * y mostramos atajos. No depende del LLM — es 100% cliente.
 */
function suggestQuickReplies(lastAgentMessage: string | null): QuickReply[] {
    if (!lastAgentMessage) return [];
    const lower = lastAgentMessage.toLowerCase();
    const replies: QuickReply[] = [];

    if (/(m²|m2|metros|superficie|tamaño|tamano)/.test(lower)) {
        replies.push({ Icon: Ruler, label: '≈ 40 m²', text: 'Aproximadamente 40 m².' });
        replies.push({ Icon: Ruler, label: '≈ 80 m²', text: 'Aproximadamente 80 m².' });
        replies.push({ Icon: Ruler, label: 'No estoy seguro', text: 'No tengo claros los metros cuadrados todavía, ¿cómo lo medimos?' });
    }
    if (/(foto|imagen|adjunt|imagina|ver)/.test(lower)) {
        replies.push({ Icon: Camera, label: 'Subiré fotos', text: 'Sí, voy a adjuntar fotos del estado actual.' });
    }
    if (/(plazo|cuándo|cuando|empezar|fecha|tiempo)/.test(lower)) {
        replies.push({ Icon: Calendar, label: 'Lo antes posible', text: 'Quiero empezar lo antes posible.' });
        replies.push({ Icon: Calendar, label: 'En 1-3 meses', text: 'En 1-3 meses idealmente.' });
        replies.push({ Icon: Calendar, label: 'Sin prisa', text: 'No tengo prisa, podemos planificar con calma.' });
    }
    if (/(dónde|donde|ubicación|ubicacion|zona|ciudad|código postal|codigo postal)/.test(lower)) {
        replies.push({ Icon: MapPin, label: 'Palma', text: 'Palma de Mallorca.' });
        replies.push({ Icon: MapPin, label: 'Otra zona', text: 'En otra zona de Mallorca.' });
    }
    if (/(presupuesto|coste|precio|cuánto|cuanto)/.test(lower)) {
        replies.push({ Icon: Sparkles, label: 'No tengo ref.', text: 'No tengo una referencia clara de presupuesto, por eso os contacto.' });
    }

    return replies.slice(0, 4);
}

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    attachments?: string[]; // data URLs (preview cliente) o URLs de Storage
    createdAt: number;
    /** Si este mensaje del agente vino con bookingSlots, los renderizamos como picker. */
    bookingSlots?: { date: string; startTime: string; endTime: string; label: string }[];
    /** LeadId asociado al mensaje cuando hay bookingSlots — necesario para confirmar. */
    bookingLeadId?: string;
}

interface PendingFile {
    id: string;
    file: File;
    base64: string; // sin prefijo data:
    previewUrl: string; // data: URL para preview
}

function getOrCreateSessionId(): string {
    if (typeof window === 'undefined') return '';
    let sid = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!sid) {
        sid = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        sessionStorage.setItem(SESSION_STORAGE_KEY, sid);
    }
    return sid;
}

export function PublicCommercialChat() {
    const locale = useLocale();
    const { lead: verifiedLead, isReady: isLeadVerified } = useVerifiedLead();
    const [sessionId, setSessionId] = useState<string>('');
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [pending, setPending] = useState<PendingFile[]>([]);
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const scrollRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Inicializa sessionId y rehidrata historial. Espera a que el hook
    // useVerifiedLead resuelva (verifiedLead === null o objeto) antes de
    // pintar bienvenida personalizada vs anónima.
    useEffect(() => {
        const sid = getOrCreateSessionId();
        setSessionId(sid);
        try {
            const raw = sessionStorage.getItem(HISTORY_STORAGE_KEY_PREFIX + sid);
            if (raw) {
                const parsed: ChatMessage[] = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    setMessages(parsed);
                    return;
                }
            }
        } catch {
            // ignorar
        }
        // Bienvenida personalizada si ya hay lead verificado, anónima si no.
        const firstName = verifiedLead?.name?.split(' ')[0];
        const welcome = isLeadVerified && firstName
            ? verifiedWelcome(firstName)
            : ANON_WELCOME;
        setMessages([
            {
                id: 'welcome',
                role: 'assistant',
                content: welcome,
                createdAt: Date.now(),
            },
        ]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLeadVerified, verifiedLead?.id]);

    // Persiste historial en sessionStorage cada vez que cambia.
    useEffect(() => {
        if (!sessionId || messages.length === 0) return;
        try {
            sessionStorage.setItem(
                HISTORY_STORAGE_KEY_PREFIX + sessionId,
                JSON.stringify(messages.slice(-30)) // límite por seguridad
            );
        } catch {
            // ignorar quota errors
        }
    }, [messages, sessionId]);

    // Auto-scroll al fondo cuando llegan mensajes.
    useEffect(() => {
        scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isSending]);

    const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;
        const accepted = Array.from(files).filter(f =>
            f.type.startsWith('image/') && f.size <= 10 * 1024 * 1024
        );
        const newPending: PendingFile[] = await Promise.all(
            accepted.map(async file => {
                const base64 = await readFileAsBase64(file);
                const cleanedBase64 = base64.replace(/^data:[^;]+;base64,/, '');
                return {
                    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    file,
                    base64: cleanedBase64,
                    previewUrl: base64,
                };
            })
        );
        setPending(prev => [...prev, ...newPending].slice(0, 5));
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, []);

    const removePending = (id: string) => {
        setPending(prev => prev.filter(p => p.id !== id));
    };

    const handleSend = async () => {
        const trimmed = input.trim();
        if (!trimmed && pending.length === 0) return;
        if (isSending) return;

        setError(null);

        const userMessage: ChatMessage = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: trimmed || (pending.length > 0 ? '(adjuntos)' : ''),
            attachments: pending.map(p => p.previewUrl),
            createdAt: Date.now(),
        };

        const newMessages = [...messages, userMessage];
        setMessages(newMessages);
        setInput('');
        const filesToSend = pending.map(p => p.base64);
        setPending([]);
        setIsSending(true);

        try {
            // Construimos history en el formato que espera el agente Genkit.
            const history = newMessages
                .filter(m => m.id !== 'welcome' && m.id !== userMessage.id)
                .map(m => ({
                    role: m.role === 'user' ? 'user' : 'model',
                    content: [{ text: m.content }],
                }));

            const result = await processPublicChatAction(
                trimmed || 'He adjuntado fotos para que las analices.',
                history,
                filesToSend.length > 0 ? filesToSend : undefined,
                undefined,
                locale,
                sessionId,
                verifiedLead?.id,
                verifiedLead?.name
            );

            if (!result.success) {
                setError(result.error || 'No se pudo procesar tu mensaje. Inténtalo de nuevo.');
                return;
            }

            // Si el agente cualificó al lead y devolvió slots de agenda, los
            // adjuntamos al mensaje para renderizar el InlineBookingPicker.
            const handoff = (result as any).handoff;
            const assistantMessage: ChatMessage = {
                id: `assistant-${Date.now()}`,
                role: 'assistant',
                content: result.response || '',
                createdAt: Date.now(),
                ...(handoff?.decision === 'qualified' && handoff?.bookingSlots?.length > 0
                    ? {
                          bookingSlots: handoff.bookingSlots,
                          bookingLeadId: handoff.leadId,
                      }
                    : {}),
            };
            setMessages(prev => [...prev, assistantMessage]);
        } catch (err: any) {
            console.error('[PublicCommercialChat] Error:', err);
            setError(err?.message || 'Error de conexión. Inténtalo de nuevo en unos segundos.');
        } finally {
            setIsSending(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const canSend = (input.trim().length > 0 || pending.length > 0) && !isSending;

    // Mostramos starters sólo si la conversación todavía no ha empezado
    // (sólo el mensaje de bienvenida está presente).
    const showStarters = messages.length === 1 && messages[0]?.id === 'welcome' && !isSending;

    // Quick replies según el último mensaje del agente.
    const lastAgentMessage = useMemo(() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant') return messages[i].content;
        }
        return null;
    }, [messages]);
    const quickReplies = useMemo(
        () => (showStarters ? [] : suggestQuickReplies(lastAgentMessage)),
        [lastAgentMessage, showStarters]
    );

    function applyStarter(prompt: string) {
        setInput(prompt);
    }

    function applyQuickReply(text: string) {
        setInput(text);
    }

    return (
        <div className="flex h-full w-full flex-col bg-background">
            {/* Mensajes */}
            <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
                <div className="mx-auto flex max-w-2xl flex-col gap-4">
                    <AnimatePresence initial={false}>
                        {messages.map(msg => (
                            <div key={msg.id}>
                                <ChatBubble message={msg} />
                                {msg.bookingSlots && msg.bookingSlots.length > 0 && msg.bookingLeadId && (
                                    <div className="ml-11 mt-1">
                                        <InlineBookingPicker
                                            leadId={msg.bookingLeadId}
                                            slots={msg.bookingSlots}
                                        />
                                    </div>
                                )}
                            </div>
                        ))}
                    </AnimatePresence>

                    {showStarters && (
                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 }}
                            className="grid grid-cols-2 gap-2.5 pt-2"
                        >
                            {QUICK_STARTERS.map(starter => (
                                <button
                                    key={starter.label}
                                    onClick={() => applyStarter(starter.prompt)}
                                    className={cn(
                                        'group flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all hover:scale-[1.02] active:scale-95',
                                        starter.accent
                                    )}
                                >
                                    <starter.Icon className="h-5 w-5" />
                                    <span className="text-sm font-semibold">{starter.label}</span>
                                </button>
                            ))}
                        </motion.div>
                    )}

                    {isSending && <TypingIndicator />}

                    {quickReplies.length > 0 && !isSending && (
                        <motion.div
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex flex-wrap gap-1.5 pt-1"
                        >
                            {quickReplies.map((qr, i) => (
                                <button
                                    key={`${qr.label}-${i}`}
                                    onClick={() => applyQuickReply(qr.text)}
                                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:bg-primary/5"
                                >
                                    <qr.Icon className="h-3 w-3 text-primary" />
                                    {qr.label}
                                </button>
                            ))}
                        </motion.div>
                    )}

                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-500/10 dark:text-rose-300">
                            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}
                    <div ref={scrollRef} />
                </div>
            </div>

            {/* Input */}
            <div className="border-t bg-background/80 px-4 py-4 backdrop-blur md:px-8">
                <div className="mx-auto max-w-2xl space-y-2">
                    {/* Pending files preview */}
                    {pending.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {pending.map(p => (
                                <div
                                    key={p.id}
                                    className="relative h-16 w-16 overflow-hidden rounded-lg border bg-muted"
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={p.previewUrl} alt="" className="h-full w-full object-cover" />
                                    <button
                                        onClick={() => removePending(p.id)}
                                        className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                                        aria-label="Quitar"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm focus-within:ring-1 focus-within:ring-primary/40">
                        <Textarea
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Cuéntame qué obra estás pensando…"
                            disabled={isSending}
                            rows={1}
                            className="min-h-[40px] max-h-32 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                        />
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            accept="image/*"
                            onChange={handleFileChange}
                            className="hidden"
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isSending || pending.length >= 5}
                            className="h-10 w-10 flex-shrink-0"
                            title="Adjuntar imagen"
                        >
                            <Paperclip className="h-4 w-4" />
                        </Button>
                        <Button
                            onClick={handleSend}
                            disabled={!canSend}
                            size="icon"
                            className="h-10 w-10 flex-shrink-0 rounded-full"
                        >
                            {isSending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Send className="h-4 w-4" />
                            )}
                        </Button>
                    </div>
                    <p className="text-center text-[11px] text-muted-foreground">
                        Tu conversación queda registrada. Un asesor revisará tu solicitud.
                    </p>
                </div>
            </div>
        </div>
    );
}

function ChatBubble({ message }: { message: ChatMessage }) {
    const isUser = message.role === 'user';
    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={cn('flex gap-2.5', isUser ? 'flex-row-reverse' : 'flex-row')}
        >
            <div
                className={cn(
                    'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full',
                    isUser
                        ? 'bg-primary/10 text-primary'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                )}
            >
                {isUser ? <UserIcon className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
            </div>
            <div className={cn('max-w-[80%]', isUser && 'text-right')}>
                <div
                    className={cn(
                        'inline-block rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                        isUser
                            ? 'rounded-br-sm bg-primary text-primary-foreground'
                            : 'rounded-bl-sm bg-muted text-foreground'
                    )}
                >
                    {message.attachments && message.attachments.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                            {message.attachments.map((url, i) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    key={i}
                                    src={url}
                                    alt=""
                                    className="h-20 w-20 rounded-lg object-cover"
                                />
                            ))}
                        </div>
                    )}
                    <p className="whitespace-pre-wrap break-words text-left">{message.content}</p>
                </div>
            </div>
        </motion.div>
    );
}

function TypingIndicator() {
    return (
        <div className="flex gap-2.5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                <Bot className="h-4 w-4" />
            </div>
            <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-3">
                <div className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/40 [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/40 [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/40" />
                </div>
            </div>
        </div>
    );
}

function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

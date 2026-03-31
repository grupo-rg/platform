'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ThumbsDown, ThumbsUp, BrainCircuit, X, Check, Loader2, Users } from 'lucide-react';
import { sileo } from 'sileo';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';
// We'll need a new server action to approve/reject feedback
import { moderatePublicFeedbackAction } from '@/actions/budget/moderate-feedback.action';

interface FeedbackItem {
    id: string;
    itemId: string;
    description: string;
    proposedPrice: number;
    vote: 'up' | 'down';
    reason?: string;
    timestamp: any;
}

interface CommunityFeedbackPanelProps {
    feedbacks: FeedbackItem[];
    traceId: string;
}

export function CommunityFeedbackPanel({ feedbacks: initialFeedbacks, traceId }: CommunityFeedbackPanelProps) {
    const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>(initialFeedbacks);
    const [isOpen, setIsOpen] = useState(true);
    const [isPending, startTransition] = useTransition();

    if (feedbacks.length === 0) return null;
    if (!isOpen) {
        return (
            <div className="fixed bottom-6 right-6 z-[60]">
                <Button onClick={() => setIsOpen(true)} className="rounded-full shadow-2xl bg-indigo-600 hover:bg-indigo-700 h-14 px-6 font-semibold animate-pulse">
                    <Users className="w-5 h-5 mr-2" />
                    Telemetría Pública ({feedbacks.length})
                </Button>
            </div>
        );
    }

    const handlePromote = (id: string) => {
        startTransition(async () => {
            const res = await moderatePublicFeedbackAction(id, 'golden');
            if (res.success) {
                setFeedbacks(prev => prev.filter(f => f.id !== id));
                sileo.success({ title: "Feedback Promovido", description: "Convertido a Regla de Oro Heurística 🧠" });
            } else {
                sileo.error({ title: "Error", description: res.error || "No se pudo promover el feedback." });
            }
        });
    };

    const handleReject = (id: string) => {
        startTransition(async () => {
            const res = await moderatePublicFeedbackAction(id, 'rejected');
            if (res.success) {
                setFeedbacks(prev => prev.filter(f => f.id !== id));
                sileo.info({ title: "Feedback Descartado", description: "Ocultado silenciosamente." });
            } else {
                sileo.error({ title: "Error", description: "Error descartando feedback." });
            }
        });
    };

    return (
        <div className="fixed right-6 top-24 bottom-6 w-[400px] z-[60] flex flex-col gap-4">
            <Card className="flex-1 flex flex-col shadow-2xl border-indigo-200/50 dark:border-indigo-900/50 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-xl overflow-hidden animate-in slide-in-from-right-8 duration-300">
                <CardHeader className="bg-indigo-50/50 dark:bg-indigo-900/20 border-b border-indigo-100 dark:border-indigo-900/50 pb-4 relative">
                    <Button variant="ghost" size="icon" className="absolute right-2 top-2 h-8 w-8 text-slate-400 hover:text-slate-600" onClick={() => setIsOpen(false)}>
                        <X className="w-4 h-4" />
                    </Button>
                    <CardTitle className="text-lg flex items-center gap-2 text-indigo-700 dark:text-indigo-400">
                        <Users className="w-5 h-5" /> Moderación RLHF
                    </CardTitle>
                    <CardDescription>
                        Feedback recopilado de la Demo Pública sobre esta traza. Promueve votos útiles a ejemplos de entrenamiento.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                    {feedbacks.map(f => (
                        <div key={f.id} className="p-4 rounded-xl border border-border bg-white dark:bg-zinc-900 hover:border-indigo-200 dark:hover:border-indigo-800 transition-colors shadow-sm">
                            <div className="flex justify-between items-start mb-2 gap-2">
                                <Badge variant={f.vote === 'up' ? "outline" : "destructive"} className="shrink-0 flex items-center gap-1">
                                    {f.vote === 'up' ? <ThumbsUp className="w-3 h-3 text-emerald-600" /> : <ThumbsDown className="w-3 h-3" />}
                                    {f.vote === 'up' ? "Aprobado" : "Rechazado"}
                                </Badge>
                                <span className="text-[10px] text-muted-foreground font-mono bg-secondary px-2 py-0.5 rounded">Precio IA: {formatCurrency(f.proposedPrice)}</span>
                            </div>
                            
                            <p className="text-xs text-foreground/80 font-medium mb-3 line-clamp-3">
                                {f.description}
                            </p>

                            {f.reason && f.vote === 'down' && (
                                <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/30 rounded p-2 mb-4">
                                    <p className="text-xs text-rose-700 dark:text-rose-400 font-medium">Motivo del usuario:</p>
                                    <p className="text-xs text-rose-600/80 dark:text-rose-300/80 italic">&quot;{f.reason}&quot;</p>
                                </div>
                            )}

                            <div className="flex gap-2 w-full mt-2 border-t border-border pt-3">
                                <Button 
                                    size="sm" 
                                    variant="outline" 
                                    className="flex-1 h-8 text-xs text-slate-500 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50" 
                                    onClick={() => handleReject(f.id)}
                                    disabled={isPending}
                                >
                                    <X className="w-3 h-3 mr-1" /> Descartar
                                </Button>
                                <Button 
                                    size="sm" 
                                    className="flex-1 h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white" 
                                    onClick={() => handlePromote(f.id)}
                                    disabled={isPending}
                                >
                                    <BrainCircuit className="w-3 h-3 mr-1" /> Promover a IA
                                </Button>
                            </div>
                        </div>
                    ))}
                    {feedbacks.length === 0 && (
                        <div className="text-center p-8 text-muted-foreground">
                            No hay más reportes pendientes.
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

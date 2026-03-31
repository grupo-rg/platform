'use client';

import { useState } from 'react';
import { useWidgetContext } from '@/context/budget-widget-context';
import { AgendaBooking } from '@/components/budget-widget/agenda-booking';
import { saveLeadFeedbackAction } from '@/actions/lead/save-lead-feedback.action';
import { CheckCircle2, Clock, Share2, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';

const PRICING_OPTIONS = [
    { value: '50-100', label: '50-100 €/mes' },
    { value: '100-200', label: '100-200 €/mes' },
    { value: '+200', label: 'Más de 200 €/mes' },
];

export default function WizardSuccessPage() {
    const { leadId } = useWidgetContext();
    const { toast } = useToast();
    const [feedbackSent, setFeedbackSent] = useState(false);
    const [submittingFeedback, setSubmittingFeedback] = useState(false);
    const [frictionText, setFrictionText] = useState('');

    const handlePricingSelect = async (val: string) => {
        if (!leadId) return;
        setSubmittingFeedback(true);
        const result = await saveLeadFeedbackAction(leadId, { willingToPay: val });
        setSubmittingFeedback(false);
        if (result.success) {
            setFeedbackSent(true);
            toast({ title: '¡Gracias por tu opinión!', description: 'Nos ayuda a seguir mejorando la herramienta.' });
        } else {
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudo guardar la respuesta.' });
        }
    };

    const handleFrictionSubmit = async () => {
        if (!leadId || !frictionText.trim()) return;
        setSubmittingFeedback(true);
        const result = await saveLeadFeedbackAction(leadId, { friction: frictionText });
        setSubmittingFeedback(false);
        if (result.success) {
            setFrictionText('');
            toast({ title: 'Feedback recibido', description: '¡Tomamos nota!' });
        }
    };

    return (
        <div className="flex flex-col lg:flex-row h-[100dvh] w-full bg-background overflow-hidden">
            {/* Left Side: Success Message & Feedback */}
            <div className="w-full lg:w-1/2 flex flex-col items-center justify-center p-8 lg:px-16 space-y-10 overflow-y-auto custom-scrollbar">

                <div className="text-center w-full max-w-md animate-in fade-in slide-in-from-bottom-8 duration-700">
                    <div className="mx-auto h-20 w-20 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center shadow-lg shadow-green-500/20 mb-6 relative">
                        <CheckCircle2 className="h-10 w-10 text-white relative z-10" />
                        <div className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-20"></div>
                    </div>
                    <h1 className="text-4xl lg:text-5xl font-extrabold text-foreground mb-4 font-display tracking-tight">¡Misión Cumplida!</h1>
                    <p className="text-lg text-muted-foreground leading-relaxed">
                        Tu presupuesto ha sido generado con éxito y enviado directo a tu espacio de trabajo.
                    </p>
                </div>

                <div className="w-full max-w-md bg-secondary/20 dark:bg-white/5 border border-border/50 rounded-3xl p-6 lg:p-8 animate-in fade-in slide-in-from-bottom-12 duration-700 delay-150 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                        <Sparkles className="w-32 h-32 text-primary rotate-12" />
                    </div>

                    <h3 className="font-bold text-xl text-foreground mb-2 flex items-center gap-2 relative z-10">
                        Ayúdanos a mejorar <span className="text-primary text-2xl">💡</span>
                    </h3>

                    <AnimatePresence mode="wait">
                        {!feedbackSent ? (
                            <motion.div
                                key="question"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="relative z-10"
                            >
                                <p className="text-sm text-muted-foreground mb-5">
                                    Estamos perfeccionando nuestra IA. ¿Cuánto estarías dispuesto a pagar mensualmente si Basis te ahorrara 20 horas a la semana?
                                </p>
                                <div className="space-y-3">
                                    {PRICING_OPTIONS.map((opt) => (
                                        <button
                                            key={opt.value}
                                            onClick={() => handlePricingSelect(opt.value)}
                                            disabled={submittingFeedback}
                                            className="w-full flex items-center justify-between p-4 bg-background border border-border rounded-xl hover:border-primary/50 hover:bg-primary/5 hover:text-primary transition-all text-left font-medium text-sm group"
                                        >
                                            {opt.label}
                                            <div className="w-5 h-5 rounded-full border border-border group-hover:border-primary flex items-center justify-center transition-colors">
                                                <div className="w-2.5 h-2.5 rounded-full bg-primary opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="thanks"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="relative z-10 space-y-4"
                            >
                                <div className="p-4 bg-primary/10 text-primary rounded-xl font-medium text-sm text-center">
                                    ¡Mil millones de gracias! Tus respuestas valen oro para nosotros.
                                </div>
                                <div className="pt-4 border-t border-border/50">
                                    <label className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2 block">
                                        ¿Algo más que añadir? (Opcional)
                                    </label>
                                    <textarea
                                        value={frictionText}
                                        onChange={(e) => setFrictionText(e.target.value)}
                                        placeholder="Ej: Echo en falta poder exportar a Presto..."
                                        className="w-full bg-background border border-border rounded-xl p-3 text-sm min-h-[80px] focus:ring-2 focus:ring-primary/20 mb-3"
                                    />
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="w-full rounded-lg"
                                        onClick={handleFrictionSubmit}
                                        disabled={!frictionText.trim() || submittingFeedback}
                                    >
                                        {submittingFeedback ? <Loader2 className="w-4 h-4 animate-spin" /> : "Enviar sugerencia"}
                                    </Button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Time Saved ROI Metric */}
                <div className="w-full max-w-md animate-in fade-in duration-1000 delay-300">
                    <p className="text-sm font-medium text-center text-muted-foreground bg-primary/5 py-3 px-6 rounded-full border border-primary/10 inline-flex items-center gap-2 justify-center w-full">
                        <Clock className="w-4 h-4 text-primary" />
                        Hacer esto a mano tomaría <span className="text-foreground font-bold line-through mx-1 opacity-50">4h</span> <span className="text-primary font-bold">2 minutos</span>.
                    </p>
                </div>

            </div>

            {/* Right Side: Agenda (FOMO / Early Access) */}
            <div className="w-full lg:w-1/2 bg-gray-50 border-t lg:border-t-0 lg:border-l border-border dark:bg-black/50 overflow-y-auto custom-scrollbar relative flex items-center justify-center p-4">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary to-orange-400 opacity-20 hidden lg:block"></div>

                <div className="w-full max-w-lg bg-background rounded-3xl shadow-2xl border border-border/80 overflow-hidden relative">
                    {/* Header FOMO */}
                    <div className="bg-primary px-6 py-4 text-primary-foreground flex items-center justify-between">
                        <div>
                            <span className="text-xs font-bold uppercase tracking-wider opacity-80 mb-1 block">Paso Final</span>
                            <h2 className="text-base font-semibold leading-tight">Desbloquea tu Acceso Alpha</h2>
                        </div>
                        <div className="bg-white/20 px-3 py-1.5 rounded-full text-xs font-bold shadow-inner">
                            Solo con Invitación
                        </div>
                    </div>

                    <div className="p-2 sm:p-4">
                        <AgendaBooking />
                    </div>
                </div>
            </div>
        </div>
    );
}

'use client';

import { useWidgetContext, BudgetMode } from '@/context/budget-widget-context';
import { Sparkles, Home, Zap, MessageSquare, CheckCircle2, Bot } from 'lucide-react';
import { OptionCard } from './option-card';
import { DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useState } from 'react';
import { IdentityForm } from './identity-form';
import { AnimatePresence, motion } from 'framer-motion';

export function SmartTriggerContainer({ dictionary, intent }: { dictionary?: any; intent?: BudgetMode }) {
    const { openWidget, setLeadId, leadId } = useWidgetContext();
    const [selectedMode, setSelectedMode] = useState<BudgetMode | null>(intent || null);

    // Fallbacks
    const t = dictionary?.trigger || {
        title: "¿Cómo podemos ayudarte?",
        subtitle: "Elige la opción que mejor encaje con la visión de tu proyecto.",
        badge: "Empieza tu proyecto",
        features: [
            "Consultoría gratuita con IA",
            "Sin compromiso",
            "Respuesta inmediata"
        ],
        cards: {
            chat: {
                title: "Chat Arquitecto",
                description: "Habla con nuestra IA experta para definir tu proyecto ideal.",
                badge: "NUEVO"
            },
            wizard: {
                title: "Presupuesto Smart",
                description: "Análisis 360º de tu reforma con detalle profesional.",
                badge: "RECOMENDADO"
            },
            newBuild: {
                title: "Obra Nueva",
                description: "Estudio de viabilidad y costes para construcción desde cero."
            },
            reform: {
                title: "Presupuesto Rápido",
                description: "Estimación exprés para reformas sencillas."
            }
        }
    };

    const handleSelect = (mode: BudgetMode) => {
        // Si el visitante ya tiene un leadId verificado en localStorage, saltamos
        // la verificación OTP y abrimos directamente el modo elegido. Esto unifica
        // el comportamiento con el de los CTAs que llaman `openWidget(mode)` y evita
        // pedir OTP dos veces a la misma persona.
        if (leadId) {
            openWidget(mode);
            return;
        }
        setSelectedMode(mode);
    };

    const handleVerified = (leadId: string) => {
        setLeadId(leadId);
        if (selectedMode) {
            openWidget(selectedMode);
        }
    };

    const handleBack = () => {
        setSelectedMode(null);
    };

    const features = t.features || [
        "Consultoría gratuita con IA",
        "Sin compromiso",
        "Respuesta inmediata"
    ];

    const cards = t.cards || {
        chat: { title: "Chat Arquitecto", description: "Habla con nuestra IA...", badge: "NUEVO" },
        wizard: { title: "Presupuesto Smart", description: "Análisis 360º...", badge: "RECOMENDADO" },
        newBuild: { title: "Obra Nueva", description: "Estudio de viabilidad..." },
        reform: { title: "Presupuesto Rápido", description: "Estimación exprés..." }
    };

    return (
        <div className="h-full min-h-[550px] relative overflow-hidden">
            <AnimatePresence mode="wait">
                {selectedMode ? (
                    <motion.div
                        key="identity-form"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="h-full"
                    >
                        <IdentityForm
                            onVerified={handleVerified}
                            onBack={handleBack}
                            intent={selectedMode}
                            dictionary={dictionary}
                        />
                    </motion.div>
                ) : (
                    <motion.div
                        key="selection-grid"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        className="grid md:grid-cols-5 h-full"
                    >
                        {/* Sidebar / Header Section */}
                        <div className="md:col-span-2 bg-[#F9F9F8] dark:bg-slate-950 p-8 md:p-10 flex flex-col justify-center border-r border-gray-100 dark:border-slate-800">
                            <div className="mb-auto">
                                <span className="inline-block px-3 py-1 rounded-full bg-[#faeab1] text-[#d4af37] text-[10px] font-bold tracking-widest uppercase mb-6 shadow-sm">
                                    {t.badge || "Empieza tu proyecto"}
                                </span>
                                <DialogTitle className="heading-display text-4xl md:text-5xl mb-4 leading-[0.9] text-gray-900 dark:text-white">
                                    {t.title ? (
                                        <span dangerouslySetInnerHTML={{ __html: t.title.replace('ayudarte', '<span class="text-[#d4af37]">ayudarte</span>') }} />
                                    ) : (
                                        <>
                                            ¿Cómo podemos <br />
                                            <span className="text-[#d4af37]">ayudarte?</span>
                                        </>
                                    )}
                                </DialogTitle>
                                <DialogDescription className="text-gray-500 dark:text-gray-400 text-lg font-light leading-snug">
                                    {t.subtitle || "Elige la opción que mejor encaje con la visión de tu proyecto."}
                                </DialogDescription>
                            </div>

                            <div className="space-y-4 mt-10 md:mt-20">
                                {features.map((item: string, i: number) => (
                                    <div key={i} className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 font-medium">
                                        <div className="w-5 h-5 rounded-full border border-[#d4af37]/30 text-[#d4af37] flex items-center justify-center bg-white dark:bg-slate-900 shadow-sm">
                                            <CheckCircle2 className="w-3 h-3" />
                                        </div>
                                        <span>{item}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Options Grid */}
                        <div className="md:col-span-3 p-6 md:p-10 flex flex-col gap-4 justify-center bg-white dark:bg-slate-900 overflow-y-auto">

                            <OptionCard
                                title={cards.chat?.title || "Chat Arquitecto"}
                                description={cards.chat?.description || "Habla con nuestra IA experta."}
                                icon={Bot}
                                theme="violet"
                                badge={cards.chat?.badge}
                                onClick={() => handleSelect('chat')}
                                delay={0.1}
                            />

                            <OptionCard
                                title={cards.wizard?.title || "Presupuesto Smart"}
                                description={cards.wizard?.description || "Análisis 360º."}
                                icon={Sparkles}
                                theme="gold"
                                badge={cards.wizard?.badge}
                                onClick={() => handleSelect('wizard')}
                                delay={0.2}
                            />

                            <OptionCard
                                title={cards.newBuild?.title || "Obra Nueva"}
                                description={cards.newBuild?.description || "Estudio de viabilidad."}
                                icon={Home}
                                theme="emerald"
                                onClick={() => handleSelect('new-build')}
                                delay={0.3}
                            />

                            <OptionCard
                                title={cards.reform?.title || "Presupuesto Rápido"}
                                description={cards.reform?.description || "Estimación exprés."}
                                icon={Zap}
                                theme="amber"
                                onClick={() => handleSelect('reform')}
                                delay={0.4}
                            />

                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

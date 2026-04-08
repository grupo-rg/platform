'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb, Maximize2, Ruler, Wrench, X, MessageSquarePlus, Paintbrush, Hammer } from 'lucide-react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerClose } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';

interface BudgetWizardTipsProps {
    setInput: (val: string) => void;
}

export function BudgetWizardTips({ setInput }: BudgetWizardTipsProps) {
    const isMobile = useIsMobile();
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [hasOpenedBefore, setHasOpenedBefore] = useState(false);
    const [isDesktopOpen, setIsDesktopOpen] = useState(true);

    useEffect(() => {
        const stored = localStorage.getItem('dochevi_wizard_tips_expanded');
        if (stored !== null) {
            setIsDesktopOpen(stored === 'true');
        }
    }, []);

    const toggleDesktop = () => {
        const newVal = !isDesktopOpen;
        setIsDesktopOpen(newVal);
        localStorage.setItem('dochevi_wizard_tips_expanded', String(newVal));
    };

    // Auto-open on mobile on first load
    useEffect(() => {
        if (isMobile && !hasOpenedBefore) {
            const timer = setTimeout(() => {
                setIsDrawerOpen(true);
                setHasOpenedBefore(true);
            }, 1000); // Small delay for better UX
            return () => clearTimeout(timer);
        }
    }, [isMobile, hasOpenedBefore]);

    const tips = [
        {
            icon: Ruler,
            title: "Medidas aproximadas",
            description: "Danos metros cuadrados (m²) o lineales. Ej: 'Un piso de 80m2'."
        },
        {
            icon: Maximize2,
            title: "Calidades esperadas",
            description: "Especifica si buscas básico, medio o alto. Ej: 'Suelo laminado AC5'."
        },
        {
            icon: Wrench,
            title: "Estado actual",
            description: "¿Hay que demoler algo antes? Ej: 'Picar azulejos' o 'Alisar gotelé'."
        }
    ];

    const templates = [
        {
            title: "Reforma de Baño Estándar",
            icon: Hammer,
            text: "Presupuesta la reforma integral de un baño de 5 m2. Incluye demolición de alicatados, renovación completa de fontanería y tomas de agua, instalación de plato de ducha de resina antideslizante, mampara de cristal fijo, inodoro y mueble lavabo."
        },
        {
            title: "Reforma de Cocina",
            icon: Wrench,
            text: "Reforma de cocina de 12 m2. Considerar demolición de azulejos, alisado de paredes, nueva instalación de tuberías de cobre, cableado eléctrico para electrodomésticos de alta potencia, e instalación de suelo cerámico formato 60x60."
        },
        {
            title: "Alisado y Pintura",
            icon: Paintbrush,
            text: "Quiero quitar el gotelé y alisar las paredes de un piso de 90 m2. Además, pintar todas las paredes y techos en color blanco con pintura plástica mate lavable de alta calidad."
        },
        {
            title: "Cambio de Suelo (Tarima)",
            icon: Ruler,
            text: "Instalación de suelo laminado AC5 con rodapié blanco lacado en una vivienda de 80 m2. Incluye colocar capa aislante acústica y rebaje de 5 puertas de paso."
        },
        {
            title: "Reforma Integral de Local",
            icon: MessageSquarePlus,
            text: "Reforma integral de un local comercial de 100 m2 en bruto. Hay que hacer solera de hormigón, división con cartón-yeso (Pladur), instalación eléctrica completa con cuadro general, e instalación de aire acondicionado por conductos."
        }
    ];

    const handleApplyTemplate = (text: string) => {
        setInput(text);
        if (isMobile) {
            setIsDrawerOpen(false);
        }
    };

    const TipsContent = () => (
        <div className="space-y-6">
            <div className="space-y-4">
                <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-amber-500" />
                    Consejos del Arquitecto
                </h4>
                <div className="space-y-3">
                    {tips.map((tip, idx) => (
                        <div key={idx} className="flex gap-3 text-sm">
                            <div className="mt-0.5 w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 dark:bg-white/5 shrink-0 text-slate-500">
                                <tip.icon className="w-3.5 h-3.5" />
                            </div>
                            <div className="flex-1">
                                <span className="font-semibold text-slate-700 dark:text-slate-300 mr-1">{tip.title}:</span>
                                <span className="text-slate-500 dark:text-slate-400">{tip.description}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="space-y-3">
                <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Plantillas Rápidas</h4>
                <div className="flex flex-col gap-2">
                    {templates.map((tpl, idx) => (
                        <button
                            key={idx}
                            onClick={() => handleApplyTemplate(tpl.text)}
                            className="text-left p-3 rounded-xl border border-slate-200 dark:border-white/10 hover:border-primary/30 hover:bg-primary/5 transition-all group"
                        >
                            <div className="flex items-center gap-2 mb-1.5">
                                <tpl.icon className="w-4 h-4 text-primary" />
                                <span className="font-semibold text-sm text-slate-700 dark:text-slate-200 group-hover:text-primary transition-colors">{tpl.title}</span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">{tpl.text}</p>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );

    if (isMobile) {
        return (
            <>
                <div className="absolute top-[88px] md:top-24 right-4 z-40">
                    <Button
                        variant="default"
                        size="sm"
                        onClick={() => setIsDrawerOpen(true)}
                        className="bg-zinc-800 hover:bg-zinc-700 text-white shadow-lg border border-white/10 rounded-full text-xs font-semibold px-4 h-9"
                    >
                        <Lightbulb className="w-3.5 h-3.5 mr-2 text-amber-500" />
                        Ver Tips y Plantillas
                    </Button>
                </div>
                <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
                    <DrawerContent className="bg-white dark:bg-[#121212] border-t border-slate-200 dark:border-white/10">
                        <DrawerHeader className="text-left border-b border-slate-100 dark:border-white/5 pb-4">
                            <DrawerTitle className="text-xl flex items-center gap-2 text-slate-800 dark:text-white">
                                <Lightbulb className="w-5 h-5 text-primary" />
                                Cómo pedir tu presupuesto
                            </DrawerTitle>
                            <DrawerDescription className="text-slate-500 dark:text-slate-400 pt-1">
                                Sigue estos consejos o usa una plantilla para obtener un desglose mucho más preciso.
                            </DrawerDescription>
                        </DrawerHeader>
                        <div className="p-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                            <TipsContent />
                        </div>
                        <div className="p-4 pt-2">
                            <DrawerClose asChild>
                                <Button className="w-full bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-white/10 dark:text-white dark:hover:bg-white/20">Entendido</Button>
                            </DrawerClose>
                        </div>
                    </DrawerContent>
                </Drawer>
            </>
        );
    }

    // Desktop View
    return (
        <div 
            className={cn(
                "hidden md:flex flex-col shrink-0 border-l border-slate-200 dark:border-white/10 bg-white dark:bg-[#1e1f20]/50 backdrop-blur-xl h-full overflow-y-auto custom-scrollbar auto-cols-auto transition-all duration-300 relative",
                isDesktopOpen ? "w-[320px] p-6" : "w-[65px] items-center py-6 px-2"
            )}
        >
            {isDesktopOpen ? (
                <div className="flex flex-col animate-in fade-in duration-300">
                    <div className="mb-6 flex items-start justify-between">
                        <div>
                            <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                <Lightbulb className="w-5 h-5 text-primary" />
                                Cómo pedirlo
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 pr-2">Mejores descripciones = Mejor presupuesto generado por la IA.</p>
                        </div>
                        <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={toggleDesktop} 
                            className="h-8 w-8 shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-white -mr-2"
                        >
                            <X className="w-4 h-4" />
                        </Button>
                    </div>
                    <TipsContent />
                </div>
            ) : (
                <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={toggleDesktop} 
                    className="w-10 h-10 rounded-full bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary mt-2"
                    title="Ver Tips y Plantillas"
                >
                    <Lightbulb className="w-5 h-5" />
                </Button>
            )}
        </div>
    );
}

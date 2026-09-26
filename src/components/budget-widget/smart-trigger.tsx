'use client';

import { useWidgetContext, BudgetMode } from '@/context/budget-widget-context';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import { Calculator, Hammer, Home, MessageSquarePlus, Palmtree, ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useScrollDirection } from '@/hooks/use-scroll-direction';
import { usePathname } from 'next/navigation';


// Helper to get config with translation
const getTriggerConfig = (mode: BudgetMode, t: any) => {
    const labels: Record<string, string> = t?.trigger?.modes || {
        'general': 'Solicitar Presupuesto',
        'pool': 'Cotizar Piscina',
        'reform': 'Precio Reforma',
        'new_build': 'Estudio Obra Nueva',
        'kitchen': 'Presupuesto Cocina',
        'bathroom': 'Presupuesto Baño',
        'wizard': 'Presupuesto 360º',
        'chat': 'Chat Arquitecto'
    };

    const configBase: Record<string, { icon: any; color: string }> = {
        'general': { icon: Calculator, color: 'bg-primary' },
        'pool': { icon: Palmtree, color: 'bg-blue-600' },
        'reform': { icon: Hammer, color: 'bg-orange-600' },
        'new-build': { icon: Home, color: 'bg-slate-900' },
        'kitchen': { icon: MessageSquarePlus, color: 'bg-green-600' },
        'bathroom': { icon: MessageSquarePlus, color: 'bg-cyan-600' },
        'wizard': { icon: Calculator, color: 'bg-purple-600' },
        'chat': { icon: MessageSquarePlus, color: 'bg-violet-600' },
    };

    const modeKey = mode === 'new-build' ? 'new_build' : mode; // key in json is new_build
    const config = configBase[mode] || configBase['general']; // Fallback to general if mode not found

    return {
        label: labels[modeKey] || labels['general'],
        ...config
    };
};


export function SmartBudgetTrigger({ dictionary }: { dictionary?: any }) {
    const { activeMode, openWidget, isOpen } = useWidgetContext();
    const pathname = usePathname();
    // Fallback if dictionary is missing
    const t = dictionary || { trigger: { title: "¿Pensando en renovar?", subtitle: "Obtén tu estimación gratuita.", mobileSubtitle: "Click para comenzar" } };

    const config = getTriggerConfig(activeMode, t);
    const Icon = config.icon;

    const scrollDirection = useScrollDirection();
    const isVisible = scrollDirection === 'up' || isOpen === false;

    // Don't show if already open or if we are in the dashboard
    if (isOpen || pathname?.includes('/dashboard')) return null;

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ y: 100 }}
                    animate={{ y: 0 }}
                    exit={{ y: 100 }}
                    transition={{ type: 'spring', damping: 20 }}
                    className="fixed bottom-0 left-0 right-0 z-40 p-4 pointer-events-none"
                >
                    {/* Desktop Banner */}
                    <div className="hidden md:flex justify-end container-limited pointer-events-auto">
                        <div
                            onClick={() => openWidget()}
                            className={cn(
                                "cursor-pointer group flex items-center gap-4 bg-background border border-border/50 shadow-2xl rounded-full p-2 pl-6 pr-2 hover:scale-105 transition-all duration-300",
                                // "dark:bg-slate-900/90 backdrop-blur-md"
                            )}
                        >
                            <div className="flex flex-col">
                                <span className="font-bold text-sm text-foreground">{t.trigger?.title || "Thinking of renovating?"}</span>
                                <span className="text-xs text-muted-foreground">{t.trigger?.subtitle || "Get your free estimate."}</span>
                            </div>
                            <Button size="icon" aria-label={config.label} className={cn("h-12 w-12 rounded-full shadow-lg", config.color)}>
                                <Icon className="h-6 w-6 text-white" aria-hidden="true" />
                            </Button>
                        </div>
                    </div>

                    {/* Mobile App Bar */}
                    <div className="md:hidden pointer-events-auto flex justify-center pb-2">
                        <div
                            onClick={() => openWidget()}
                            className={cn(
                                "mx-2 w-full max-w-sm cursor-pointer group flex items-center justify-between gap-3 bg-background border border-border/50 shadow-2xl rounded-full p-2 pl-5 pr-2 active:scale-95 transition-all duration-200",
                            )}
                        >
                            <div className="flex flex-col text-left">
                                <span className="font-bold text-sm text-foreground">{t.trigger?.title || "Thinking of renovating?"}</span>
                                <span className="text-xs text-muted-foreground">{t.trigger?.subtitle || "Get your free estimate."}</span>
                            </div>
                            <Button size="icon" aria-label={config.label} className={cn("h-11 w-11 shrink-0 rounded-full shadow-lg", config.color)}>
                                <Icon className="h-5 w-5 text-white" aria-hidden="true" />
                            </Button>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

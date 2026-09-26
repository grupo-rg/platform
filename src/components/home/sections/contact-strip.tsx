'use client';

import { m, MotionProvider } from '@/components/home/lazy-motion';
import {
    Bot,
    Sparkles,
    Home,
    Zap,
    ArrowRight,
    CheckCircle2
} from 'lucide-react';
import { useWidgetContext, BudgetMode } from '@/context/budget-widget-context';

interface BudgetOption {
    mode: BudgetMode;
    icon: React.ReactNode;
    title: string;
    description: string;
    whyChoose: string;
    badge?: string;
    accent: string;
    accentBg: string;
}

export function ContactStrip({ t }: { t: any }) {
    const { openWidget } = useWidgetContext();

    const options: BudgetOption[] = [
        {
            mode: 'chat',
            icon: <Bot className="h-7 w-7" />,
            title: t?.options?.chat?.title || 'Chat Arquitecto IA',
            description: t?.options?.chat?.description || 'Conversa con nuestra IA experta para explorar ideas, validar conceptos y dar forma a tu visión.',
            whyChoose: t?.options?.chat?.whyChoose || 'Ideal si aún estás definiendo el proyecto y necesitas orientación profesional.',
            badge: 'NUEVO',
            accent: 'text-violet-400',
            accentBg: 'bg-violet-500/20 border-violet-500/30'
        },
        {
            mode: 'wizard',
            icon: <Sparkles className="h-7 w-7" />,
            title: t?.options?.wizard?.title || 'Presupuesto Smart',
            description: t?.options?.wizard?.description || 'Análisis 360° de tu reforma con desglose detallado. Nuestra IA analiza cada aspecto de tu proyecto.',
            whyChoose: t?.options?.wizard?.whyChoose || 'Perfecto si ya sabes lo que quieres y necesitas un presupuesto preciso.',
            badge: 'RECOMENDADO',
            accent: 'text-primary',
            accentBg: 'bg-primary/20 border-primary/30'
        },
        {
            mode: 'new-build',
            icon: <Home className="h-7 w-7" />,
            title: t?.options?.newBuild?.title || 'Obra Nueva',
            description: t?.options?.newBuild?.description || 'Estudio de viabilidad y estimación completa para proyectos de construcción desde cero.',
            whyChoose: t?.options?.newBuild?.whyChoose || 'Para proyectos de nueva construcción: viviendas, locales o edificios completos.',
            accent: 'text-emerald-400',
            accentBg: 'bg-emerald-500/20 border-emerald-500/30'
        },
        {
            mode: 'reform',
            icon: <Zap className="h-7 w-7" />,
            title: t?.options?.reform?.title || 'Presupuesto Rápido',
            description: t?.options?.reform?.description || 'Estimación exprés para reformas sencillas. Resultado en menos de 2 minutos.',
            whyChoose: t?.options?.reform?.whyChoose || 'Ideal para trabajos puntuales: baño, cocina, pintura, instalaciones.',
            accent: 'text-amber-400',
            accentBg: 'bg-amber-500/20 border-amber-500/30'
        }
    ];

    return (
        <MotionProvider>
            <section className="py-28 bg-[hsl(0,0%,4%)] text-white relative overflow-hidden">
                {/* Grid background pattern */}
                <div className="absolute inset-0 pointer-events-none opacity-[0.04]"
                    style={{
                        backgroundImage: `linear-gradient(to right, #ffffff 1px, transparent 1px),
                                        linear-gradient(to bottom, #ffffff 1px, transparent 1px)`,
                        backgroundSize: '3rem 3rem'
                    }}
                />

                {/* Ambient glow */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-primary/8 rounded-full blur-[150px] -z-10" />

                <div className="container-limited relative z-10">
                    {/* Header */}
                    <div className="text-center mb-16 max-w-3xl mx-auto">
                        <m.div
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm text-white/60 mb-6"
                        >
                            <Sparkles className="h-3.5 w-3.5 text-primary" />
                            {t?.badge || 'Empieza tu proyecto'}
                        </m.div>

                        <m.h2
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 }}
                            className="font-headline text-4xl md:text-6xl font-bold leading-tight mb-4"
                        >
                            {t?.title || '¿Cómo podemos '}
                            <span className="text-primary">{t?.titleHighlight || 'ayudarte'}</span>
                            {'?'}
                        </m.h2>

                        <m.p
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 }}
                            className="text-white/50 text-lg md:text-xl"
                        >
                            {t?.subtitle || 'Elige la opción que mejor encaje con tu proyecto. Cada herramienta está diseñada para una necesidad diferente.'}
                        </m.p>
                    </div>

                    {/* Bento Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 auto-rows-auto">
                        {options.map((option, index) => {
                            // Chat gets wider card (2 cols), Wizard also gets 2 cols
                            const isWide = index <= 1;

                            return (
                                <m.button
                                    key={option.mode}
                                    initial={{ opacity: 0, y: 30 }}
                                    whileInView={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.1 + index * 0.08, duration: 0.4 }}
                                    onClick={() => openWidget(option.mode)}
                                    className={`
                                        group relative text-left rounded-2xl border border-white/10
                                        bg-white/[0.03] hover:bg-white/[0.08]
                                        hover:border-white/20 transition-all duration-500
                                        p-7 md:p-8 flex flex-col
                                        ${isWide ? 'md:col-span-2' : 'md:col-span-2'}
                                    `}
                                >
                                    {/* Badge */}
                                    {option.badge && (
                                        <span className={`absolute top-4 right-4 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${option.accentBg}`}>
                                            {option.badge}
                                        </span>
                                    )}

                                    {/* Icon + Title */}
                                    <div className="flex items-center gap-4 mb-5">
                                        <div className={`p-3 rounded-xl border ${option.accentBg} ${option.accent} transition-transform duration-500 group-hover:scale-110`}>
                                            {option.icon}
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-bold font-headline text-white group-hover:text-white transition-colors">
                                                {option.title}
                                            </h3>
                                        </div>
                                    </div>

                                    {/* Description */}
                                    <p className="text-white/50 text-sm leading-relaxed mb-6 flex-1">
                                        {option.description}
                                    </p>

                                    {/* Why choose */}
                                    <div className="flex items-start gap-2 mb-6 p-3 rounded-xl bg-white/[0.04] border border-white/5">
                                        <CheckCircle2 className={`h-4 w-4 mt-0.5 shrink-0 ${option.accent}`} />
                                        <p className="text-white/40 text-xs leading-relaxed">
                                            {option.whyChoose}
                                        </p>
                                    </div>

                                    {/* CTA */}
                                    <div className={`flex items-center gap-2 ${option.accent} text-sm font-bold group-hover:translate-x-2 transition-transform`}>
                                        <span>{t?.cta || 'Comenzar'}</span>
                                        <ArrowRight className="h-4 w-4" />
                                    </div>
                                </m.button>
                            );
                        })}
                    </div>

                    {/* Trust signals */}
                    <m.div
                        initial={{ opacity: 0 }}
                        whileInView={{ opacity: 1 }}
                        transition={{ delay: 0.5 }}
                        className="mt-12 pt-8 border-t border-white/5 flex flex-wrap justify-center gap-8 text-xs text-white/30"
                    >
                        <span className="flex items-center gap-2">
                            <CheckCircle2 className="h-3.5 w-3.5 text-primary/50" />
                            {t?.trust1 || 'Sin compromiso'}
                        </span>
                        <span className="flex items-center gap-2">
                            <CheckCircle2 className="h-3.5 w-3.5 text-primary/50" />
                            {t?.trust2 || 'Respuesta inmediata'}
                        </span>
                        <span className="flex items-center gap-2">
                            <CheckCircle2 className="h-3.5 w-3.5 text-primary/50" />
                            {t?.trust3 || '+500 proyectos completados'}
                        </span>
                        <span className="flex items-center gap-2">
                            <CheckCircle2 className="h-3.5 w-3.5 text-primary/50" />
                            {t?.trust4 || '30+ años de experiencia'}
                        </span>
                    </m.div>
                </div>
            </section>
        </MotionProvider>
    );
}
